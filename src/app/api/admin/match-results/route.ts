import { z } from 'zod';
import { requireTournamentActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { matchData } from '@/lib/match-queries';
import { lobbyInfo } from '@/lib/match-record';
import { resultCorrectionImpact } from '@/lib/match-results-service';
import {
  signMatchResultReview,
  savedImportDecisionSchema,
  verifyMatchResultReview,
} from '@/lib/match-result-review';
import { firstTo } from '@/lib/match-rules';
import type { MatchView } from '@/lib/matches-types';
import { collectMultiplayerPages, multiplayerEvidence } from '@/lib/multiplayer';
import { osuGet } from '@/lib/osu';
import { AppError, assertPermission } from '@/lib/permissions';
import { scopedDb } from '@/lib/scoped-db';
import { errorResponse, jsonBody, rateLimit, requireSameOrigin } from '@/lib/security';

const base = z.object({ id: z.string().min(1).max(100), baseVersion: z.number().int().positive() });
const requestSchema = z.discriminatedUnion('type', [
  base.extend({ type: z.literal('impact'), winnerSide: z.enum(['A', 'B']).nullable() }),
  base.extend({
    type: z.literal('multiplayer'),
    lobbyUrl: z.string().min(1).max(300),
    redSide: z.enum(['A', 'B']).default('A'),
    reviewToken: z.string().max(440000).optional(),
  }),
]);
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const actor = await requireTournamentActor();
    assertPermission(actor, 'matches.manage');
    const input = requestSchema.parse(await jsonBody(request));
    const { match } = (await matchData(
      actor,
      new URL(`https://local.invalid/?id=${encodeURIComponent(input.id)}`),
      'match',
    )) as unknown as { match: MatchView };
    if (match.version !== input.baseVersion)
      throw new AppError('The match changed. Reload before saving.', 409);
    const tenant = scopedDb(db, actor.tournamentId || 'main');
    if (input.type === 'impact') {
      const impact = await tenant.$transaction((tx) =>
        resultCorrectionImpact(tx, actor.tournamentId || 'main', match, input.winnerSide),
      );
      return Response.json(impact, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const { multiplayerId } = lobbyInfo(input.lobbyUrl, null);
    await rateLimit(`organizer-mp:${actor.id}:${multiplayerId}`, 3, 15);
    const priorReview = input.reviewToken
      ? verifyMatchResultReview(
          input.reviewToken,
          actor,
          match.id,
          match.version,
          Date.now(),
          false,
        )
      : null;
    if (
      priorReview &&
      (priorReview.metadata.id !== multiplayerId || priorReview.redSide !== input.redSide)
    )
      throw new AppError('The multiplayer review is invalid. Fetch the lobby again.', 409);
    const history = await collectMultiplayerPages(
      multiplayerId!,
      (path) => osuGet(path, undefined, '20220704'),
      priorReview?.checkpoint || null,
    ).catch((error: unknown) => {
      if (error instanceof AppError && error.status === 404)
        throw new AppError('The multiplayer lobby or its history is unavailable.', 404);
      if (error instanceof AppError) throw error;
      throw new AppError(
        'The osu! multiplayer history could not be verified. Saved results are unchanged.',
        502,
      );
    });
    const fetched = multiplayerEvidence(
      history.events,
      { ...match, multiplayerId },
      { historical: true, redSide: input.redSide },
    );
    const byGame = new Map((priorReview?.games || []).map((game) => [game.evidence.gameId, game]));
    for (const game of fetched) byGame.set(game.evidence.gameId, game);
    const games = [...byGame.values()].sort((a, b) => a.evidence.eventId - b.evidence.eventId);
    if (games.length > 120)
      throw new AppError('This lobby contains too many games for one review. Use manual results.');
    const previous = await tenant.multiplayerGame.findMany({
      where: { matchId: match.id, multiplayerId: multiplayerId! },
      select: { gameId: true, proposal: true },
    });
    let scoreA = 0,
      scoreB = 0;
    const decisions = games.map((game) => {
      const prior = previous.find((row) => row.gameId === game.evidence.gameId)?.proposal;
      const saved = savedImportDecisionSchema.safeParse(
        prior && typeof prior === 'object' && 'organizerReview' in prior
          ? prior.organizerReview
          : null,
      );
      const included = !!game.proposal && Math.max(scoreA, scoreB) < firstTo(match.rules);
      const decision = saved.success
        ? { ...saved.data, gameId: game.evidence.gameId }
        : {
            gameId: game.evidence.gameId,
            included,
            winnerSide: game.proposal?.winnerSide || null,
            reason: '',
          };
      if (decision.included && decision.winnerSide)
        decision.winnerSide === 'A' ? scoreA++ : scoreB++;
      return decision;
    });
    const token = signMatchResultReview({
      actorId: actor.id,
      tournamentId: actor.tournamentId || 'main',
      matchId: match.id,
      version: match.version,
      complete: history.complete,
      metadata: history.metadata,
      games,
      redSide: input.redSide,
      checkpoint: history.checkpoint,
    });
    return Response.json(
      { token, games, decisions, complete: history.complete, metadata: history.metadata },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
