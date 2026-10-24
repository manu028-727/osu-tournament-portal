import { requireTournamentActor } from '@/lib/auth';
import { teamCsvStream } from '@/lib/teams-export';
import { errorResponse } from '@/lib/security';
export async function GET() {
  try {
    const actor = await requireTournamentActor();
    return new Response(teamCsvStream(actor), {
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
