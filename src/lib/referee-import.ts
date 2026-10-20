import { Prisma } from '@/generated/prisma/client';
import { db as rootDb } from './db';
import { scopedDb } from './scoped-db';
import { actorForTournament } from './auth';
import { AppError, assertPermission, can, type Actor } from './permissions';
import { matchInclude, rosterSnapshot, lobbyInfo } from './matches-service';
import { teamInclude } from './teams-service';
import { validateSheetRecord } from './referee-workbook-state';
import { matchRulesSchema } from './match-rules';
import { fingerprint, parseRefereeWorkbook, type RefereeRecord } from './referee-workbook';
import { z } from 'zod';
import { sameTimeline, storedTimeline } from './referee-timeline';
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export const importApplySchema = z
  .object({
    importId: z.string().min(1).max(100),
    sheet: z.string().regex(/^\d{1,6}$/),
    matchId: z.string().min(1).max(100).optional(),
    baseVersion: z.number().int().positive().optional(),
    replace: z.boolean().default(false),
    confirmResults: z.boolean().default(false),
    choices: z
      .array(
        z.object({ row: z.number().int().min(9).max(500), use: z.enum(['SOURCE', 'WEBSITE']) }),
      )
      .max(250)
      .default([]),
    reason: z.string().trim().min(3).max(2000),
    create: z
      .object({
        stageId: z.string().min(1),
        teamAId: z.string().min(1),
        teamBId: z.string().min(1),
      })
      .optional(),
  })
  .refine(
    (r) => !!r.matchId !== !!r.create,
    'Choose an existing match or explicitly create a historical match.',
  );
export async function previewWorkbook(actor: Actor, input: Buffer, filename: string) {
  assertPermission(actor, 'matches.import');
  const parsed = await parseRefereeWorkbook(input),
    db = scopedDb(rootDb, actor.tournamentId || 'main');
  const preview = await db.refereeImport.create({
    data: {
      tournamentId: actor.tournamentId || 'main',
      createdBy: actor.id,
      filename: filename.slice(0, 180),
      fingerprint: parsed.fingerprint,
      records: json(parsed.records),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  return importPreview(actor, preview.id);
}
export async function importDestinations(actor: Actor) {
  assertPermission(actor, 'matches.import');
  const user = await rootDb.user.findUniqueOrThrow({
    where: { id: actor.id },
    include: { roles: { include: { role: { include: { permissions: true } } } } },
  });
  const tournaments = await rootDb.tournament.findMany({ orderBy: { name: 'asc' } });
  return tournaments.flatMap((t) => {
    const scoped = actorForTournament(user, t.id);
    return can(scoped, 'matches.import')
      ? [{ id: t.id, slug: t.slug, name: t.name, canConfirm: can(scoped, 'matches.manage') }]
      : [];
  });
}
function sameOutcome(
  match: { scoreA: number; scoreB: number; forfeitSide: string | null },
  record: RefereeRecord,
) {
  return (
    match.scoreA === record.scoreA &&
    match.scoreB === record.scoreB &&
    match.forfeitSide === record.forfeitSide
  );
}
function canonicalLobby(value: string) {
  return lobbyInfo(value, null).lobbyUrl;
}
export async function importPreview(actor: Actor, id: string) {
  assertPermission(actor, 'matches.import');
  const db = scopedDb(rootDb, actor.tournamentId || 'main'),
    preview = await db.refereeImport.findUnique({ where: { id } });
  if (!preview || preview.expiresAt < new Date())
    throw new AppError('Import preview expired or not found. Upload the workbook again.', 404);
  const [matches, stages, teams, importEvents] = await Promise.all([
    db.match.findMany({
      include: {
        stage: { select: { name: true } },
        poolRevision: { include: { slots: true } },
        actions: { orderBy: { sequence: 'asc' } },
        results: true,
      },
    }),
    db.tournamentStage.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true },
      orderBy: { position: 'asc' },
    }),
    db.team.findMany({
      where: { status: 'APPROVED' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    db.matchEvent.findMany({
      where: { kind: 'sheet.import' },
      select: { matchId: true, data: true },
    }),
  ]);
  return {
    id: preview.id,
    filename: preview.filename,
    tournament: await db.tournament.findUniqueOrThrow({
      where: { id: actor.tournamentId || 'main' },
      select: { id: true, slug: true, name: true },
    }),
    canConfirm: can(actor, 'matches.manage'),
    records: (preview.records as unknown as RefereeRecord[])
      .sort((a, b) => Number(a.sheet) - Number(b.sheet))
      .map((record) => {
        const match = matches.find((m) => m.code === record.code);
        const conflicts: string[] = [];
        const errors = [...record.issues];
        let sourceLobby = record.mp;
        const stage = stages.find((s) => s.name === record.stage),
          red = teams.find((t) => t.name === record.red),
          blue = teams.find((t) => t.name === record.blue);
        const createSuggestion =
          !match && stage && red && blue && red.id !== blue.id
            ? { stageId: stage.id, teamAId: red.id, teamBId: blue.id }
            : null;
        try {
          sourceLobby = canonicalLobby(record.mp);
        } catch (e) {
          errors.push((e as Error).message);
        }
        if (match) {
          const participants = match.participants as unknown as {
            A: { name: string };
            B: { name: string };
          };
          if (participants.A.name !== record.red || participants.B.name !== record.blue)
            errors.push('Participating teams differ.');
          if (match.stage.name !== record.stage) errors.push('Stage differs.');
          if (match.lobbyUrl && match.lobbyUrl !== sourceLobby)
            conflicts.push('Multiplayer link differs.');
          if (match.actions.some((a) => !a.voided))
            conflicts.push(
              'Website already has official actions. Keep them or explicitly replace the history.',
            );
          if (!sameOutcome(match, record)) conflicts.push('Overall score differs.');
          if (
            ['IN_PROGRESS', 'DISPUTED', 'CANCELLED', 'AWAITING_CONFIRMATION'].includes(match.status)
          )
            conflicts.push(`Website match is ${match.status}. Explicit confirmation is required.`);
          try {
            if (!match.poolRevision) throw new AppError('No frozen pool is linked to this match.');
            validateSheetRecord(record, match.rules, match.poolRevision.slots);
          } catch (e) {
            errors.push((e as Error).message);
          }
        } else if (!createSuggestion) {
          errors.push(
            'Match not found. Select existing stage and approved teams for historical creation.',
          );
        }
        const alreadyImported =
          !!match &&
          sameOutcome(match, record) &&
          match.lobbyUrl === sourceLobby &&
          sameTimeline(match, record) &&
          importEvents.some(
            (e) =>
              e.matchId === match.id &&
              (e.data as { fingerprint?: string })?.fingerprint ===
                fingerprint({ source: record.fingerprint, choices: [] }),
          );
        return {
          record,
          alreadyImported,
          errors: [...new Set(errors)],
          requiresReplacement: !alreadyImported && conflicts.length > 0,
          createSuggestion,
          target: match
            ? { id: match.id, code: match.code, version: match.version, status: match.status }
            : null,
          conflicts: alreadyImported ? [] : conflicts,
          websiteActions: match ? storedTimeline(match) : [],
        };
      }),
    stages,
    teams,
  };
}
export async function applyWorkbook(original: Actor, input: z.infer<typeof importApplySchema>) {
  assertPermission(original, 'matches.import');
  const tournamentId = original.tournamentId || 'main',
    db = scopedDb(rootDb, tournamentId);
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
      const user = await tx.user.findUniqueOrThrow({
        where: { id: original.id },
        include: {
          roles: { where: { tournamentId }, include: { role: { include: { permissions: true } } } },
        },
      });
      const actor = actorForTournament(user, tournamentId);
      assertPermission(actor, 'matches.import');
      if (input.confirmResults) assertPermission(actor, 'matches.manage');
      const preview = await tx.refereeImport.findUnique({ where: { id: input.importId } });
      if (!preview || preview.expiresAt < new Date())
        throw new AppError('Import preview expired or not found.', 404);
      const record = (preview.records as unknown as RefereeRecord[]).find(
        (r) => r.sheet === input.sheet,
      );
      if (!record) throw new AppError('Worksheet not found in this preview.', 404);
      const lobby = lobbyInfo(record.mp, null);
      const acceptedFingerprint = fingerprint({
        source: record.fingerprint,
        choices: [...input.choices].sort((a, b) => a.row - b.row),
      });
      let match = input.matchId
        ? await tx.match.findUnique({ where: { id: input.matchId }, include: matchInclude })
        : null;
      if (input.matchId && !match) throw new AppError('Target match not found.', 404);
      if (match && match.code !== record.code)
        throw new AppError('The match identifier does not match this worksheet.');
      const sourceRecord = structuredClone(record);
      if (input.choices.length) {
        if (!match)
          throw new AppError('Per-action conflict resolution requires an existing match.');
        const website = match.actions.filter((a) => !a.voided);
        for (const choice of input.choices) {
          if (choice.use !== 'WEBSITE') continue;
          const index = record.actions.findIndex((a) => a.row === choice.row),
            current = website[index];
          if (index < 0 || !current)
            throw new AppError('That website action is unavailable. Refresh the preview.');
          record.actions[index] = {
            ...record.actions[index],
            kind: current.kind,
            side: current.side,
            slotName: current.slotName,
            winner:
              match.results.find((r) => !r.voided && r.actionId === current.id)?.winnerSide || null,
          };
        }
      }
      if (
        match &&
        sameTimeline(match, record) &&
        sameOutcome(match, record) &&
        match.lobbyUrl === lobby.lobbyUrl &&
        (await tx.matchEvent.findFirst({
          where: {
            matchId: match.id,
            kind: 'sheet.import',
            data: { path: ['fingerprint'], equals: acceptedFingerprint },
          },
        }))
      )
        return {
          id: match.id,
          alreadyApplied: true,
          actionsImported: 0,
          resultsImported: 0,
          created: false,
          status: match.status,
        };
      if (match && match.version !== input.baseVersion)
        throw new AppError('Match changed after preview. Refresh the import review.', 409);
      if (
        match &&
        !input.replace &&
        (match.actions.some((a) => !a.voided) ||
          match.results.some((r) => !r.voided) ||
          !sameOutcome(match, record) ||
          (match.lobbyUrl && match.lobbyUrl !== lobby.lobbyUrl) ||
          ['IN_PROGRESS', 'DISPUTED', 'CANCELLED', 'AWAITING_CONFIRMATION'].includes(match.status))
      )
        throw new AppError(
          'Keep existing website actions, or explicitly approve replacing the history.',
          409,
        );
      if (input.create) {
        assertPermission(actor, 'matches.manage');
        if (await tx.match.findFirst({ where: { code: record.code } }))
          throw new AppError('That match already exists. Select it instead.', 409);
        const [stage, teams, settings, tournament] = await Promise.all([
          tx.tournamentStage.findUniqueOrThrow({
            where: { id: input.create.stageId },
            include: { mappool: { include: { publishedRevision: { include: { slots: true } } } } },
          }),
          tx.team.findMany({
            where: { id: { in: [input.create.teamAId, input.create.teamBId] }, status: 'APPROVED' },
            include: teamInclude,
          }),
          tx.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } }),
          tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } }),
        ]);
        if (
          teams.length !== 2 ||
          stage.name !== record.stage ||
          stage.kind === 'QUALIFIERS' ||
          stage.archivedAt ||
          stage.mappool?.state !== 'PUBLISHED' ||
          !stage.mappool.publishedRevision
        )
          throw new AppError(
            'Select the correct active stage, published pool and two approved teams.',
          );
        const a = teams.find((t) => t.id === input.create!.teamAId)!,
          b = teams.find((t) => t.id === input.create!.teamBId)!;
        if (a.name !== record.red || b.name !== record.blue)
          throw new AppError('Selected team names do not match the workbook.');
        const valid = validateSheetRecord(
          record,
          {
            ...matchRulesSchema.parse(stage.matchRules || settings.matchRules),
            gameMode: tournament.gameMode,
          },
          stage.mappool.publishedRevision.slots,
        );
        match = await tx.match.create({
          data: {
            code: record.code,
            stageId: stage.id,
            teamAId: a.id,
            teamBId: b.id,
            poolRevisionId: stage.mappool.publishedRevision.id,
            participants: json({ A: rosterSnapshot(a), B: rosterSnapshot(b) }),
            rules: json(valid.rules),
          },
          include: matchInclude,
        });
      }
      if (!match) throw new AppError('Choose a target match.');
      const participants = match.participants as unknown as {
        A: { name: string };
        B: { name: string };
      };
      if (
        match.stage.name !== record.stage ||
        participants.A.name !== record.red ||
        participants.B.name !== record.blue ||
        !match.poolRevision
      )
        throw new AppError('Match stage, participants or frozen pool do not match the source.');
      const valid = validateSheetRecord(record, match.rules, match.poolRevision.slots);
      const completed =
        !!valid.winner &&
        (input.confirmResults || (match.status === 'COMPLETED' && sameOutcome(match, record)));
      const before = match;
      await tx.matchMapAction.updateMany({ where: { matchId: match.id }, data: { voided: true } });
      await tx.matchMapResult.updateMany({ where: { matchId: match.id }, data: { voided: true } });
      let sequence = match.actions.at(-1)?.sequence || 0;
      for (const row of valid.actions) {
        const saved = await tx.matchMapAction.create({
          data: {
            matchId: match.id,
            sequence: ++sequence,
            kind: row.kind,
            side: row.side,
            slotName: row.slotName,
            category: row.category,
            actorId: actor.id,
            provenance: json({
              type: 'XLSX',
              importId: preview.id,
              worksheet: record.sheet,
              sourceRow: row.row,
              sourceFingerprint: sourceRecord.fingerprint,
              original: row.original,
            }),
          },
        });
        if (row.winner)
          await tx.matchMapResult.create({
            data: {
              matchId: match.id,
              actionId: saved.id,
              winnerSide: row.winner,
              entryMode: 'WINNER_ONLY',
              notes: `Accepted worksheet ${record.sheet}, row ${row.row}`,
            },
          });
      }
      await tx.multiplayerGame.updateMany({
        where: { matchId: match.id, actionId: { not: null } },
        data: { actionId: null, confirmedAt: null },
      });
      const updated = await tx.match.updateMany({
        where: { id: match.id, version: match.version },
        data: {
          rules: json(valid.rules),
          ...valid.starters,
          ...lobby,
          scoreA: valid.scoreA,
          scoreB: valid.scoreB,
          winnerSide: valid.winner,
          forfeitSide: record.forfeitSide,
          resultMode: 'MAPS',
          status: completed ? 'COMPLETED' : valid.winner ? 'AWAITING_CONFIRMATION' : 'IN_PROGRESS',
          submittedAt: valid.winner ? match.submittedAt || new Date() : null,
          completedAt: completed ? match.completedAt || new Date() : null,
          timerStartedAt: null,
          timerRemainingSeconds: 0,
          multiplayerSync: Prisma.DbNull,
          multiplayerSyncedAt: null,
          multiplayerError: null,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new AppError('Match changed during import.', 409);
      await tx.matchEvent.create({
        data: {
          matchId: match.id,
          version: match.version + 1,
          actorId: actor.id,
          kind: 'sheet.import',
          notes: input.reason,
          data: json({
            importId: preview.id,
            filename: preview.filename,
            fingerprint: acceptedFingerprint,
            sourceFingerprint: sourceRecord.fingerprint,
            choices: input.choices,
            workbookFingerprint: preview.fingerprint,
            source: 'XLSX',
            record,
            originalRecord: sourceRecord,
            previousActions: before.actions,
            previousResults: before.results,
            acceptedAt: new Date().toISOString(),
            confirmedByImporter: input.confirmResults,
          }),
        },
      });
      await tx.matchResultRevision.create({
        data: {
          matchId: match.id,
          version: match.version + 1,
          createdBy: actor.id,
          kind: 'sheet.import',
          reason: input.reason,
          snapshot: json({
            before,
            after: await tx.match.findUniqueOrThrow({
              where: { id: match.id },
              include: matchInclude,
            }),
          }),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'sheet.import',
          entityType: 'match',
          entityId: match.id,
          details: { sheet: record.sheet, fingerprint: record.fingerprint, reason: input.reason },
        },
      });
      return {
        id: match.id,
        version: match.version + 1,
        alreadyApplied: false,
        actionsImported: valid.actions.length,
        resultsImported: valid.results.length,
        created: !!input.create,
        status: completed ? 'COMPLETED' : valid.winner ? 'AWAITING_CONFIRMATION' : 'IN_PROGRESS',
      };
    },
    { timeout: 30000 },
  );
}
export const importBatchSchema = z.object({
  type: z.literal('batch'),
  importId: z.string().min(1).max(100),
  reason: z.string().trim().min(3).max(2000),
  confirmResults: z.boolean().default(false),
  matches: z
    .array(
      z.object({
        sheet: z.string().regex(/^\d{1,6}$/),
        matchId: z.string().min(1).max(100).optional(),
        baseVersion: z.number().int().positive().optional(),
        replace: z.boolean().default(false),
        create: z
          .object({
            stageId: z.string().min(1),
            teamAId: z.string().min(1),
            teamBId: z.string().min(1),
          })
          .optional(),
      }),
    )
    .min(1)
    .max(120)
    .refine(
      (rows) => new Set(rows.map((r) => r.sheet)).size === rows.length,
      'Select each worksheet only once.',
    ),
});
export async function applyWorkbookBatch(actor: Actor, input: z.infer<typeof importBatchSchema>) {
  assertPermission(actor, 'matches.import');
  if (input.confirmResults) assertPermission(actor, 'matches.manage');
  const preview = await importPreview(actor, input.importId);
  const results: {
    sheet: string;
    id?: string;
    status: string;
    actions: number;
    mapResults: number;
    error?: string;
    created?: boolean;
  }[] = [];
  for (const row of input.matches) {
    try {
      const result = await applyWorkbook(
        actor,
        importApplySchema.parse({
          ...row,
          importId: input.importId,
          reason: input.reason,
          confirmResults: input.confirmResults,
        }),
      );
      results.push({
        sheet: row.sheet,
        id: result.id,
        status: result.alreadyApplied ? 'ALREADY_IMPORTED' : result.status,
        actions: result.actionsImported,
        mapResults: result.resultsImported,
        created: result.created,
      });
    } catch (e) {
      results.push({
        sheet: row.sheet,
        status: 'FAILED',
        actions: 0,
        mapResults: 0,
        error:
          e instanceof AppError || e instanceof z.ZodError
            ? e.message
            : 'Import failed. The match was not changed.',
      });
    }
  }
  const skipped = preview.records
    .filter((r) => !input.matches.some((m) => m.sheet === r.record.sheet))
    .map((r) => ({ sheet: r.record.sheet, reason: r.errors.join(' ') || 'Not selected' }));
  return {
    tournament: preview.tournament,
    importedMatches: results.filter((r) => !r.error && r.status !== 'ALREADY_IMPORTED').length,
    createdMatches: results.filter((r) => r.created).length,
    actionsImported: results.reduce((n, r) => n + r.actions, 0),
    resultsImported: results.reduce((n, r) => n + r.mapResults, 0),
    alreadyImported: results.filter((r) => r.status === 'ALREADY_IMPORTED').length,
    failedMatches: results.filter((r) => r.error).length,
    skipped,
    results,
  };
}
