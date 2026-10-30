import { cookies } from 'next/headers';
import { getActor, requireTournamentActor, actorForTournament } from '@/lib/auth';
import { requestScope } from '@/lib/tournament-context';
import {
  registrationData,
  prepareRegistration,
  applyRegistration,
} from '@/lib/registration-service';
import { registrationActionSchema } from '@/lib/registration-policy';
import {
  errorResponse,
  jsonBody,
  requireSameOrigin,
  rateLimit,
  sessionCookie,
  hash,
} from '@/lib/security';
import { db } from '@/lib/db';
import { AppError } from '@/lib/permissions';

export async function GET() {
  try {
    const scope = await requestScope();
    if (!scope.slug) throw new AppError('Select a tournament before continuing.');
    return Response.json(await registrationData(await getActor(), scope.tournamentId), {
      headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const actor = await requireTournamentActor();
    await rateLimit(`registration:${actor.id}`, 12, 60);
    const input = registrationActionSchema.parse(await jsonBody(request));
    const profiles = await prepareRegistration(actor, input);
    const sessionHash = hash((await cookies()).get(sessionCookie())!.value);
    const result = await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
        const session = await tx.session.findUnique({
          where: { id: sessionHash },
          include: {
            user: { include: { roles: { include: { role: { include: { permissions: true } } } } } },
          },
        });
        if (!session || session.userId !== actor.id || session.expiresAt <= new Date())
          throw new AppError('Sign in to continue.', 401);
        return applyRegistration(
          tx,
          actorForTournament(session.user, actor.tournamentId!),
          input,
          profiles,
        );
      },
      { timeout: 30000 },
    );
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
