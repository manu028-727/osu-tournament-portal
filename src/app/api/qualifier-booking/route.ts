import { cookies } from 'next/headers';
import { getActor, requireTournamentActor, refreshedSessionActor } from '@/lib/auth';
import { requestScope } from '@/lib/tournament-context';
import { qualifierBookingData, applyQualifierBooking } from '@/lib/qualifier-booking-service';
import { qualifierBookingSchema } from '@/lib/qualifier-booking-contract';
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
    return Response.json(await qualifierBookingData(await getActor(), scope.tournamentId), {
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
    await rateLimit(`qualifier-booking:${actor.id}`, 12, 60);
    const input = qualifierBookingSchema.parse(await jsonBody(request));
    const sessionHash = hash((await cookies()).get(sessionCookie())!.value);
    const result = await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
        const refreshed = await refreshedSessionActor(tx, actor, sessionHash);
        return applyQualifierBooking(tx, refreshed, input);
      },
      { timeout: 30000 },
    );
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
