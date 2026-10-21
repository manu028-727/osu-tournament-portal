import { z } from 'zod';
import { requireTournamentActor, actorForTournament } from '@/lib/auth';
import { db as rootDb } from '@/lib/db';
import { scopedDb } from '@/lib/scoped-db';
import { qualifierData, applyQualifierAction } from '@/lib/qualifiers-service';
import { qualifierActionSchema } from '@/lib/qualifiers-validation';
import { qualifierGameProposals } from '@/lib/qualifier-multiplayer';
import { collectMultiplayerPages } from '@/lib/multiplayer';
import { osuGet } from '@/lib/osu';
import { AppError } from '@/lib/permissions';
import { matchAccess } from '@/lib/match-access';
import { historicalScoring } from '@/lib/gameplay-scoring';
import { errorResponse, jsonBody, requireSameOrigin, rateLimit } from '@/lib/security';
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const actor = await requireTournamentActor(),
      tournamentId = actor.tournamentId!;
    const input = z
      .object({
        id: z.string().min(1).max(100),
        run: z.number().int().min(1).max(2).default(1),
        gameId: z.string().regex(/^\d+$/).optional(),
        baseVersion: z.number().int().positive().optional(),
        replace: z.boolean().default(false),
        reason: z.string().min(3).max(2000).optional(),
      })
      .parse(await jsonBody(request));
    const data = await qualifierData(
        actor,
        new URL(`https://local.invalid/?id=${encodeURIComponent(input.id)}`),
      ),
      lobby = data.lobbies[0];
    if (!lobby.access.score)
      throw new AppError('Only assigned or authorized referees can capture qualifier scores.', 403);
    if (lobby.status !== 'IN_PROGRESS')
      throw new AppError('Start or reopen the qualifier session first.', 409);
    const multiplayerId = Number(lobby.lobbyUrl.match(/\/(\d+)\/?$/)?.[1]);
    if (!multiplayerId) throw new AppError('Link the multiplayer room first.');
    if (input.run > lobby.policy.runs) throw new AppError('This run is not configured.');
    await rateLimit(`qualifier-sync:${actor.id}:${lobby.id}`, 10, 60);
    const history = await collectMultiplayerPages(multiplayerId, osuGet, null);
    const preview = qualifierGameProposals(history.events, JSON.parse(JSON.stringify(lobby)));
    if (!input.gameId)
      return Response.json(
        { ...preview, complete: history.complete, version: lobby.version },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    if (!history.complete)
      throw new AppError(
        'History exceeds the capture window. Review earlier games manually rather than importing incomplete history.',
        409,
      );
    if (!input.reason || input.baseVersion !== lobby.version)
      throw new AppError('Review the current preview and provide a capture reason.', 409);
    const proposal = preview.proposals.find((p) => p.gameId === input.gameId);
    if (!proposal)
      throw new AppError('This game cannot be imported. Review the preview warnings.', 409);
    const db = scopedDb(rootDb, tournamentId);
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
      const user = await tx.user.findUniqueOrThrow({
        where: { id: actor.id },
        include: {
          roles: { where: { tournamentId }, include: { role: { include: { permissions: true } } } },
        },
      });
      const currentActor = actorForTournament(user, tournamentId);
      const fresh = await tx.qualifierLobby.findUniqueOrThrow({
        where: { id: lobby.id },
        include: { assignments: true },
      });
      if (!matchAccess(currentActor, fresh).score)
        throw new AppError('Permission was revoked.', 403);
      if (fresh.version !== input.baseVersion || fresh.lobbyUrl !== lobby.lobbyUrl)
        throw new AppError('The qualifier session changed. Reload the preview.', 409);
      let version = fresh.version,
        imported = 0,
        skipped = 0;
      const captureId = `${multiplayerId}:${proposal.gameId}`;
      if (
        await tx.qualifierScore.findFirst({
          where: { lobbyId: lobby.id, gameId: captureId, run: { not: input.run } },
        })
      )
        throw new AppError(
          'This multiplayer game is already recorded in another run. Each run requires a distinct performance.',
          409,
        );
      for (const player of proposal.players) {
        const where = {
          lobbyId_osuId_slotName_run: {
            lobbyId: lobby.id,
            osuId: player.osuId,
            slotName: proposal.slotName,
            run: input.run,
          },
        };
        const previous = await tx.qualifierScore.findUnique({ where });
        const gameId = captureId;
        if (
          previous?.gameId === gameId &&
          previous.raw === player.raw &&
          previous.source === 'OSU_API' &&
          JSON.stringify([...(previous.mods as string[])].sort()) ===
            JSON.stringify([...player.mods].sort())
        ) {
          skipped++;
          continue;
        }
        if (previous && !input.replace)
          throw new AppError(
            'A score already exists in this run. Explicitly approve replacement after reviewing the game.',
            409,
          );
        const updated = await applyQualifierAction(
          tx,
          currentActor,
          qualifierActionSchema.parse({
            type: 'qualifier.score',
            id: lobby.id,
            baseVersion: version,
            run: input.run,
            osuId: player.osuId,
            slotName: proposal.slotName,
            raw: player.raw,
            mods: player.mods,
            reason: `${input.reason} · osu! game ${proposal.gameId}`,
          }),
        );
        version = updated.version!;
        await tx.qualifierScore.update({
          where,
          data: {
            source: 'OSU_API',
            gameId,
            actualScoring: historicalScoring(lobby.rules),
            verified: true,
          },
        });
        imported++;
      }
      if (imported) {
        await tx.qualifierLobby.update({
          where: { id: lobby.id, version },
          data: { version: { increment: 1 } },
        });
        version++;
        await tx.qualifierEvent.create({
          data: {
            lobbyId: lobby.id,
            version,
            actorId: actor.id,
            kind: 'qualifier.capture',
            reason: input.reason,
            data: {
              source: 'OSU_API',
              multiplayerId,
              gameId: proposal.gameId,
              run: input.run,
              players: proposal.players,
            },
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          tournamentId,
          action: 'qualifier.multiplayer.capture',
          entityType: 'QualifierLobby',
          entityId: lobby.id,
          details: {
            gameId: proposal.gameId,
            run: input.run,
            imported,
            skipped,
            reason: input.reason,
          },
        },
      });
      return { imported, skipped, version };
    });
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
