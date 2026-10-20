import { cookies } from 'next/headers';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getActor } from '@/lib/auth';
import { AppError, assertPermission } from '@/lib/permissions';
import {
  requireSameOrigin,
  jsonBody,
  errorResponse,
  rateLimit,
  sessionCookie,
  hash,
} from '@/lib/security';
import { ircSecret, signTicket } from '@/lib/irc-security';
import { executeGateway } from '@/lib/irc-service';

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    if (process.env.IRC_ENABLED !== 'true')
      throw new AppError('IRC is disabled on this installation.', 404);
    const actor = await getActor();
    assertPermission(actor, 'referee.access');
    await rateLimit(`irc-ticket:${actor.id}`, 20);
    const { matchId } = z
      .object({ matchId: z.string().min(1).max(100) })
      .parse(await jsonBody(request));
    const identity = {
      userId: actor.id,
      username: actor.username,
      sessionHash: hash((await cookies()).get(sessionCookie())!.value),
      tournamentId: actor.tournamentId || 'main',
      matchId,
      expires: Date.now() + 60000,
      nonce: randomUUID(),
    };
    const context = await executeGateway({ identity, operation: 'authorize' });
    return Response.json(
      {
        ticket: signTicket(identity, ircSecret()),
        activeRequest: context.activeRequest,
        createdLobby: context.createdLobby,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
