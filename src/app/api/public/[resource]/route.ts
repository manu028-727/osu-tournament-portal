import { publicPage, publicPool, publicPools, publicStaff } from '@/lib/queries';
import { AppError } from '@/lib/permissions';
import { errorResponse } from '@/lib/security';
import { publicTeams } from '@/lib/teams-service';
import { publicMatches, publicMatchHistory } from '@/lib/public-matches';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  try {
    const { resource } = await params;
    let data: unknown;
    if (resource === 'mappools') {
      const slug = new URL(request.url).searchParams.get('slug');
      data = slug ? await publicPool(slug) : await publicPools();
      if (!data) throw new AppError('Mappool not found.', 404);
    } else if (resource === 'teams') {
      const slug = new URL(request.url).searchParams.get('slug');
      const teams = await publicTeams(slug || undefined);
      if (slug && !teams.length) throw new AppError('Team not found.', 404);
      data = slug ? teams[0] : teams;
    } else if (resource === 'matches') {
      const code = new URL(request.url).searchParams.get('code');
      data = code ? await publicMatchHistory(code) : await publicMatches();
      if (code && !data) throw new AppError('Match not found.', 404);
    } else if (resource === 'staff') data = await publicStaff();
    else if (resource === 'home' || resource === 'rules') {
      data = await publicPage(resource);
      if (!data) throw new AppError('Page not found.', 404);
    } else throw new AppError('Not found.', 404);
    return Response.json(data, {
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
