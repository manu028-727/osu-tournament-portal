import { NextResponse } from 'next/server';
import { getTournament } from '@/lib/queries';
import { appUrl } from '@/lib/security';
export const dynamic = 'force-dynamic';
export async function GET() {
  const t = await getTournament();
  const response = NextResponse.redirect(
    new URL(t.settings?.registrationUrl || '/rules', appUrl()),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
