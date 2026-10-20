import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { appUrl, errorResponse, hash, requireSameOrigin, sessionCookie } from '@/lib/security';
export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const raw = request.cookies.get(sessionCookie())?.value;
    if (raw) await db.session.deleteMany({ where: { id: hash(raw) } });
    const response = request.headers.get('accept')?.includes('application/json')
      ? NextResponse.json({ redirectTo: '/' })
      : NextResponse.redirect(new URL('/', appUrl()), 303);
    response.cookies.set(sessionCookie(), '', {
      path: '/',
      httpOnly: true,
      secure: appUrl().protocol === 'https:',
      sameSite: 'lax',
      maxAge: 0,
      expires: new Date(0),
    });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
