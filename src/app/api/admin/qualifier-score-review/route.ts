import { requireTournamentActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { qualifierCorrectionSchema } from '@/lib/qualifier-corrections-contract';
import { reviewQualifierCorrections } from '@/lib/qualifier-corrections-service';
import { refreshedQualifierActor } from '@/lib/qualifier-capture-service';
import { errorResponse, jsonBody, requireSameOrigin, rateLimit } from '@/lib/security';
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const actor = await requireTournamentActor();
    const input = qualifierCorrectionSchema.parse(await jsonBody(request));
    await rateLimit(`qualifier-score-review:${actor.id}`, 60, 60);
    const result = await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
        return reviewQualifierCorrections(tx, await refreshedQualifierActor(tx, actor), input);
      },
      { timeout: 30000 },
    );
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
