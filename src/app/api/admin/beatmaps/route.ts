import { z } from 'zod';
import { getActor } from '@/lib/auth';
import { assertPermission } from '@/lib/permissions';
import { beatmaps } from '@/lib/osu';
import { getTournament } from '@/lib/queries';
import { errorResponse, jsonBody, rateLimit, requireSameOrigin } from '@/lib/security';
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const actor = await getActor();
    assertPermission(actor, 'mappools.edit');
    await rateLimit(`lookup:${actor.id}`, 20);
    const { ids } = z
      .object({ ids: z.array(z.number().int().positive().max(2147483647)).min(1).max(100) })
      .parse(await jsonBody(request));
    return Response.json(await beatmaps(ids, (await getTournament()).gameMode), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
