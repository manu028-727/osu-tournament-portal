import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from './permissions';
import { AppError } from './permissions';
import type { MultiplayerImportGame } from './match-results-contract';
import type { MultiplayerCheckpoint } from './multiplayer';

type ReviewPayload = {
  actorId: string;
  tournamentId: string;
  matchId: string;
  version: number;
  expiresAt: number;
  complete: boolean;
  metadata: { id: number; name?: string; start_time?: string | null; end_time?: string | null };
  games: MultiplayerImportGame[];
  redSide?: 'A' | 'B';
  warmups?: number;
  playerSides?: Record<string, 'A' | 'B'>;
  checkpoint?: MultiplayerCheckpoint;
};
function signature(body: string) {
  const secret = process.env.OSU_CLIENT_SECRET;
  if (!secret) throw new AppError('osu! OAuth is not configured.', 503);
  // Domain separation; the credential is never part of the review payload.
  return createHmac('sha256', secret).update('match-result-review-v1\0').update(body).digest();
}
export function signMatchResultReview(payload: Omit<ReviewPayload, 'expiresAt'>, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ ...payload, expiresAt: now + 15 * 60_000 })).toString(
    'base64url',
  );
  if (body.length > 439900)
    throw new AppError(
      'This lobby contains too much evidence for one review. Use a smaller lobby or manual results.',
    );
  return `${body}.${signature(body).toString('base64url')}`;
}
export function verifyMatchResultReview(
  token: string,
  actor: Actor,
  matchId: string,
  version: number,
  now = Date.now(),
  requireComplete = true,
): ReviewPayload {
  const [body, mac, extra] = token.split('.');
  const supplied = Buffer.from(mac || '', 'base64url');
  const expected = signature(body || '');
  if (extra || !body || supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    throw new AppError('The multiplayer review is invalid. Fetch the lobby again.', 409);
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ReviewPayload;
  if (
    payload.actorId !== actor.id ||
    payload.tournamentId !== (actor.tournamentId || 'main') ||
    payload.matchId !== matchId ||
    payload.version !== version ||
    payload.expiresAt <= now
  )
    throw new AppError(
      'The multiplayer review expired or the match changed. Fetch the lobby again.',
      409,
    );
  if ((requireComplete && !payload.complete) || payload.games.length > 120)
    throw new AppError(
      'The available lobby history is incomplete. Review a complete source before importing.',
      409,
    );
  return payload;
}
export const resultFingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const savedImportDecisionSchema = z.object({
  included: z.boolean(),
  winnerSide: z.enum(['A', 'B']).nullable(),
  reason: z.string(),
});
