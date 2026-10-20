import { db } from '@/lib/db';
import { getActor } from '@/lib/auth';
import { AppError, can } from '@/lib/permissions';
import { exportTeamCsv } from '@/lib/teams-csv';
import { teamInclude } from '@/lib/teams-service';
import { errorResponse } from '@/lib/security';
export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) throw new AppError('Sign in to continue.', 401);
    if (!can(actor, 'teams.view') && !can(actor, 'teams.import'))
      throw new AppError('Forbidden.', 403);
    const teams = await db.team.findMany({
      where: { tournamentId: actor.tournamentId || 'main' },
      include: teamInclude,
      orderBy: { position: 'asc' },
      take: 500,
    });
    return new Response('\uFEFF' + exportTeamCsv(teams), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="teams.csv"',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
