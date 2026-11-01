import type { Prisma } from '@/generated/prisma/client';
import { db } from './db';
import { scopedDb } from './scoped-db';
import { AppError, assertPermission, type Actor } from './permissions';
import { qualifierSourceHash, canonicalQualifierJson } from './qualifier-seeding';
import { collectMultiplayerPages } from './multiplayer';
import { osuGet } from './osu';
import { teamInclude } from './teams-service';
import { rosterSnapshot } from './match-record';
import { inheritedRules } from './gameplay-scoring';
import { qualifierPolicySchema, qualifierTeamAggregate } from './qualifier-policy';
import { assertQualifierMutable } from './qualifier-standings-service';
import { applyQualifierAction } from './qualifiers-service';
import { qualifierActionSchema } from './qualifiers-validation';
import { assertQualifierCapacity } from './qualifiers-bulk';
import {
  captureQualifierGame,
  currentQualifier,
  refreshedQualifierActor,
  ignoreQualifierGame,
  completeImportedQualifier,
} from './qualifier-capture-service';
import { qualifierCapturePlan, type QualifierCapture } from './qualifier-multiplayer';
import { convertedScore } from './match-engine';
import { matchRulesSchema } from './match-rules';
import { qualifierScoreViolation, qualifierTeamModViolation } from './qualifier-eligibility';
import { z } from 'zod';
import type { QualifierView } from './qualifiers-types';
import type { QualifierImportInput, QualifierImportPreview } from './qualifier-import-contract';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
type Source = {
  multiplayerId: number;
  metadata: { name?: string; start_time?: string | null };
  events: { id: number; game?: unknown }[];
  checkpoint: unknown;
  complete: boolean;
  error?: string;
};
type Job = {
  kind: 'QUALIFIER_MP_V1';
  stageId: string;
  sources: Source[];
  witness?: string;
  decisions?: QualifierImportInput['decisions'];
};
async function context(tx: Prisma.TransactionClient, tournamentId: string, stageId: string) {
  tx = scopedDb(tx, tournamentId);
  const stage = await tx.tournamentStage.findUniqueOrThrow({
    where: { id: stageId },
    include: {
      mappool: {
        include: { publishedRevision: { include: { slots: { orderBy: { position: 'asc' } } } } },
      },
    },
  });
  if (
    stage.kind !== 'QUALIFIERS' ||
    stage.archivedAt ||
    stage.mappool?.state !== 'PUBLISHED' ||
    !stage.mappool.publishedRevision?.slots.length
  )
    throw new AppError('Select an active qualifier stage with a published pool.');
  const settings = await tx.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } });
  const tournament = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  const rules = matchRulesSchema.parse({
    ...inheritedRules(stage.matchRules || settings.matchRules, settings.gameplayScoring),
    gameMode: tournament.gameMode,
    teamMode: 'HEAD_TO_HEAD',
  });
  if (tournament.format === 'SOLO') rules.teamSize = 1;
  if (rules.gameplayScoring === 'LAZER')
    throw new AppError('Legacy multiplayer histories cannot verify standardized lazer scores.');
  const policy = qualifierPolicySchema.parse(
    stage.qualifierPolicy || { requiredPlayers: rules.teamSize },
  );
  const teams = await tx.team.findMany({
    where: { status: 'APPROVED' },
    include: teamInclude,
    orderBy: { id: 'asc' },
  });
  const lobbies = await tx.qualifierLobby.findMany({
    where: { stageId, status: { not: 'CANCELLED' } },
    include: { entries: true, scores: true, games: true },
    orderBy: { id: 'asc' },
  });
  const witness = qualifierSourceHash({ stage, rules, policy, teams, lobbies });
  return { stage, rules, policy, teams, lobbies, witness };
}
async function loadJob(actor: Actor, input: QualifierImportInput) {
  const tx = scopedDb(db, actor.tournamentId!);
  if (input.jobId) {
    const record = await tx.refereeImport.findUnique({ where: { id: input.jobId } });
    const job = record?.records as unknown as Job | undefined;
    if (
      !record ||
      record.createdBy !== actor.id ||
      record.expiresAt <= new Date() ||
      job?.kind !== 'QUALIFIER_MP_V1' ||
      job.stageId !== input.stageId
    )
      throw new AppError('Import preview expired or not found.', 404);
    return { record, job };
  }
  if (!input.links.length) throw new AppError('Enter at least one multiplayer link.');
  const sources = [
    ...new Set(input.links.map((link) => Number(link.match(/\/(\d+)\/?$/)![1]))),
  ].map((multiplayerId) => ({
    multiplayerId,
    metadata: {},
    events: [],
    checkpoint: null,
    complete: false,
  }));
  const job: Job = { kind: 'QUALIFIER_MP_V1', stageId: input.stageId, sources };
  const record = await tx.refereeImport.create({
    data: {
      tournamentId: actor.tournamentId!,
      createdBy: actor.id,
      filename: 'Qualifier multiplayer histories',
      fingerprint: qualifierSourceHash(job),
      records: json(job),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  return { record, job };
}
async function buildPreview(
  actor: Actor,
  job: Job,
  jobId: string,
  fingerprint: string,
): Promise<QualifierImportPreview> {
  const ctx = await context(db, actor.tournamentId!, job.stageId);
  const preview: QualifierImportPreview = {
    jobId,
    fingerprint,
    stageName: ctx.stage.name,
    policy: ctx.policy,
    complete: job.sources.every((source) => source.complete),
    sources: [],
  };
  const owners = new Map(
    job.sources.map((source) => {
      const decision = job.decisions?.find((row) => row.multiplayerId === source.multiplayerId);
      const events = [...source.events]
        .sort((a, b) =>
          ((a.game as { start_time?: string }).start_time || '').localeCompare(
            (b.game as { start_time?: string }).start_time || '',
          ),
        )
        .slice(decision?.warmups || 0);
      const players = events
        .filter((event) =>
          ctx.stage.mappool!.publishedRevision!.slots.some(
            (slot) => slot.beatmapId === (event.game as { beatmap_id?: number }).beatmap_id,
          ),
        )
        .flatMap((event) =>
          ((event.game as { scores?: { user_id: number }[] }).scores || []).map(
            (score) => score.user_id,
          ),
        )
        .filter((id) => !decision?.excludePlayers.includes(id));
      return [
        source.multiplayerId,
        new Set(
          ctx.teams
            .filter((team) => team.members.some((member) => players.includes(member.osuId)))
            .map((team) => team.id),
        ),
      ] as const;
    }),
  );
  for (const source of job.sources) {
    const decision = job.decisions?.find((row) => row.multiplayerId === source.multiplayerId);
    const ordered = source.events
      .filter((event) => event.game)
      .sort((a, b) =>
        ((a.game as { start_time?: string }).start_time || '').localeCompare(
          (b.game as { start_time?: string }).start_time || '',
        ),
      );
    const excluded = new Set(decision?.excludePlayers || []);
    const counting = ordered
      .slice(decision?.warmups || 0)
      .filter((event) =>
        ctx.stage.mappool!.publishedRevision!.slots.some(
          (slot) => slot.beatmapId === (event.game as { beatmap_id?: number }).beatmap_id,
        ),
      );
    const observedIds = new Set(
      counting.flatMap((event) =>
        ((event.game as { scores?: { user_id: number }[] }).scores || []).map(
          (score) => score.user_id,
        ),
      ),
    );
    const ids = new Set([...observedIds].filter((id) => !excluded.has(id)));
    const group = new Set([source.multiplayerId]),
      groupTeams = new Set(owners.get(source.multiplayerId));
    let previous = -1;
    while (previous !== group.size) {
      previous = group.size;
      for (const other of job.sources)
        if (
          [...(owners.get(other.multiplayerId) || [])].some((id) => groupTeams.has(id)) ||
          (!!decision?.lobbyId &&
            job.decisions?.find((row) => row.multiplayerId === other.multiplayerId)?.lobbyId ===
              decision.lobbyId)
        ) {
          group.add(other.multiplayerId);
          for (const id of owners.get(other.multiplayerId) || []) groupTeams.add(id);
        }
    }
    const teams = ctx.teams.filter((team) => groupTeams.has(team.id));
    const unknownPlayers = [...ids].filter(
      (id) => !teams.some((team) => team.members.some((member) => member.osuId === id)),
    );
    const existing = ctx.lobbies.filter((lobby) =>
      lobby.entries.some((entry) => teams.some((team) => team.id === entry.teamId)),
    );
    const target = decision?.lobbyId
      ? ctx.lobbies.find((lobby) => lobby.id === decision.lobbyId)
      : existing.length === 1
        ? existing[0]
        : undefined;
    const issues: string[] = [];
    if (source.error) issues.push(source.error);
    try {
      assertQualifierCapacity(teams.map(rosterSnapshot), ctx.policy, target?.capacity || 16);
    } catch (error) {
      issues.push((error as Error).message);
    }
    if (!teams.length) issues.push('No approved tournament entrants were identified.');
    if (existing.length > 1 || (decision?.lobbyId && !target))
      issues.push(
        'Players belong to different sessions. Correct the session assignments before importing.',
      );
    if (target && teams.some((team) => !target.entries.some((entry) => entry.teamId === team.id)))
      issues.push('Assign all identified entrants to the selected session before importing.');
    if (
      target &&
      (target.deletedAt ||
        (!['SCHEDULED', 'IN_PROGRESS'].includes(target.status) &&
          !(target.status === 'COMPLETED' && target.autoCompleted)) ||
        target.poolRevisionId !== ctx.stage.mappool!.publishedRevisionId ||
        canonicalQualifierJson(target.policy) !== canonicalQualifierJson(ctx.policy))
    )
      issues.push('Reopen the session and verify its frozen stage configuration before importing.');
    const lobby = target
      ? await currentQualifier(actor, target.id)
      : ({
          rules: ctx.rules,
          policy: ctx.policy,
          events: [],
          participants: teams.map(rosterSnapshot),
          poolRevision: ctx.stage.mappool!.publishedRevision!,
          games: [],
          scores: [],
        } as unknown as QualifierView);
    const playedWarmups = new Set(
      ordered
        .slice(0, decision?.warmups || 0)
        .map((event) => String((event.game as { id: number }).id)),
    );
    const receiptRows = source.events
      .filter((event) => event.game)
      .map((event) => {
        const game = event.game as { id: number; beatmap_id?: number; start_time?: string };
        const saved = lobby.games.find(
          (row) => row.multiplayerId === source.multiplayerId && row.gameId === String(game.id),
        );
        if (saved)
          return playedWarmups.has(String(game.id))
            ? { ...saved, status: 'IGNORED', reason: 'Excluded warmup game.' }
            : { ...saved, evidence: { ...(saved.evidence as object), game: event.game } };
        const ignore =
          playedWarmups.has(String(game.id)) ||
          (typeof game.beatmap_id === 'number' &&
            !lobby.poolRevision.slots.some((slot) => slot.beatmapId === game.beatmap_id)) ||
          decision?.games.find((row) => row.gameId === String(game.id))?.ignore;
        return {
          id: '',
          multiplayerId: source.multiplayerId,
          gameId: String(game.id),
          run: null,
          slotName: null,
          evidence: { game },
          status: ignore ? 'IGNORED' : 'PENDING',
          reason: ignore ? 'Organizer import exclusion' : '',
          version: 1,
        };
      });
    const related = job.sources.filter(
      (other) => other.multiplayerId !== source.multiplayerId && group.has(other.multiplayerId),
    );
    const additional = related.flatMap((other) => {
      const choices = job.decisions?.find((row) => row.multiplayerId === other.multiplayerId);
      const ordered = [...other.events].sort((a, b) =>
        ((a.game as { start_time?: string }).start_time || '').localeCompare(
          (b.game as { start_time?: string }).start_time || '',
        ),
      );
      return ordered
        .filter(
          (event) =>
            !lobby.games.some(
              (saved) =>
                saved.multiplayerId === other.multiplayerId &&
                saved.gameId === String((event.game as { id: number }).id),
            ),
        )
        .map((event, index) => ({
          id: '',
          multiplayerId: other.multiplayerId,
          gameId: String((event.game as { id: number }).id),
          run: null,
          slotName: null,
          evidence: { game: event.game },
          status:
            index < (choices?.warmups || 0) ||
            choices?.games.find((game) => game.gameId === String((event.game as { id: number }).id))
              ?.ignore ||
            !lobby.poolRevision.slots.some(
              (slot) => slot.beatmapId === (event.game as { beatmap_id?: number }).beatmap_id,
            )
              ? 'IGNORED'
              : 'PENDING',
          reason: '',
          version: 1,
        }));
    });
    const combined = [
      ...lobby.games.filter((row) => row.multiplayerId !== source.multiplayerId),
      ...receiptRows,
      ...additional,
    ];
    // Roster exclusions affect parsing only; durable evidence retains the original provider payload.
    const parsing = combined.map((row) => ({
      ...row,
      evidence: (row.evidence as { game?: { scores?: { user_id: number }[] } }).game
        ? {
            ...(row.evidence as object),
            game: {
              ...(row.evidence as { game: object }).game,
              scores: (
                (row.evidence as { game: { scores?: { user_id: number }[] } }).game.scores || []
              ).filter(
                (score) =>
                  !(
                    job.decisions?.find((decision) => decision.multiplayerId === row.multiplayerId)
                      ?.excludePlayers || []
                  ).includes(score.user_id),
              ),
            },
          }
        : row.evidence,
    }));
    const plan = qualifierCapturePlan({ ...lobby, games: parsing }, { historical: true });
    const games = plan.games
      .filter((candidate) => candidate.row.multiplayerId === source.multiplayerId)
      .map((candidate) => {
        const choice = decision?.games.find((row) => row.gameId === candidate.row.gameId);
        let proposal = candidate.proposal || null;
        if (proposal && choice?.corrections.length)
          proposal = {
            ...proposal,
            players: proposal.players.map((player) => {
              const correction = choice.corrections.find((row) => row.osuId === player.osuId);
              const corrected: QualifierCapture['players'][number] = correction
                ? { ...correction }
                : player;
              const category = lobby.poolRevision.slots.find(
                (s) => s.name === proposal!.slotName,
              )!.category;
              return {
                ...corrected,
                violation:
                  corrected.violation ||
                  qualifierScoreViolation(lobby.rules, category, corrected.mods) ||
                  undefined,
              };
            }),
          };
        const ignored = choice?.ignore ?? candidate.row.status === 'IGNORED';
        const issue = ignored
          ? null
          : choice?.run && choice.run <= lobby.policy.runs && candidate.proposal
            ? null
            : candidate.issue;
        return {
          gameId: candidate.row.gameId,
          recordId: candidate.row.id || undefined,
          proposal,
          run: choice?.run || candidate.run,
          issue,
          ignored,
          accepted: candidate.row.status === 'ACCEPTED',
          teams: proposal
            ? lobby.participants.map((team) => {
                const players = proposal!.players.filter(
                  (player) =>
                    !player.violation &&
                    team.members.some((member) => member.osuId === player.osuId),
                );
                let value: number | null = null;
                try {
                  value = qualifierTeamModViolation(
                    lobby.rules,
                    lobby.poolRevision.slots.find((s) => s.name === proposal!.slotName)!.category,
                    players,
                  )
                    ? null
                    : (qualifierTeamAggregate(
                        players.map((player) => ({
                          ...player,
                          adjusted: convertedScore(
                            lobby.rules,
                            player.raw,
                            player.mods,
                            proposal!.slotName,
                          ).adjusted,
                        })),
                        lobby.policy,
                      )?.value ?? null);
                } catch {
                  /* Canonical writer reports invalid mods without inventing a value. */
                }
                return { name: team.name, players: players.length, value };
              })
            : [],
        };
      });
    preview.sources.push({
      multiplayerId: source.multiplayerId,
      name: source.metadata.name || `mp ${source.multiplayerId}`,
      complete: source.complete,
      lobbyId: target?.id || null,
      lobbyCode: target?.code || null,
      players: [...observedIds].map((osuId) => {
        const team = ctx.teams.find((team) =>
          team.members.some((member) => member.osuId === osuId),
        );
        return {
          osuId,
          username:
            team?.members.find((member) => member.osuId === osuId)?.participant.username || null,
          teamName: team?.name || null,
        };
      }),
      teams: teams.map((team) => ({ id: team.id, name: team.name })),
      unknownPlayers,
      issues,
      games,
    });
  }
  return preview;
}

export async function previewQualifierImport(actor: Actor, input: QualifierImportInput) {
  assertPermission(actor, 'matches.manage');
  const { record, job } = await loadJob(actor, input);
  if (
    input.jobId &&
    job.sources.every((source) => source.complete) &&
    canonicalQualifierJson(job.decisions || []) === canonicalQualifierJson(input.decisions)
  )
    for (const source of job.sources) {
      source.complete = false;
      source.checkpoint = null;
    }
  // Bound a bulk request below the shared provider budget; every continuation persists.
  const pagesPerSource = Math.min(
    6,
    Math.max(
      1,
      Math.floor(24 / Math.max(1, job.sources.filter((source) => !source.complete).length)),
    ),
  );
  for (const source of job.sources) {
    if (source.complete) continue;
    let page: Awaited<ReturnType<typeof collectMultiplayerPages>>;
    try {
      page = await collectMultiplayerPages(
        source.multiplayerId,
        (path) => osuGet(path, undefined, '0'),
        source.checkpoint,
        pagesPerSource,
      );
      delete source.error;
    } catch (error) {
      source.error =
        error instanceof AppError
          ? error.message
          : 'osu! could not return data. Please try again shortly.';
      continue;
    }
    source.metadata = page.metadata;
    source.checkpoint = page.checkpoint;
    source.complete = page.complete;
    const events = new Map(source.events.map((event) => [event.id, event]));
    for (const value of page.events) {
      const event = z.object({ id: z.number(), game: z.unknown().optional() }).parse(value);
      if (event.game) events.set(event.id, { id: event.id, game: event.game });
    }
    source.events = [...events.values()];
  }
  job.decisions = input.decisions;
  job.witness = (await context(db, actor.tournamentId!, job.stageId)).witness;
  if (JSON.stringify(job).length > 16000000)
    throw new AppError('Import evidence is too large. Use fewer multiplayer links.', 413);
  const fingerprint = qualifierSourceHash(job);
  const saved = await scopedDb(db, actor.tournamentId!).refereeImport.updateMany({
    where: { id: record.id, fingerprint: record.fingerprint },
    data: { records: json(job), fingerprint },
  });
  if (saved.count !== 1) throw new AppError('The import preview changed. Reload it.', 409);
  return buildPreview(actor, job, record.id, fingerprint);
}

export async function applyQualifierImport(actor: Actor, input: QualifierImportInput) {
  assertPermission(actor, 'matches.manage');
  const { record, job } = await loadJob(actor, input);
  if (
    !input.fingerprint ||
    record.fingerprint !== input.fingerprint ||
    !job.sources.every((source) => source.complete) ||
    canonicalQualifierJson(job.decisions || []) !== canonicalQualifierJson(input.decisions)
  )
    throw new AppError('Review the complete current import preview first.', 409);
  const preview = await buildPreview(actor, job, record.id, record.fingerprint);
  if (preview.sources.some((source) => source.issues.length))
    throw new AppError(
      'Resolve the import warnings or explicitly exclude those games before importing.',
      409,
    );
  const targets = await db.$transaction(
    async (root) => {
      await root.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
      actor = await refreshedQualifierActor(root, actor);
      assertPermission(actor, 'matches.manage');
      const tx = scopedDb(root, actor.tournamentId!);
      const reviewed = await tx.refereeImport.findUnique({ where: { id: record.id } });
      if (
        !reviewed ||
        reviewed.fingerprint !== input.fingerprint ||
        reviewed.createdBy !== actor.id ||
        reviewed.expiresAt <= new Date()
      )
        throw new AppError('The import preview changed. Reload it.', 409);
      const ctx = await context(tx, actor.tournamentId!, job.stageId);
      if (ctx.witness !== job.witness)
        throw new AppError('Stage, rosters or sessions changed. Refresh the import preview.', 409);
      await assertQualifierMutable(tx, job.stageId, actor.tournamentId!);
      const targets: { id: string; multiplayerId: number; version: number }[] = [];
      for (const source of preview.sources) {
        const evidence = job.sources.find((row) => row.multiplayerId === source.multiplayerId)!;
        let target = source.lobbyId
          ? await tx.qualifierLobby.findUniqueOrThrow({ where: { id: source.lobbyId } })
          : null;
        if (!target) {
          // Earlier links in this batch may already have established the entrant's session.
          const existing = await tx.qualifierLobby.findMany({
            where: {
              stageId: job.stageId,
              status: { not: 'CANCELLED' },
              entries: { some: { teamId: { in: source.teams.map((team) => team.id) } } },
            },
            include: { entries: true },
          });
          if (
            existing.length === 1 &&
            source.teams.every((team) =>
              existing[0].entries.some((entry) => entry.teamId === team.id),
            )
          )
            target = existing[0];
          else if (existing.length)
            throw new AppError(
              'These sources require a shared session. Assign all entrants to an existing session before importing.',
              409,
            );
        }
        if (!target) {
          const baseCode = `MP-${source.multiplayerId}`;
          let code = baseCode,
            suffix = 1;
          while (
            await tx.qualifierLobby.findUnique({
              where: { tournamentId_code: { tournamentId: actor.tournamentId!, code } },
            })
          )
            code = `${baseCode}-${++suffix}`;
          const created = await applyQualifierAction(
            tx,
            actor,
            qualifierActionSchema.parse({
              type: 'qualifier.create',
              code,
              stageId: job.stageId,
              teamIds: source.teams.map((team) => team.id),
              refereeIds: [],
              scheduledAt:
                source.games.find((game) => game.proposal)?.proposal?.startedAt ||
                evidence.metadata.start_time ||
                null,
              bookingOpen: false,
              notes: 'Externally refereed qualifier multiplayer history',
            }),
          );
          target = await tx.qualifierLobby.findUniqueOrThrow({ where: { id: created.id } });
        }
        let version = target.version;
        if (!target.lobbyUrl)
          version = (
            await applyQualifierAction(tx, actor, {
              type: 'qualifier.lobby',
              id: target.id,
              baseVersion: version,
              lobbyUrl: `https://osu.ppy.sh/community/matches/${source.multiplayerId}`,
            })
          ).version!;
        if (target.status === 'SCHEDULED')
          version = (
            await applyQualifierAction(
              tx,
              actor,
              {
                type: 'qualifier.status',
                id: target.id,
                baseVersion: version,
                command: 'START',
                reason: input.reason,
              },
              undefined,
              { multiplayerId: source.multiplayerId },
            )
          ).version!;
        for (const game of source.games) {
          const raw = evidence.events.find(
            (event) => String((event.game as { id?: number })?.id) === game.gameId,
          );
          const before = await tx.qualifierGame.findUnique({
            where: {
              lobbyId_multiplayerId_gameId: {
                lobbyId: target.id,
                multiplayerId: source.multiplayerId,
                gameId: game.gameId,
              },
            },
          });
          if (before) {
            const previousExcluded = z
              .array(z.number())
              .catch([])
              .parse((before.evidence as { excludedPlayers?: unknown }).excludedPlayers);
            const currentExcluded =
              job.decisions?.find((d) => d.multiplayerId === source.multiplayerId)
                ?.excludePlayers || [];
            const updatedEvidence = {
              ...(before.evidence as object),
              game: raw!.game,
              match: evidence.metadata,
              ...(previousExcluded.length || currentExcluded.length
                ? { excludedPlayers: [...new Set([...previousExcluded, ...currentExcluded])] }
                : {}),
            };
            if (
              canonicalQualifierJson(updatedEvidence) !== canonicalQualifierJson(before.evidence)
            ) {
              await tx.qualifierGame.update({
                where: { id: before.id },
                data: { evidence: json(updatedEvidence), version: { increment: 1 } },
              });
              await tx.qualifierEvent.create({
                data: {
                  lobbyId: target.id,
                  version: ++version,
                  actorId: actor.id,
                  kind: 'qualifier.source.updated',
                  reason: input.reason,
                  data: json({
                    gameId: game.gameId,
                    before: before.evidence,
                    after: updatedEvidence,
                  }),
                },
              });
              await tx.qualifierLobby.update({ where: { id: target.id }, data: { version } });
            }
            continue;
          }
          await tx.qualifierGame.create({
            data: {
              lobbyId: target.id,
              multiplayerId: source.multiplayerId,
              gameId: game.gameId,
              evidence: json({
                game: raw!.game,
                match: evidence.metadata,
                excludedPlayers:
                  job.decisions?.find((decision) => decision.multiplayerId === source.multiplayerId)
                    ?.excludePlayers || [],
                warmups:
                  job.decisions?.find((decision) => decision.multiplayerId === source.multiplayerId)
                    ?.warmups || 0,
              }),
              status: game.ignored ? 'IGNORED' : 'PENDING',
              reason: game.ignored ? input.reason : game.issue || '',
              startedAt: game.proposal ? new Date(game.proposal.startedAt) : null,
            },
          });
          await tx.qualifierEvent.create({
            data: {
              lobbyId: target.id,
              actorId: actor.id,
              version: ++version,
              kind: 'qualifier.source.imported',
              reason: input.reason,
              data: {
                multiplayerId: source.multiplayerId,
                gameId: game.gameId,
                ignored: game.ignored,
                fingerprint: record.fingerprint,
              },
            },
          });
          await tx.qualifierLobby.update({ where: { id: target.id }, data: { version } });
        }
        const exclusions =
          job.decisions?.find((d) => d.multiplayerId === source.multiplayerId)?.excludePlayers ||
          [];
        if (exclusions.length) {
          const affected = await tx.qualifierScore.findMany({
            where: {
              lobbyId: target.id,
              osuId: { in: exclusions },
              eligible: true,
              gameId: { startsWith: `${source.multiplayerId}:` },
            },
          });
          if (affected.length)
            version = (
              await applyQualifierAction(tx, actor, {
                type: 'qualifier.scores.resolve',
                id: target.id,
                baseVersion: version,
                scoreIds: affected.map((s) => s.id),
                eligible: false,
                reason: input.reason,
              })
            ).version!;
        }
        targets.push({ id: target.id, multiplayerId: source.multiplayerId, version });
      }
      return targets;
    },
    { timeout: 30000 },
  );
  let imported = 0,
    skipped = 0;
  const errors: string[] = [];
  const versions = new Map(targets.map((target) => [target.id, target.version]));
  for (const target of targets) {
    const source = preview.sources.find((row) => row.multiplayerId === target.multiplayerId)!;
    for (const game of source.games) {
      if (game.ignored) {
        const lobby = await currentQualifier(actor, target.id);
        const saved = lobby.games.find(
          (row) => row.multiplayerId === target.multiplayerId && row.gameId === game.gameId,
        );
        if (saved && saved.status !== 'IGNORED') {
          const result = await ignoreQualifierGame(
            actor,
            target.id,
            saved.id,
            versions.get(target.id)!,
            input.reason,
            true,
          );
          versions.set(target.id, result.version);
        }
        continue;
      }
      if (!game.proposal || !game.run || game.issue) continue;
      const choice = job.decisions
        ?.find((row) => row.multiplayerId === source.multiplayerId)
        ?.games.find((row) => row.gameId === game.gameId);
      try {
        const result = await captureQualifierGame(actor, target.id, game.proposal, game.run, {
          multiplayerId: target.multiplayerId,
          historical: true,
          baseVersion: versions.get(target.id),
          replace: choice?.replace,
          reason: input.reason,
          source: 'IMPORT',
          verified: true,
        });
        versions.set(target.id, result.version);
        imported += result.imported;
        skipped += result.skipped;
      } catch (error) {
        errors.push(
          `mp ${target.multiplayerId}, ${game.gameId}: ${error instanceof AppError ? error.message : 'This game cannot be imported. Review the preview warnings.'}`,
        );
        continue;
      }
    }
  }
  for (const id of new Set(targets.map((target) => target.id)))
    await completeImportedQualifier(actor, id);
  return { imported, skipped, errors, sessions: [...new Set(targets.map((target) => target.id))] };
}
