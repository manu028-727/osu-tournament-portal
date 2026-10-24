'use client';
import NextLink from 'next/link';
import { createContext, useContext } from 'react';
import type { ComponentProps } from 'react';
import { tournamentPath, scopedHref } from '@/lib/tournament-paths';
import { useLocale, useT } from './locale';
import { localeTag } from '@/lib/i18n';
export { scopedHref } from '@/lib/tournament-paths';
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
  const language = useLocale(),
    tr = useT();
  return (value: string | Date | null) =>
    value
      ? new Intl.DateTimeFormat(localeTag(language), {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: timezone,
        }).format(new Date(value))
      : tr('Date to be announced');
}
export function TournamentScope({ value, children }: { value: Scope; children: React.ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export default function Link(props: ComponentProps<typeof NextLink>) {
  const scope = useTournamentScope();
  const target = typeof props.href === 'string' ? props.href : '';
  const tenant = tournamentPath(target.split(/[?#]/, 1)[0])?.slug;
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
  const slug = tournamentPath(window.location.pathname)?.slug;
  if (!slug) return url;
  const target = new URL(url, window.location.origin);
  target.searchParams.set('tournament', slug);
  return target.pathname + target.search;
}
