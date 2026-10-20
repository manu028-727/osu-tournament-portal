import { NextRequest, NextResponse } from 'next/server';
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV !== 'production';
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; font-src 'self' data:; connect-src 'self'${isDev ? ' ws:' : ''}; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://osu.ppy.sh; object-src 'none'`;
  const headers = new Headers(request.headers);
  headers.delete('x-tournament-slug');
  headers.set('x-original-path', request.nextUrl.pathname);
  const path = request.nextUrl.pathname;
  const scoped =
    path.match(/^\/admin\/t\/([a-z0-9-]+)(\/.*)?$/) || path.match(/^\/t\/([a-z0-9-]+)(\/.*)?$/);
  const slug =
    scoped?.[1] ||
    (path.startsWith('/api/') ? request.nextUrl.searchParams.get('tournament') : null);
  if (slug) headers.set('x-tournament-slug', slug);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  // NextURL normalizes loopback IPs to localhost; rewrites must keep the raw
  // server origin or they become external self-proxies and lose tenant headers.
  const destination = new URL(request.url);
  if (scoped)
    destination.pathname = (path.startsWith('/admin/') ? '/admin' : '') + (scoped[2] || '/');
  if (destination.pathname.endsWith('/schedule'))
    destination.pathname = destination.pathname.replace(/\/schedule$/, '/matches');
  const response = scoped
    ? NextResponse.rewrite(destination, { request: { headers } })
    : NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  if (
    request.nextUrl.pathname.startsWith('/admin') ||
    request.nextUrl.pathname.startsWith('/api/admin') ||
    request.nextUrl.pathname.startsWith('/api/auth')
  ) {
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Vary', 'Cookie');
  }
  if (process.env.APP_URL?.startsWith('https://'))
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return response;
}
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|artwork.svg).*)'],
};
