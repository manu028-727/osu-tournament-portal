import { requireTournamentActor } from '@/lib/auth';
import { exportTournament, assertExportPermission } from '@/lib/tournament-export';
import { appUrl, errorResponse, rateLimit, requireSameOrigin } from '@/lib/security';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const actor = await requireTournamentActor();
    assertExportPermission(actor);
    await rateLimit(`tournament-export:${actor.id}`, 3, 300);
    const { bytes, filename } = await exportTournament(actor, appUrl().origin);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, no-store',
        Vary: 'Cookie',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
