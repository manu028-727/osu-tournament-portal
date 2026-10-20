import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { oauthConfig } from '@/lib/osu';
import { safeReturnTo } from '@/lib/return-url';
import {
  appUrl,
  errorResponse,
  hash,
  rateLimit,
  secureCookie,
  stateCookie,
  token,
} from '@/lib/security';
export async function GET(request: Request) {
  try {
    oauthConfig();
    await rateLimit('auth:login', 120, 60);
    await db.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    const state = token();
    await db.oAuthState.create({
      data: {
        id: hash(state),
        expiresAt: new Date(Date.now() + 600000),
        returnTo: safeReturnTo(new URL(request.url).searchParams.get('returnTo')),
      },
    });
    const url = new URL('https://osu.ppy.sh/oauth/authorize');
    url.search = new URLSearchParams({
      client_id: process.env.OSU_CLIENT_ID!,
      redirect_uri: process.env.OSU_REDIRECT_URI || `${appUrl().origin}/api/auth/callback`,
      response_type: 'code',
      scope: 'identify public',
      state,
    }).toString();
    const response = NextResponse.redirect(url);
    response.cookies.set(stateCookie(), state, {
      httpOnly: true,
      secure: secureCookie(),
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
