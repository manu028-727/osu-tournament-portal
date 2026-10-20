'use client';
import NextLink from 'next/link';
import { createContext, useContext } from 'react';
import type { ComponentProps } from 'react';
type Scope = {
  tournamentId: string;
  slug: string;
  publicBase: string;
  adminBase: string;
  timezone?: string;
};
const Context = createContext<Scope>({
  tournamentId: 'main',
  slug: '',
  publicBase: '',
  adminBase: '/admin',
});
export const useTournamentScope = () => useContext(Context);
export function useTournamentTime() {
  const { timezone = 'UTC' } = useTournamentScope();
  return (value: string | Date | null) =>
    value
      ? new Intl.DateTimeFormat('it-IT', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: timezone,
        }).format(new Date(value))
      : 'Data da definire';
}
export function TournamentScope({ value, children }: { value: Scope; children: React.ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function scopedHref(href: string, scope: Scope) {
  if (
    !scope.slug ||
    !href.startsWith('/') ||
    href.startsWith('//') ||
    /^\/(?:api|t|tournaments|admin\/t|admin\/tournaments)(?:\/|$)/.test(href)
  )
    return href;
  if (/^\/admin(?:\/|$)/.test(href)) return href.replace(/^\/admin/, scope.adminBase);
  if (
    /^\/(?:mappools|teams|staff|rules|matches|schedule|brackets|register)(?:\/|\?|$)/.test(href) ||
    href === '/' ||
    href.startsWith('/?')
  )
    return scope.publicBase + (href === '/' ? '' : href);
  return href;
}
export default function Link(props: ComponentProps<typeof NextLink>) {
  const scope = useTournamentScope();
  const target = typeof props.href === 'string' ? props.href : '';
  const tenant = /^\/(?:admin\/)?t\/([a-z0-9-]+)(?:\/|$)/.exec(target)?.[1];
  // Crossing tenant boundaries must replace cached layouts as well as editor state.
  if (
    (tenant && tenant !== scope.slug) ||
    ['/tournaments', '/admin/tournaments'].includes(target)
  ) {
    const { href, prefetch, replace, scroll, shallow, locale, onNavigate, ...anchor } = props;
    void href;
    void prefetch;
    void replace;
    void scroll;
    void shallow;
    void locale;
    void onNavigate;
    return <a {...anchor} href={target} />;
  }
  return (
    <NextLink
      {...props}
      href={typeof props.href === 'string' ? scopedHref(props.href, scope) : props.href}
    />
  );
}
export function tournamentApiUrl(url: string) {
  if (typeof window === 'undefined' || !url.startsWith('/api/')) return url;
  const slug = /^\/(?:admin\/)?t\/([a-z0-9-]+)/.exec(window.location.pathname)?.[1];
  if (!slug) return url;
  const target = new URL(url, window.location.origin);
  target.searchParams.set('tournament', slug);
  return target.pathname + target.search;
}
