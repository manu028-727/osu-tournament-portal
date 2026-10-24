import { Prisma } from '@/generated/prisma/client';
import { actorForTournament, requireTournamentActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { matchAccess } from '@/lib/match-access';
import { matchData } from '@/lib/match-queries';
import type { MatchView } from '@/lib/matches-types';
import { collectMultiplayerPages, multiplayerEvidence } from '@/lib/multiplayer';
import { osuGet } from '@/lib/osu';
import { AppError } from '@/lib/permissions';
import { scopedDb } from '@/lib/scoped-db';
import { errorResponse, jsonBody, rateLimit, requireSameOrigin } from '@/lib/security';
import { z } from 'zod';
export async function POST(request: Request) {
  let authorized: {
    id: string;
    tournamentId: string;
    version: number;
    multiplayerId: number;
  } | null = null;
  try {
    requireSameOrigin(request);
    const actor = await requireTournamentActor();
    const { id } = z.object({ id: z.string().min(1).max(100) }).parse(await jsonBody(request));
    const view = (await matchData(
      actor,
      new URL(`https://local.invalid/?id=${encodeURIComponent(id)}`),
      'match',
    )) as unknown as { match: MatchView };
    const m = view.match;
    if (!matchAccess(actor, m).score)
      throw new AppError('Only authorized match operators can synchronize games.', 403);
    if (!m.multiplayerId) throw new AppError('Connect a multiplayer link first.');
    authorized = {
      id,
      tournamentId: actor.tournamentId || 'main',
      version: m.version,
      multiplayerId: m.multiplayerId,
    };
    await rateLimit(`mp:${m.multiplayerId}`, 1, 15);
    const history = await collectMultiplayerPages(m.multiplayerId, osuGet, m.multiplayerSync);
    const games = multiplayerEvidence(history.events, m);
    await scopedDb(db, authorized.tournamentId).$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
      const freshUser = await tx.user.findUniqueOrThrow({
        where: { id: actor.id },
        include: {
          roles: {
            where: { tournamentId: authorized!.tournamentId },
            include: { role: { include: { permissions: true } } },
          },
        },
      });
      const current = await tx.match.findUniqueOrThrow({
        where: { id },
        include: { assignments: true },
      });
      if (!matchAccess(actorForTournament(freshUser, authorized!.tournamentId), current).score)
        throw new AppError('Permission was revoked.', 403);
      if (current.version !== m.version || current.multiplayerId !== m.multiplayerId)
        throw new AppError('Match changed during synchronization. Reload and retry.', 409);
      for (const { evidence, proposal } of games) {
        const where = {
          matchId_multiplayerId_gameId: {
            matchId: id,
            multiplayerId: m.multiplayerId!,
            gameId: evidence.gameId,
          },
        };
        const previous = await tx.multiplayerGame.findUnique({ where });
        if (previous?.confirmedAt) continue;
        const data = {
          beatmapId: evidence.beatmapId,
          slotName: evidence.slotName,
          evidence: JSON.parse(JSON.stringify(evidence)),
          proposal: proposal ? JSON.parse(JSON.stringify(proposal)) : Prisma.DbNull,
        };
        await tx.multiplayerGame.upsert({
          where,
          create: {
            matchId: id,
            multiplayerId: m.multiplayerId!,
            gameId: evidence.gameId,
            ...data,
          },
          update: data,
        });
      }
      await tx.match.update({
        where: { id },
        data: {
          multiplayerSync: history.checkpoint,
          multiplayerSyncedAt: new Date(),
          multiplayerError: null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'match.multiplayer.sync',
          entityType: 'Match',
          entityId: id,
          details: { games: games.length, complete: history.complete },
        },
      });
    });
    return Response.json(
      { games: games.length, complete: history.complete },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e) {
    if (authorized && !(e instanceof AppError && e.status < 500)) {
      await scopedDb(db, authorized.tournamentId)
        .match.updateMany({
          where: {
            id: authorized.id,
            version: authorized.version,
            multiplayerId: authorized.multiplayerId,
          },
          data: {
            multiplayerError: 'Synchronization failed. Manual refereeing remains available.',
          },
        })
        .catch(() => {});
    }
    return errorResponse(e);
  }
}
