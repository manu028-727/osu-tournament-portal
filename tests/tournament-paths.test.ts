import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../src/proxy';
import { tournamentAdminBase, tournamentPath } from '../src/lib/tournament-paths';
import { scopedHref, tournamentApiUrl } from '../src/components/tournament-scope';

afterEach(() => vi.unstubAllGlobals());
const scope = {
  tournamentId: 'independent-id',
  slug: 'spring-cup',
  publicBase: '/t/spring-cup',
  adminBase: tournamentAdminBase('spring-cup'),
};
describe('tournament workspace routing', () => {
  it('separates public, canonical admin and legacy paths', () => {
    expect(tournamentPath('/t/spring-cup/admin/homepage')).toEqual({
      slug: 'spring-cup',
      path: '/admin/homepage',
      admin: true,
      legacy: false,
    });
    expect(tournamentPath('/t/spring-cup/mappools')?.admin).toBe(false);
    expect(tournamentPath('/admin/t/spring-cup/rules')?.legacy).toBe(true);
    for (const path of ['/admin/homepage', '/admin/tournaments', '/t/-bad/admin', '/t/cup!/admin'])
      expect(tournamentPath(path)).toBeNull();
  });
  it('generates scoped navigation without changing platform links', () => {
    expect(scopedHref('/admin/homepage', scope)).toBe('/t/spring-cup/admin/homepage');
    expect(scopedHref('/admin', scope)).toBe('/t/spring-cup/admin');
    expect(scopedHref('/rules', scope)).toBe('/t/spring-cup/rules');
    expect(scopedHref('/admin/tournaments', scope)).toBe('/admin/tournaments');
    expect(scopedHref('/t/other/admin', scope)).toBe('/t/other/admin');
  });
  it.each(['/t/spring-cup/admin/homepage', '/admin/t/spring-cup/homepage'])(
    'includes the selected tournament in requests from %s',
    (pathname) => {
      vi.stubGlobal('window', { location: { pathname, origin: 'https://portal.example' } });
      expect(tournamentApiUrl('/api/admin/data?section=settings')).toBe(
        '/api/admin/data?section=settings&tournament=spring-cup',
      );
      expect(tournamentApiUrl('/api/admin/data?section=rules&tournament=other')).toBe(
        '/api/admin/data?section=rules&tournament=spring-cup',
      );
    },
  );
  it('rewrites admin paths internally and marks them private', () => {
    const response = proxy(new NextRequest('http://127.0.0.1:3002/t/spring-cup/admin/homepage'));
    expect(new URL(response.headers.get('x-middleware-rewrite')!).pathname).toBe('/admin/homepage');
    expect(response.headers.get('x-middleware-request-x-tournament-slug')).toBe('spring-cup');
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('vary')).toBe('Cookie');
  });
  it('preserves the original admin root and redirects old bookmarks without losing queries', () => {
    const root = proxy(new NextRequest('http://127.0.0.1:3002/t/spring-cup/admin'));
    expect(new URL(root.headers.get('x-middleware-rewrite')!).pathname).toBe('/admin');
    const legacy = proxy(
      new NextRequest('http://127.0.0.1:3002/admin/t/spring-cup/rules?view=draft'),
    );
    expect(legacy.status).toBe(308);
    const destination = new URL(legacy.headers.get('location')!);
    expect(destination.pathname + destination.search).toBe('/t/spring-cup/admin/rules?view=draft');
  });
  it('rejects forged scope headers and scopes API calls only from the explicit parameter', () => {
    const unscoped = proxy(
      new NextRequest('http://localhost/api/admin/data?section=settings', {
        headers: { 'x-tournament-slug': 'other', 'x-original-path': '/t/other/admin' },
      }),
    );
    expect(unscoped.headers.get('x-middleware-request-x-tournament-slug')).toBeNull();
    expect(unscoped.headers.get('x-middleware-request-x-original-path')).toBe('/api/admin/data');
    const scoped = proxy(
      new NextRequest('http://localhost/api/admin/data?section=settings&tournament=spring-cup'),
    );
    expect(scoped.headers.get('x-middleware-request-x-tournament-slug')).toBe('spring-cup');
  });
});
