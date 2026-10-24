import { publicPage, publicPool, publicPools, publicStaff } from '@/lib/queries';
import { AppError } from '@/lib/permissions';
import { errorResponse } from '@/lib/security';
import { publicTeams, publicTeamsPage } from '@/lib/teams-service';
import { publicMatches, publicMatchHistory, publicMatchesPage } from '@/lib/public-matches';
import { listPageSchema } from '@/lib/list-pagination';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  try {
    const { resource } = await params;
    const url = new URL(request.url);
    const page =
      url.searchParams.get('paged') === '1'
        ? listPageSchema.parse(url.searchParams.get('page') || undefined)
        : null;
    let data: unknown;
    if (resource === 'mappools') {
      const slug = new URL(request.url).searchParams.get('slug');
      data = slug ? await publicPool(slug) : await publicPools();
      if (!data) throw new AppError('Mappool not found.', 404);
    } else if (resource === 'teams') {
      const slug = new URL(request.url).searchParams.get('slug');
      if (!slug && page) data = await publicTeamsPage(page);
      else {
        const teams = await publicTeams(slug || undefined);
        if (slug && !teams.length) throw new AppError('Team not found.', 404);
        data = slug ? teams[0] : teams;
      }
    } else if (resource === 'matches') {
      const code = new URL(request.url).searchParams.get('code');
      const filters = {
        stage: url.searchParams.get('stage') || undefined,
        status: url.searchParams.get('status') || undefined,
      };
      data = code
        ? await publicMatchHistory(code)
        : page
          ? await publicMatchesPage(filters, page)
          : await publicMatches(filters);
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
