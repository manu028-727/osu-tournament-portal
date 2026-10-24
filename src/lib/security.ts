import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from './db';
import { AppError } from './permissions';
import { getLocale } from './server-locale';
import { translator, translateGeneratedMessage } from './i18n';
import { validationFeedback } from './validation-feedback';
export function appUrl() {
  const value = process.env.APP_URL;
  if (process.env.NODE_ENV === 'production' && !value)
    throw new AppError('APP_URL must be configured for production.', 503);
  const url = new URL(value || 'http://localhost:3334');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    (process.env.NODE_ENV === 'production' && !loopback && url.protocol !== 'https:')
  )
    throw new AppError('The production application URL must use HTTPS.', 503);
  return url;
}
export const secureCookie = () => appUrl().protocol === 'https:';
export const sessionCookie = () =>
  secureCookie() ? '__Host-tournament_session' : 'tournament_session';
export const stateCookie = () => (secureCookie() ? '__Host-tournament_oauth' : 'tournament_oauth');
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export function equal(a: string, b: string) {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function requireSameOrigin(request: Request) {
  if (request.headers.get('origin') !== appUrl().origin)
    throw new AppError('The request origin could not be verified.', 403);
  if (request.headers.get('sec-fetch-site') === 'cross-site')
    throw new AppError('Cross-site request rejected.', 403);
}
export async function rateLimit(key: string, max: number, windowSeconds = 60) {
  const rows = await db.$queryRaw<{ count: number }[]>`
 INSERT INTO "RateLimit" ("key","count","expiresAt") VALUES (${key},1,NOW()+${windowSeconds}*INTERVAL '1 second')
 ON CONFLICT ("key") DO UPDATE SET "count"=CASE WHEN "RateLimit"."expiresAt"<NOW() THEN 1 ELSE "RateLimit"."count"+1 END,
 "expiresAt"=CASE WHEN "RateLimit"."expiresAt"<NOW() THEN NOW()+${windowSeconds}*INTERVAL '1 second' ELSE "RateLimit"."expiresAt" END RETURNING "count"`;
  if (rows[0].count > max) throw new AppError('Too many requests. Please try again shortly.', 429);
}
export async function maintenance() {
  // Invoked after a successful login; bounded tables also remain inspectable in SQL.
  await Promise.all([
    db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
    db.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
    db.rateLimit.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86400000) } } }),
  ]);
}
export async function errorResponse(error: unknown) {
  // Error reporting must still work if the installation's locale lookup fails.
  const language = await getLocale().catch(() => 'en' as const);
  const tr = translator(language);
  if (error instanceof AppError)
    return Response.json(
      {
        error: error.translationValues.length
          ? tr(error.translationKey, ...error.translationValues)
          : translateGeneratedMessage(language, error.message),
      },
      { status: error.status, headers: { 'Cache-Control': 'no-store' } },
    );
  if (error && typeof error === 'object' && 'issues' in error)
    return Response.json(
      {
        error: Array.isArray(error.issues)
          ? validationFeedback(error.issues, language)
          : tr('Please check the submitted fields.'),
      },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
    );
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
    return Response.json(
      { error: tr('That name, slug or account already exists.') },
      {
        status: 409,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025')
    return Response.json(
      { error: tr('This item no longer exists.') },
      {
        status: 404,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  console.error('Request failed:', error instanceof Error ? error.message : 'Unknown error');
  return Response.json(
    { error: tr('The request could not be completed. Please try again.') },
    { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
export async function jsonBody(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new AppError('Expected JSON.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('Missing request body.');
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 500000) {
      await reader.cancel();
      throw new AppError('Request is too large.', 413);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('Invalid JSON.');
  }
}
