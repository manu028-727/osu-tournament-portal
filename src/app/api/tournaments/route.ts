import { getActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { AppError } from '@/lib/permissions';
import {
  tournamentAction,
  tournamentActionSchema,
  tournamentList,
} from '@/lib/tournaments-service';
import { errorResponse, jsonBody, rateLimit, requireSameOrigin } from '@/lib/security';
export async function GET() {
  try {
    const actor = await getActor();
    if (!actor?.workspaceAny && !actor?.platformAdmin)
      throw new AppError('Workspace access required.', 403);
    return Response.json(
      {
        tournaments: await tournamentList(actor),
        users: actor.platformAdmin
          ? await db.user.findMany({
              select: { id: true, username: true, osuId: true, platformAdmin: true },
              orderBy: { username: 'asc' },
              take: 500,
            })
          : [],
        platform: actor.platformAdmin
          ? await db.platformSettings.findUnique({ where: { id: 'main' } })
          : null,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const actor = await getActor();
    if (!actor) throw new AppError('Sign in to continue.', 401);
    await rateLimit(`tournaments:${actor.id}`, 30);
    return Response.json(
      await tournamentAction(actor, tournamentActionSchema.parse(await jsonBody(request))),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
