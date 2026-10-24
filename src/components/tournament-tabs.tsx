'use client';
import { useT } from '@/components/locale';

import Link, { useTournamentScope } from './tournament-scope';
import { usePathname } from 'next/navigation';
import styles from './tournament-profile.module.css';
export function TournamentTabs({ links }: { links: { href: string; label: string }[] }) {
  const tr = useT();
  const pathname = usePathname(),
    scope = useTournamentScope();
  const route = pathname.startsWith(scope.publicBase)
    ? pathname.slice(scope.publicBase.length) || '/'
    : pathname;
  const local = route.replace(/^\/schedule(?=\/|$)/, '/matches');
  return (
    <nav className={styles.tabs} aria-label={tr('Tournament navigation')}>
      {links.map((link, index) => (
        <Link
          key={`${link.href}-${index}`}
          href={link.href}
          aria-current={
            local === link.href || (link.href !== '/' && local.startsWith(link.href + '/'))
              ? 'page'
              : undefined
          }
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
