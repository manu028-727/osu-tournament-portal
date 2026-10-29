import { Prisma } from '@/generated/prisma/client';
import { db as rootDb } from './db';
import { scopedDb } from './scoped-db';
import { actorForTournament } from './auth';
import { AppError, assertPermission, can, type Actor } from './permissions';
import { matchInclude, rosterSnapshot, lobbyInfo } from './match-record';
import { teamInclude } from './teams-service';
import { validateSheetRecord } from './referee-workbook-state';
import { inheritedRules, tournamentScoring } from './gameplay-scoring';
import {
  approvedStageMappings,
  normalizeStageLabel,
  objectMetadata,
  resolveStageLabel,
} from './stage-reconciliation';
import {
  fingerprint,
  parseRefereeWorkbook,
  workbookScoringCompatibility,
  type RefereeRecord,
} from './referee-workbook';
import { z } from 'zod';
import { allocateMatchNumber, numericMatchIdentifier } from './match-numbering';
import { sameTimeline, storedTimeline } from './referee-timeline';
import {
  assertCompetitionResultCorrection,
  advanceConfirmedCompetitionResult,
} from './competition-service';
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
      .refine(
        (rows) => new Set(rows.map((row) => row.row)).size === rows.length,
        'Resolve each source row only once.',
      )
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
  const [matches, stages, teams, importEvents, settings, tournamentState] = await Promise.all([
    db.match.findMany({
      include: {
        stage: { select: { name: true, id: true } },
        poolRevision: { include: { slots: true } },
        actions: { orderBy: { sequence: 'asc' } },
        results: true,
      },
    }),
    db.tournamentStage.findMany({
      where: { archivedAt: null, kind: { not: 'QUALIFIERS' } },
      include: { mappool: { include: { publishedRevision: { include: { slots: true } } } } },
      orderBy: { position: 'asc' },
    }),
    db.team.findMany({
      where: { status: 'APPROVED' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    db.matchEvent.findMany({
      where: { kind: { in: ['sheet.import', 'stage.reconcile'] } },
      select: { matchId: true, kind: true, data: true },
    }),
    db.tournamentSettings.findUniqueOrThrow({
      where: { tournamentId: actor.tournamentId || 'main' },
    }),
    db.tournament.findUniqueOrThrow({
      where: { id: actor.tournamentId || 'main' },
      select: { id: true, slug: true, name: true, matchNumberSequence: true },
    }),
  ]);
  const scoring = tournamentScoring(settings.gameplayScoring);
  return {
    id: preview.id,
    filename: preview.filename,
    tournament: {
      id: tournamentState.id,
      slug: tournamentState.slug,
      name: tournamentState.name,
    },
    canConfirm: can(actor, 'matches.manage'),
    gameplayScoring: scoring,
    records: (preview.records as unknown as RefereeRecord[])
      .sort((a, b) => Number(a.sheet) - Number(b.sheet))
      .map((record) => {
        const match = matches.find((m) => m.code === record.code);
        const conflicts: string[] = [];
        const compatibility = workbookScoringCompatibility(record.scoring, scoring);
        const errors = [...record.issues, ...compatibility.errors];
        const warnings = [...(record.warnings || []), ...compatibility.warnings];
        let sourceLobby = record.mp;
        const stageMapping = resolveStageLabel(
          record.stage,
          stages,
          approvedStageMappings(importEvents),
        );
        const stage = stageMapping.stage,
          red = teams.find((t) => t.name === record.red),
          blue = teams.find((t) => t.name === record.blue);
        const createSuggestion =
          !match &&
          stage &&
          stage.mappool?.state === 'PUBLISHED' &&
          stage.mappool.publishedRevision?.slots.length &&
          red &&
          blue &&
          red.id !== blue.id
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
          if (!stageMapping.candidates.some((stage) => stage.id === match.stageId))
            errors.push('Stage differs or requires reconciliation to an existing gameplay stage.');
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
            validateSheetRecord(record, match.rules, match.poolRevision.slots, {
              preserveRules: true,
            });
          } catch (e) {
            errors.push((e as Error).message);
          }
        } else if (!createSuggestion) {
          errors.push(
            'Match not found. Select existing stage and approved teams for historical creation.',
          );
        }
        if (
          !match &&
          createSuggestion &&
          numericMatchIdentifier(record.code) !== null &&
          numericMatchIdentifier(record.code)! <= tournamentState.matchNumberSequence
        )
          errors.push(
            `Source match number ${numericMatchIdentifier(record.code)} is already allocated or reserved. Resolve the number conflict before importing this match.`,
          );
        if (stageMapping.ambiguous)
          warnings.push(
            'Stage mapping is ambiguous. Explicitly select one of the existing matching stages.',
          );
        if (!stageMapping.candidates.length)
          errors.push(
            'No approved source-stage mapping. Explicitly select an existing stage for historical creation; no stage will be created.',
          );
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
          warnings,
          scoring: { source: record.scoring?.mode || null, target: scoring },
          stageMapping: {
            source: record.stage,
            stageId: stage?.id || null,
            stageName: stage?.name || null,
            candidates: stageMapping.candidates.map((stage) => ({
              id: stage.id,
              name: stage.name,
            })),
            bracket: stageMapping.bracket,
            roundLabel: stageMapping.roundLabel,
          },
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
    stages: stages
      .filter((stage) => !normalizeStageLabel(stage.name).bracket)
      .map((stage) => ({ id: stage.id, name: stage.name })),
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
      const settings = await tx.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } });
      const compatibility = workbookScoringCompatibility(
        record.scoring,
        tournamentScoring(settings.gameplayScoring),
      );
      if (compatibility.errors.length) throw AppError.fromMessages(compatibility.errors, 409, ' ');
      const stages = await tx.tournamentStage.findMany({
        where: { archivedAt: null, kind: { not: 'QUALIFIERS' } },
      });
      const mappingEvents = await tx.matchEvent.findMany({
        where: { kind: { in: ['sheet.import', 'stage.reconcile'] } },
        select: { kind: true, data: true },
      });
      const stageMapping = resolveStageLabel(
        record.stage,
        stages,
        approvedStageMappings(mappingEvents),
      );
      const lobby = lobbyInfo(record.mp, null);
      const acceptedFingerprint = fingerprint({
        source: record.fingerprint,
        choices: [...input.choices].sort((a, b) => a.row - b.row),
      });
      let match = input.matchId
        ? await tx.match.findUnique({ where: { id: input.matchId }, include: matchInclude })
        : null;
      if (input.matchId && !match) throw new AppError('Target match not found.', 404);
      if (match?.deletedAt)
        throw new AppError(
          'This generated match was deleted. Reopen it before making changes.',
          409,
        );
      if (match && match.code !== record.code)
        throw new AppError('The match identifier does not match this worksheet.');
      const sourceRecord = structuredClone(record);
      const retainedActions = new Map<
        number,
        { id: string; provenance: Prisma.JsonValue | null }
      >();
      const retainedResults = new Map<number, NonNullable<typeof match>['results'][number]>();
      if (input.choices.length) {
        if (!match)
          throw new AppError('Per-action conflict resolution requires an existing match.');
        const website = match.actions.filter((a) => !a.voided);
        for (const choice of input.choices) {
          const index = record.actions.findIndex((a) => a.row === choice.row);
          if (index < 0) throw new AppError('That source row is unavailable. Refresh the preview.');
          if (choice.use !== 'WEBSITE') continue;
          const current = website[index];
          if (!current)
            throw new AppError('That website action is unavailable. Refresh the preview.');
          retainedActions.set(choice.row, {
            id: current.id,
            provenance: current.provenance ?? null,
          });
          const result = match.results.find((r) => !r.voided && r.actionId === current.id);
          if (result) retainedResults.set(choice.row, result);
          record.actions[index] = {
            ...record.actions[index],
            kind: current.kind,
            side: current.side,
            slotName: current.slotName,
            winner: result?.winnerSide || null,
          };
        }
      }
      if (
        match &&
        (!input.confirmResults || match.status === 'COMPLETED') &&
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
          matchNumber: match.matchNumber,
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
        const stage = await tx.tournamentStage.findUniqueOrThrow({
          where: { id: input.create.stageId },
          include: { mappool: { include: { publishedRevision: { include: { slots: true } } } } },
        });
        const teams = await tx.team.findMany({
          where: { id: { in: [input.create.teamAId, input.create.teamBId] }, status: 'APPROVED' },
          include: teamInclude,
        });
        const tournament = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
        if (
          teams.length !== 2 ||
          (stageMapping.candidates.length > 0 &&
            !stageMapping.candidates.some((candidate) => candidate.id === stage.id)) ||
          !!normalizeStageLabel(stage.name).bracket ||
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
          inheritedRules(
            stage.matchRules || settings.matchRules,
            settings.gameplayScoring,
            tournament.gameMode,
          ),
          stage.mappool.publishedRevision.slots,
        );
        const matchNumber = await allocateMatchNumber(
          tx,
          tournamentId,
          numericMatchIdentifier(record.code),
        );
        match = await tx.match.create({
          data: {
            matchNumber,
            code: record.code,
            sourceKey: `referee:${tournamentId}:${record.code}`,
            bracket: stageMapping.bracket || '',
            source: json({
              type: 'XLSX',
              originalStage: record.stage,
              bracket: stageMapping.bracket,
              roundLabel: stageMapping.roundLabel,
              scoring: record.scoring || null,
              sourceFingerprint: sourceRecord.fingerprint,
            }),
            stageId: stage.id,
            teamAId: a.id,
            teamBId: b.id,
            poolRevisionId: stage.mappool.publishedRevision.id,
            participants: json({ A: rosterSnapshot(a), B: rosterSnapshot(b) }),
            rules: json(valid.rules),
          },
          include: matchInclude,
        });
        if (!stageMapping.candidates.length) stageMapping.candidates.push(stage);
      }
      if (!match) throw new AppError('Choose a target match.');
      const participants = match.participants as unknown as {
        A: { name: string };
        B: { name: string };
      };
      if (
        !stageMapping.candidates.some((stage) => stage.id === match.stageId) ||
        participants.A.name !== record.red ||
        participants.B.name !== record.blue ||
        !match.poolRevision
      )
        throw new AppError('Match stage, participants or frozen pool do not match the source.');
      const valid = validateSheetRecord(record, match.rules, match.poolRevision.slots, {
        preserveRules: true,
      });
      const completed =
        !!valid.winner &&
        (input.confirmResults || (match.status === 'COMPLETED' && sameOutcome(match, record)));
      if (
        match.status === 'COMPLETED' &&
        (!completed || !sameOutcome(match, record) || match.winnerSide !== valid.winner)
      )
        await assertCompetitionResultCorrection(
          tx,
          tournamentId,
          match.id,
          completed ? valid.winner : null,
          false,
        );
      const before = match;
      await tx.matchMapAction.updateMany({ where: { matchId: match.id }, data: { voided: true } });
      await tx.matchMapResult.updateMany({ where: { matchId: match.id }, data: { voided: true } });
      let sequence = match.actions.at(-1)?.sequence || 0;
      for (const row of valid.actions) {
        const retainedResult = retainedResults.get(row.row);
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
              sourceScoring: sourceRecord.scoring || null,
              sourceGameMode: sourceRecord.gameMode,
              resolution: retainedActions.has(row.row) ? 'WEBSITE' : 'SOURCE',
              ...(retainedActions.has(row.row)
                ? { retainedWebsiteAction: retainedActions.get(row.row) }
                : {}),
              ...(retainedResult ? { retainedWebsiteResultId: retainedResult.id } : {}),
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
              entryMode: retainedResult?.entryMode || 'WINNER_ONLY',
              scoreA: retainedResult?.scoreA ?? null,
              scoreB: retainedResult?.scoreB ?? null,
              notes: retainedResult
                ? retainedResult.notes
                : `Accepted worksheet ${record.sheet}, row ${row.row}`,
              ...(retainedResult?.playerScores?.length
                ? {
                    playerScores: {
                      create: retainedResult.playerScores.map((score) => ({
                        osuId: score.osuId,
                        side: score.side,
                        score: score.score,
                        accuracy: score.accuracy,
                        mods: score.mods === null ? Prisma.JsonNull : json(score.mods),
                      })),
                    },
                  }
                : {}),
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
          bracket: match.bracket || stageMapping.bracket || '',
          source: json({
            ...objectMetadata(match.source),
            refereeWorkbook: {
              originalStage: record.stage,
              bracket: stageMapping.bracket,
              roundLabel: stageMapping.roundLabel,
              scoring: record.scoring || null,
              sourceFingerprint: sourceRecord.fingerprint,
            },
          }),
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
            stageMapping: {
              stageId: match.stageId,
              approved: !!input.create,
              bracket: stageMapping.bracket,
              roundLabel: stageMapping.roundLabel,
            },
            scoringProvenance: record.scoring || null,
            scoringWarnings: compatibility.warnings,
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
      if (completed) await advanceConfirmedCompetitionResult(tx, tournamentId, match.id, actor.id);
      return {
        id: match.id,
        matchNumber: match.matchNumber,
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
    matchNumber?: number;
    status: string;
    actions: number;
    mapResults: number;
    error?: string;
    created?: boolean;
  }[] = [];
  for (const row of [...input.matches].sort((a, b) => Number(a.sheet) - Number(b.sheet))) {
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
        matchNumber: result.matchNumber,
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
