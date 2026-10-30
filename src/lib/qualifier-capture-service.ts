import { z } from 'zod';
import { db } from './db';
import { scopedDb } from './scoped-db';
import { AppError, can, type Actor } from './permissions';
import { matchAccess } from './match-access';
import { actorForTournament } from './auth';
import { qualifierData, applyQualifierAction } from './qualifiers-service';
import { qualifierActionSchema } from './qualifiers-validation';
import { qualifierCapturePlan, type QualifierCapture } from './qualifier-multiplayer';
import { collectMultiplayerPages } from './multiplayer';
import { osuGet } from './osu';
import { assertQualifierMutable } from './qualifier-standings-service';
import { canonicalQualifierJson } from './qualifier-seeding';
import type { QualifierView } from './qualifiers-types';
import type { Prisma } from '@/generated/prisma/client';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const urlFor = (id: string) => new URL(`https://local.invalid/?id=${encodeURIComponent(id)}`);
export async function currentQualifier(actor: Actor, id: string) {
  const lobby = (await qualifierData(actor, urlFor(id))).lobbies[0];
  // Capture needs timing witnesses even when the operator cannot browse private history.
  if (lobby.access.score)
    lobby.events = await scopedDb(db, actor.tournamentId!).qualifierEvent.findMany({
      where: { lobbyId: id },
      include: { actor: { select: { username: true } } },
      orderBy: { version: 'desc' },
    });
  return JSON.parse(JSON.stringify(lobby)) as QualifierView;
}
export async function refreshedQualifierActor(tx: Prisma.TransactionClient, actor: Actor) {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: actor.id },
    include: {
      roles: {
        where: { tournamentId: actor.tournamentId! },
        include: { role: { include: { permissions: true } } },
      },
    },
  });
  return actorForTournament(user, actor.tournamentId!);
}
function multiplayerId(lobby: QualifierView) {
  const id = Number(lobby.lobbyUrl.match(/\/(\d+)\/?$/)?.[1]);
  if (!id) throw new AppError('Link the multiplayer room first.');
  return id;
}
function assertCapture(lobby: QualifierView) {
  if (!lobby.access.score)
    throw new AppError('Only assigned or authorized referees can capture qualifier scores.', 403);
  if (lobby.status !== 'IN_PROGRESS')
    throw new AppError('Start or reopen the qualifier session first.', 409);
  if (lobby.gameplayScoring === 'LAZER')
    throw new AppError('Legacy matches cannot verify standardized lazer scores.', 409);
}
// This is the sole API/import writer. Manual entry uses the very same qualifier.score owner.
export async function captureQualifierGame(
  actor: Actor,
  id: string,
  proposal: QualifierCapture,
  run: number,
  options: {
    multiplayerId: number;
    historical?: boolean;
    baseVersion?: number;
    replace?: boolean;
    reason: string;
    source?: 'OSU_API' | 'IMPORT';
    verified?: boolean;
  },
) {
  return db.$transaction(
    async (root) => {
      await root.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
      actor = await refreshedQualifierActor(root, actor);
      const tx = scopedDb(root, actor.tournamentId!);
      const record = await tx.qualifierLobby.findUniqueOrThrow({
        where: { id },
        include: { assignments: true, scores: true, games: true },
      });
      const access = matchAccess(actor, record);
      const lobby = { ...record, access };
      if (!access.score || record.status !== 'IN_PROGRESS')
        throw new AppError('Qualifier scoring access changed. Reload.', 409);
      if (options.baseVersion !== undefined && record.version !== options.baseVersion)
        throw new AppError('The qualifier session changed. Reload the preview.', 409);
      await assertQualifierMutable(tx, record.stageId, actor.tournamentId!);
      const mp = options.multiplayerId;
      if (
        (!options.historical && mp !== Number(record.lobbyUrl.match(/\/(\d+)\/?$/)?.[1])) ||
        (options.historical && !can(actor, 'matches.manage'))
      )
        throw new AppError('Lobby binding changed. Reload before capturing scores.', 409);
      const captureId = `${mp}:${proposal.gameId}`;
      const receipt = record.games.find(
        (game) => game.multiplayerId === mp && game.gameId === proposal.gameId,
      );
      if (receipt?.run && receipt.run !== run)
        throw new AppError(
          'This multiplayer game is already recorded in another run. Each run requires a distinct performance.',
          409,
        );
      if (receipt?.status === 'ACCEPTED' && !options.replace)
        return { imported: 0, skipped: proposal.players.length, version: record.version };
      if (
        await tx.qualifierScore.findFirst({
          where: {
            gameId: captureId,
            osuId: { in: proposal.players.map((player) => player.osuId) },
            OR: [{ run: { not: run } }, { lobbyId: { not: id } }],
            lobby: { stageId: record.stageId, tournamentId: actor.tournamentId! },
          },
        })
      )
        throw new AppError(
          'This multiplayer game is already recorded in another run. Each run requires a distinct performance.',
          409,
        );
      let version = lobby.version,
        imported = 0,
        skipped = 0;
      for (const player of proposal.players) {
        const previous = record.scores.find(
          (score) =>
            score.osuId === player.osuId &&
            score.slotName === proposal.slotName &&
            score.run === run,
        );
        if (
          previous?.gameId === captureId &&
          previous.raw === player.raw &&
          canonicalQualifierJson(previous.mods) === canonicalQualifierJson(player.mods)
        ) {
          skipped++;
          continue;
        }
        if (previous && !options.replace)
          throw new AppError(
            'A score already exists in this run. Explicitly approve replacement after reviewing the game.',
            409,
          );
        const result = await applyQualifierAction(
          tx,
          actor,
          qualifierActionSchema.parse({
            type: 'qualifier.score',
            id,
            baseVersion: version,
            run,
            osuId: player.osuId,
            slotName: proposal.slotName,
            raw: player.raw,
            mods: player.mods,
            reason: options.reason,
          }),
          {
            source: options.source || 'OSU_API',
            gameId: captureId,
            verified: options.verified ?? true,
          },
        );
        version = result.version!;
        imported++;
      }
      await tx.qualifierGame.upsert({
        where: {
          lobbyId_multiplayerId_gameId: { lobbyId: id, multiplayerId: mp, gameId: proposal.gameId },
        },
        create: {
          lobbyId: id,
          multiplayerId: mp,
          gameId: proposal.gameId,
          slotName: proposal.slotName,
          run,
          status: 'ACCEPTED',
          evidence: json({ proposal }),
          reason: options.reason,
        },
        update: {
          run,
          slotName: proposal.slotName,
          status: 'ACCEPTED',
          reason: options.reason,
          evidence: json({ ...((receipt?.evidence as object) || {}), proposal }),
          version: { increment: 1 },
        },
      });
      await tx.qualifierLobby.update({
        where: { id, version },
        data: { version: { increment: 1 } },
      });
      await tx.qualifierEvent.create({
        data: {
          lobbyId: id,
          actorId: actor.id,
          version: version + 1,
          kind: 'qualifier.capture',
          reason: options.reason,
          data: json({
            multiplayerId: mp,
            gameId: proposal.gameId,
            run,
            source: options.source || 'OSU_API',
            players: proposal.players,
            imported,
            skipped,
          }),
        },
      });
      await tx.auditLog.create({
        data: {
          tournamentId: actor.tournamentId!,
          actorId: actor.id,
          action: 'qualifier.multiplayer.capture',
          entityType: 'QualifierLobby',
          entityId: id,
          details: json({
            gameId: proposal.gameId,
            run,
            imported,
            skipped,
            reason: options.reason,
          }),
        },
      });
      return { imported, skipped, version: version + 1 };
    },
    { timeout: 30000 },
  );
}

export async function syncQualifier(actor: Actor, id: string, options: { apply?: boolean } = {}) {
  const lobby = await currentQualifier(actor, id);
  assertCapture(lobby);
  const mp = multiplayerId(lobby);
  const state = (lobby.multiplayerSync || {}) as { checkpoint?: unknown; complete?: boolean };
  let history: Awaited<ReturnType<typeof collectMultiplayerPages>>;
  try {
    history = await collectMultiplayerPages(
      mp,
      (path) => osuGet(path, undefined, '0'),
      state.checkpoint,
    );
  } catch (error) {
    await db.$transaction(async (root) => {
      await root.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
      const current = await refreshedQualifierActor(root, actor);
      const tx = scopedDb(root, actor.tournamentId!);
      const record = await tx.qualifierLobby.findUniqueOrThrow({
        where: { id },
        include: { assignments: true },
      });
      if (
        matchAccess(current, record).score &&
        record.lobbyUrl === lobby.lobbyUrl &&
        record.version === lobby.version &&
        record.status === 'IN_PROGRESS'
      )
        await tx.qualifierLobby.update({
          where: { id },
          data: {
            multiplayerError: 'osu! score synchronization failed. Retry or use multiplayer import.',
          },
        });
    });
    throw error;
  }
  await db.$transaction(
    async (root) => {
      await root.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
      const current = await refreshedQualifierActor(root, actor);
      const tx = scopedDb(root, actor.tournamentId!);
      const fresh = await tx.qualifierLobby.findUniqueOrThrow({
        where: { id },
        include: { assignments: true, games: true },
      });
      if (
        !matchAccess(current, fresh).score ||
        fresh.status !== 'IN_PROGRESS' ||
        fresh.version !== lobby.version ||
        fresh.lobbyUrl !== lobby.lobbyUrl
      )
        throw new AppError('The qualifier session changed. Reload the preview.', 409);
      await assertQualifierMutable(tx, fresh.stageId, actor.tournamentId!);
      let received = 0;
      for (const event of history.events) {
        const source = z
          .object({ game: z.object({ id: z.number().int().positive() }).passthrough().optional() })
          .safeParse(event);
        if (!source.success || !source.data.game) continue;
        const game = source.data.game;
        const key = String(game.id);
        const previous = fresh.games.find((row) => row.multiplayerId === mp && row.gameId === key);
        if (previous?.status === 'ACCEPTED' || previous?.status === 'IGNORED') continue;
        if (
          previous &&
          canonicalQualifierJson(previous.evidence) ===
            canonicalQualifierJson({ game, match: history.metadata })
        )
          continue;
        const started = lobby.events
          .filter(
            (event) =>
              event.kind === 'qualifier.status' &&
              (event.data as { command?: string })?.command === 'START',
          )
          .map((event) => new Date(event.createdAt).getTime())
          .sort((a, b) => a - b)[0];
        const gameTime = z.iso.datetime({ offset: true }).safeParse(game.start_time);
        const knownMap = lobby.poolRevision.slots.some(
          (slot) => slot.beatmapId === game.beatmap_id,
        );
        const playerIds = z.array(z.object({ user_id: z.number() })).safeParse(game.scores);
        const hasEntrant =
          playerIds.success &&
          playerIds.data.some((score) =>
            lobby.participants.some((team) =>
              team.members.some((player) => player.osuId === score.user_id),
            ),
          );
        const selected = gameTime.success
          ? lobby.events
              .filter(
                (event) =>
                  event.kind === 'qualifier.map' &&
                  new Date(event.createdAt).getTime() <= new Date(gameTime.data).getTime(),
              )
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
          : null;
        const ignored =
          typeof game.beatmap_id === 'number' && !knownMap
            ? 'Map outside the qualifier pool'
            : started && gameTime.success && new Date(gameTime.data).getTime() < started
              ? 'Game before the website qualifier start'
              : (selected?.data as { warmup?: boolean })?.warmup
                ? 'Referee selected warmup mode'
                : playerIds.success && playerIds.data.length > 0 && !hasEntrant
                  ? 'Game has no players from this qualifier session'
                  : '';
        await tx.qualifierGame.upsert({
          where: { lobbyId_multiplayerId_gameId: { lobbyId: id, multiplayerId: mp, gameId: key } },
          create: {
            lobbyId: id,
            multiplayerId: mp,
            gameId: key,
            startedAt: gameTime.success ? new Date(gameTime.data) : null,
            evidence: json({ game, match: history.metadata }),
            ...(ignored ? { status: 'IGNORED', reason: ignored } : {}),
          },
          update: {
            evidence: json({ game, match: history.metadata }),
            version: { increment: 1 },
            ...(ignored ? { status: 'IGNORED', reason: ignored } : {}),
          },
        });
        received++;
      }
      await tx.qualifierLobby.update({
        where: { id },
        data: {
          multiplayerSync: json({
            checkpoint: history.checkpoint,
            complete: history.complete,
            metadata: history.metadata,
          }),
          multiplayerSyncedAt: new Date(),
          multiplayerError: null,
          ...(received ? { version: { increment: 1 } } : {}),
        },
      });
      if (received)
        await tx.qualifierEvent.create({
          data: {
            lobbyId: id,
            actorId: actor.id,
            version: fresh.version + 1,
            kind: 'qualifier.source.received',
            data: { games: received },
          },
        });
    },
    { timeout: 30000 },
  );
  let fresh = await currentQualifier(actor, id);
  let plan = qualifierCapturePlan(fresh);
  let imported = 0,
    skipped = 0;
  if (history.complete && options.apply) {
    let version = fresh.version;
    for (const candidate of plan.games) {
      if (
        candidate.row.multiplayerId !== mp ||
        !candidate.proposal ||
        candidate.issue ||
        !candidate.run ||
        ['ACCEPTED', 'IGNORED'].includes(candidate.row.status)
      )
        continue;
      try {
        const result = await captureQualifierGame(actor, id, candidate.proposal, candidate.run, {
          multiplayerId: mp,
          baseVersion: version,
          reason: 'Automatic website qualifier score synchronization',
        });
        version = result.version;
        imported += result.imported;
        skipped += result.skipped;
      } catch (error) {
        const reason =
          error instanceof AppError
            ? error.message
            : 'This game cannot be imported. Review the preview warnings.';
        await db.$transaction(async (root) => {
          await root.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
          const current = await refreshedQualifierActor(root, actor);
          const tx = scopedDb(root, actor.tournamentId!);
          const record = await tx.qualifierLobby.findUniqueOrThrow({
            where: { id },
            include: { assignments: true },
          });
          if (
            !matchAccess(current, record).score ||
            record.status !== 'IN_PROGRESS' ||
            record.version !== version
          )
            return;
          await assertQualifierMutable(tx, record.stageId, actor.tournamentId!);
          await tx.qualifierGame.updateMany({
            where: { id: candidate.row.id, status: 'PENDING', reason: { not: reason } },
            data: { reason },
          });
        });
      }
    }
    fresh = await currentQualifier(actor, id);
    plan = qualifierCapturePlan(fresh);
  }
  return {
    complete: history.complete,
    imported,
    skipped,
    version: fresh.version,
    games: plan.games
      .filter((game) => game.row.multiplayerId === mp)
      .map((game) => ({
        recordId: game.row.id,
        gameId: game.row.gameId,
        status: game.row.status,
        issue: game.issue || game.row.reason || null,
        unknownPlayers: (
          (game.row.evidence as { game?: { scores?: { user_id: number }[] } }).game?.scores || []
        )
          .map((score) => score.user_id)
          .filter(
            (id) =>
              !fresh.participants.some((team) =>
                team.members.some((player) => player.osuId === id),
              ),
          ),
      })),
    proposals: plan.games
      .filter((game) => game.row.multiplayerId === mp && game.proposal)
      .map((game) => ({
        ...game.proposal!,
        run: game.run,
        issue: game.issue || game.row.reason || null,
        status: game.row.status,
        recordId: game.row.id,
      })),
    rejected: plan.rejected,
  };
}

export async function ignoreQualifierGame(
  actor: Actor,
  id: string,
  recordId: string,
  baseVersion: number,
  reason: string,
  removeScores: boolean,
) {
  return db.$transaction(
    async (root) => {
      await root.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
      actor = await refreshedQualifierActor(root, actor);
      const tx = scopedDb(root, actor.tournamentId!);
      const lobby = await tx.qualifierLobby.findUniqueOrThrow({
        where: { id },
        include: { assignments: true, scores: true },
      });
      if (
        !matchAccess(actor, lobby).score ||
        lobby.status !== 'IN_PROGRESS' ||
        lobby.version !== baseVersion
      )
        throw new AppError('The qualifier session changed. Reload the preview.', 409);
      await assertQualifierMutable(tx, lobby.stageId, actor.tournamentId!);
      const game = await tx.qualifierGame.findFirst({ where: { id: recordId, lobbyId: id } });
      if (!game) throw new AppError('Multiplayer game not found.', 404);
      const affected = lobby.scores.filter(
        (score) => score.gameId === `${game.multiplayerId}:${game.gameId}`,
      );
      if (affected.length && !removeScores)
        throw new AppError(
          'Confirm removal of the accepted scores before ignoring this game.',
          409,
        );
      let version = lobby.version;
      for (const score of affected) {
        const result = await applyQualifierAction(tx, actor, {
          type: 'qualifier.score.remove',
          id,
          baseVersion: version,
          scoreId: score.id,
          reason,
        });
        version = result.version!;
      }
      await tx.qualifierGame.update({
        where: { id: game.id },
        data: { status: 'IGNORED', reason, version: { increment: 1 } },
      });
      await tx.qualifierLobby.update({
        where: { id, version },
        data: { version: { increment: 1 } },
      });
      await tx.qualifierEvent.create({
        data: {
          lobbyId: id,
          version: version + 1,
          actorId: actor.id,
          kind: 'qualifier.game.ignored',
          reason,
          data: json({
            gameId: game.gameId,
            multiplayerId: game.multiplayerId,
            before: game,
            removedScoreIds: affected.map((score) => score.id),
          }),
        },
      });
      return { id, version: version + 1 };
    },
    { timeout: 30000 },
  );
}
