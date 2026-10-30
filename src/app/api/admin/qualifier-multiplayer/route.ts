import { z } from 'zod';
import { requireTournamentActor } from '@/lib/auth';
import {
  syncQualifier,
  captureQualifierGame,
  currentQualifier,
  ignoreQualifierGame,
} from '@/lib/qualifier-capture-service';
import { qualifierGameProposals } from '@/lib/qualifier-multiplayer';
import { AppError } from '@/lib/permissions';
import { errorResponse, jsonBody, requireSameOrigin, rateLimit } from '@/lib/security';

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const actor = await requireTournamentActor();
    const input = z
      .object({
        id: z.string().min(1).max(100),
        sync: z.boolean().default(false),
        run: z.number().int().min(1).max(2).default(1),
        gameId: z.string().regex(/^\d+$/).optional(),
        recordId: z.string().min(1).max(100).optional(),
        ignore: z.boolean().default(false),
        removeScores: z.boolean().default(false),
        baseVersion: z.number().int().positive().optional(),
        replace: z.boolean().default(false),
        reason: z.string().trim().min(3).max(2000).optional(),
        excludePlayers: z.array(z.number().int().positive()).max(16).default([]),
      })
      .parse(await jsonBody(request));
    await rateLimit(`qualifier-sync:${actor.id}:${input.id}`, 12, 60);
    if (input.ignore) {
      if (!input.recordId || !input.reason || !input.baseVersion)
        throw new AppError('Review the current preview and provide a capture reason.', 409);
      return Response.json(
        await ignoreQualifierGame(
          actor,
          input.id,
          input.recordId,
          input.baseVersion,
          input.reason,
          input.removeScores,
        ),
      );
    }
    const preview = await syncQualifier(actor, input.id, { apply: input.sync });
    if (!input.gameId)
      return Response.json(preview, { headers: { 'Cache-Control': 'private, no-store' } });
    if (!preview.complete)
      throw new AppError('Complete multiplayer history must finish loading before capture.', 409);
    if (!input.reason || input.baseVersion !== preview.version)
      throw new AppError('Review the current preview and provide a capture reason.', 409);
    const lobby = await currentQualifier(actor, input.id);
    const row = lobby.games.find(
      (game) =>
        game.gameId === input.gameId &&
        game.multiplayerId === Number(lobby.lobbyUrl.match(/\/(\d+)\/?$/)?.[1]),
    );
    const proposal =
      input.excludePlayers.length && row
        ? qualifierGameProposals([row.evidence], lobby, { excludePlayers: input.excludePlayers })
            .proposals[0]
        : preview.proposals.find((game) => game.gameId === input.gameId);
    if (!proposal)
      throw new AppError('This game cannot be imported. Review the preview warnings.', 409);
    return Response.json(
      await captureQualifierGame(actor, input.id, proposal, input.run, {
        multiplayerId: Number(lobby.lobbyUrl.match(/\/(\d+)\/?$/)?.[1]),
        baseVersion: input.baseVersion,
        replace: input.replace,
        reason: input.reason,
      }),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
