import { getActor } from '@/lib/auth';
import { executeAction } from '@/lib/admin-service';
import { actionSchema } from '@/lib/validation';
import { errorResponse, jsonBody, rateLimit, requireSameOrigin } from '@/lib/security';
import { AppError } from '@/lib/permissions';
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const actor = await getActor();
    if (!actor) throw new AppError('Sign in to continue.', 401);
    await rateLimit(`write:${actor.id}`, 100);
    const action = actionSchema.parse(await jsonBody(request));
    return Response.json(await executeAction(actor, action), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
