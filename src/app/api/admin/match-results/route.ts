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
import { organizerMultiplayerGames } from '@/lib/organizer-multiplayer';
import { AppError, assertPermission } from '@/lib/permissions';
import { scopedDb } from '@/lib/scoped-db';
import { errorResponse, jsonBody, rateLimit, requireSameOrigin } from '@/lib/security';

const base = z.object({ id: z.string().min(1).max(100), baseVersion: z.number().int().positive() });
const requestSchema = z.discriminatedUnion('type', [
  base.extend({ type: z.literal('impact'), winnerSide: z.enum(['A', 'B']).nullable() }),
  base.extend({ type: z.literal('deletion') }),
  base.extend({
    type: z.literal('multiplayer'),
    lobbyUrl: z.string().min(1).max(300),
    redSide: z.enum(['A', 'B']).default('A'),
    reviewToken: z.string().max(440000).optional(),
    warmups: z.number().int().min(0).max(120).default(0),
    playerSides: z
      .record(z.string().regex(/^\d+$/), z.enum(['A', 'B']))
      .refine((value) => Object.keys(value).length <= 64)
      .default({}),
  }),
]);
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const actor = await requireTournamentActor();
    const input = requestSchema.parse(await jsonBody(request));
    assertPermission(actor, input.type === 'deletion' ? 'matches.delete' : 'matches.manage');
    const { match } = (await matchData(
      actor,
      new URL(`https://local.invalid/?id=${encodeURIComponent(input.id)}`),
      'match',
    )) as unknown as { match: MatchView };
    if (match.version !== input.baseVersion)
      throw new AppError('The match changed. Reload before saving.', 409);
    if (match.deletedAt && input.type !== 'deletion')
      throw new AppError('This generated match was deleted. Reopen it before making changes.', 409);
    const tenant = scopedDb(db, actor.tournamentId || 'main');
    if (input.type === 'impact' || input.type === 'deletion') {
      const impact = await tenant.$transaction((tx) =>
        resultCorrectionImpact(
          tx,
          actor.tournamentId || 'main',
          match,
          input.type === 'deletion' ? null : input.winnerSide,
        ),
      );
      const retainedHistory =
        input.type === 'deletion' &&
        !!(await tenant.bracketNode.findFirst({
          where: { matchId: match.id },
          select: { id: true },
        }));
      return Response.json(
        { ...impact, retainedHistory },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    const { multiplayerId } = lobbyInfo(input.lobbyUrl, null);
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
    if (priorReview && priorReview.metadata.id !== multiplayerId)
      throw new AppError('The multiplayer review is invalid. Fetch the lobby again.', 409);
    if (!priorReview?.complete) await rateLimit(`organizer-mp:${actor.id}:${multiplayerId}`, 3, 15);
    const history = priorReview?.complete
      ? {
          metadata: priorReview.metadata,
          events: [],
          complete: true,
          checkpoint: priorReview.checkpoint,
        }
      : await collectMultiplayerPages(
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
    const resolved = organizerMultiplayerGames(
      [...byGame.values()].sort((a, b) => a.evidence.eventId - b.evidence.eventId),
      match,
      { ...priorReview?.playerSides, ...input.playerSides },
    );
    const games = resolved.games;
    if (games.length > 120)
      throw new AppError('This lobby contains too many games for one review. Use manual results.');
    const previous = await tenant.multiplayerGame.findMany({
      where: { matchId: match.id, multiplayerId: multiplayerId! },
      select: { gameId: true, proposal: true },
    });
    let scoreA = 0,
      scoreB = 0;
    const decisions = games.map((game, index) => {
      const prior = previous.find((row) => row.gameId === game.evidence.gameId)?.proposal;
      const saved = savedImportDecisionSchema.safeParse(
        prior && typeof prior === 'object' && 'organizerReview' in prior
          ? prior.organizerReview
          : null,
      );
      const winnerSide = saved.success
        ? saved.data.winnerSide || game.proposal?.winnerSide || null
        : game.proposal?.winnerSide || null;
      const included =
        index >= input.warmups &&
        !!winnerSide &&
        !!game.evidence.endTime &&
        Math.max(scoreA, scoreB) < firstTo(match.rules);
      const decision =
        saved.success && (match.source?.organizerResult?.warmups || 0) === input.warmups
          ? { ...saved.data, gameId: game.evidence.gameId }
          : {
              gameId: game.evidence.gameId,
              included,
              winnerSide,
              reason: saved.success ? saved.data.reason : '',
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
      warmups: input.warmups,
      playerSides: { ...priorReview?.playerSides, ...input.playerSides },
    });
    return Response.json(
      {
        token,
        games,
        decisions,
        complete: history.complete,
        metadata: history.metadata,
        players: resolved.players,
        warmups: input.warmups,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
