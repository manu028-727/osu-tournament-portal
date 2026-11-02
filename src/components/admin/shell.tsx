'use client';
import { useT } from '@/components/locale';

import Link, { useTournamentScope } from '@/components/tournament-scope';
import { usePathname } from 'next/navigation';
import { DropdownMenu } from 'radix-ui';
import { ArrowUpRight, ChevronDown } from 'lucide-react';
import type { Actor } from '@/lib/permissions';
import { canAccessSection } from '@/lib/workspace';
import { Notices, useWorkspacePortal, EditingWorkspace } from './shared';
import { LogoutButton } from '../logout-button';
import { AppearanceControl } from '../appearance';
import styles from './workspace-pilot.module.css';

const primary = [
  ['', 'Overview'],
  ['website', 'Website'],
  ['mappools', 'Stages & mappools'],
  ['teams', 'Teams & players'],
  ['matches', 'Matches'],
  ['staff', 'Staff'],
  ['settings', 'Settings'],
] as const;

export function AdminShell({
  actor,
  name,
  acronym,
  platform = false,
  children,
}: {
  actor: Actor;
  name: string;
  acronym: string;
  platform?: boolean;
  children: React.ReactNode;
}) {
  const tr = useT();
  const scope = useTournamentScope();
  const portal = useWorkspacePortal();
  const pathname = usePathname();
  const localPath = scope.slug ? pathname.replace(scope.adminBase, '/admin') : pathname;
  const active = (slug: string) =>
    (slug === 'matches' && localPath.startsWith('/admin/referee/')) ||
    localPath === `/admin${slug ? '/' + slug : ''}` ||
    (!!slug && localPath.startsWith(`/admin/${slug}/`));
  return (
    <Notices>
      <div id="workspace" className={`workspace ${styles.workspace}`}>
        <header className={styles.header}>
          <div className={styles.topline}>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                className={styles.identity}
                aria-label={tr('Switch tournament: {0}', name)}
              >
                <span className={styles.acronym}>{acronym.slice(0, 6)}</span>
                <span className={styles.name}>{name}</span>
                <ChevronDown size={15} aria-hidden="true" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal container={portal}>
                <DropdownMenu.Content
                  align="start"
                  sideOffset={8}
                  collisionPadding={16}
                  className={styles.menu}
                >
                  <DropdownMenu.Item asChild>
                    <Link className={styles.menuItem} href="/admin/tournaments">
                      {platform ? tr('Tournaments') : tr('Switch tournament')}
                    </Link>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <div className={styles.account}>
              <AppearanceControl />
              <Link
                href={platform ? '/tournaments' : '/'}
                className={styles.website}
                aria-label={tr('View website')}
                title={tr('View website')}
              >
                <span>{tr('View website')}</span>
                <ArrowUpRight size={18} />
              </Link>
              <span className={styles.username}>{actor.username}</span>
              <LogoutButton aria-label={tr('Sign out')} className={styles.iconButton} />
            </div>
          </div>
          <nav aria-label={tr('Administration')} className={styles.navigation}>
            {platform ? (
              <Link href="/admin/tournaments" aria-current="page">
                {tr('Tournaments')}
              </Link>
            ) : (
              <>
                {primary
                  .filter(
                    ([slug]) =>
                      !slug ||
                      canAccessSection(actor, slug) ||
                      (slug === 'mappools' && canAccessSection(actor, 'stages')),
                  )
                  .map(([slug, label]) => (
                    <Link
                      key={slug}
                      href={`/admin${slug ? '/' + slug : ''}`}
                      aria-current={active(slug) ? 'page' : undefined}
                    >
                      {tr(label)}
                    </Link>
                  ))}
              </>
            )}
          </nav>
        </header>
        <main
          id="main"
          className={`workspace-main ${styles.main} ${active('website') ? styles.editor : ''}`}
        >
          <EditingWorkspace>{children}</EditingWorkspace>
        </main>
      </div>
    </Notices>
  );
}
