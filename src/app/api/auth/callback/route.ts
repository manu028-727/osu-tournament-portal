import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createSession, loginUser } from '@/lib/auth';
import { requestToken, osuGet, profileSchema } from '@/lib/osu';
import {
  appUrl,
  equal,
  errorResponse,
  hash,
  maintenance,
  secureCookie,
  sessionCookie,
  stateCookie,
} from '@/lib/security';
import { AppError } from '@/lib/permissions';
import { safeReturnTo } from '@/lib/return-url';
export async function GET(request: NextRequest) {
  try {
    const state = request.nextUrl.searchParams.get('state') || '';
    const cookie = request.cookies.get(stateCookie())?.value || '';
    if (!state || !cookie || !equal(state, cookie))
      throw new AppError('OAuth state validation failed. Please start sign-in again.', 403);
    const savedState = await db.oAuthState.findUnique({ where: { id: hash(state) } });
    const consumed = await db.oAuthState.deleteMany({
      where: { id: hash(state), expiresAt: { gt: new Date() } },
    });
    if (consumed.count !== 1)
      throw new AppError('This sign-in request has expired or was already used.', 403);
    const code = request.nextUrl.searchParams.get('code');
    if (!code) throw new AppError('Authorization was cancelled.');
    const access = await requestToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.OSU_REDIRECT_URI || `${appUrl().origin}/api/auth/callback`,
    });
    const profile = profileSchema.parse(await osuGet('me', access.access_token));
    const user = await loginUser(profile);
    // Access and refresh tokens are deliberately not persisted: sessions use independent random credentials.
    const previous = request.cookies.get(sessionCookie())?.value;
    if (previous) await db.session.deleteMany({ where: { id: hash(previous) } });
    const session = await createSession(user.id);
    await maintenance();
    const response = NextResponse.redirect(new URL(safeReturnTo(savedState?.returnTo), appUrl()));
    response.cookies.set(sessionCookie(), session.raw, {
      httpOnly: true,
      secure: secureCookie(),
      sameSite: 'lax',
      path: '/',
      expires: session.expiresAt,
    });
    response.cookies.delete(stateCookie());
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    const response = errorResponse(error);
    response.headers.append(
      'Set-Cookie',
      `${stateCookie()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie() ? '; Secure' : ''}`,
    );
    return response;
  }
}
