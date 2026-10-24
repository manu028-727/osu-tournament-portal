import { NextResponse } from 'next/server';
import { getTournament } from '@/lib/queries';
import { appUrl, errorResponse } from '@/lib/security';
import { isPublicTournament } from '@/lib/public-visibility';
import { requestScope } from '@/lib/tournament-context';
import { scopedHref } from '@/lib/tournament-paths';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const t = await getTournament();
    if (!isPublicTournament(t)) return new Response('Tournament not found.', { status: 404 });
    const response = NextResponse.redirect(
      new URL(scopedHref(t.settings?.registrationUrl || '/rules', await requestScope()), appUrl()),
    );
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
