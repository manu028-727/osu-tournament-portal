'use client';
import Link, { useTournamentScope } from '@/components/tournament-scope';
import { usePathname } from 'next/navigation';
import { DropdownMenu } from 'radix-ui';
import { ArrowUpRight, ChevronDown, Settings } from 'lucide-react';
import type { Actor } from '@/lib/permissions';
import { canAccessSection } from '@/lib/workspace';
import { Notices, useWorkspacePortal } from './shared';
import { LogoutButton } from '../logout-button';
import { AppearanceControl } from '../appearance';
import styles from './workspace-pilot.module.css';

const primary = [
  ['', 'Overview'],
  ['homepage', 'Homepage'],
  ['mappools', 'Mappools'],
  ['matches', 'Matches'],
  ['referee', 'Referee'],
] as const;
const groups = [
  {
    label: 'Website',
    links: [
      ['rules', 'Rules'],
      ['staff', 'Staff'],
      ['media', 'Media library'],
    ],
  },
  {
    label: 'Competition',
    links: [
      ['stages', 'Stages'],
      ['teams', 'Teams & players'],
      ['sheet-data', 'Sheet data'],
    ],
  },
  {
    label: 'Administration',
    links: [
      ['users', 'Users'],
      ['roles', 'Roles & permissions'],
      ['audit', 'Audit logs'],
    ],
  },
];

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
  const scope = useTournamentScope();
  const portal = useWorkspacePortal();
  const pathname = usePathname();
  const localPath = scope.slug ? pathname.replace(scope.adminBase, '/admin') : pathname;
  const active = (slug: string) =>
    localPath === `/admin${slug ? '/' + slug : ''}` ||
    (!!slug && localPath.startsWith(`/admin/${slug}/`));
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      links: group.links.filter(([slug]) => canAccessSection(actor, slug)),
    }))
    .filter((group) => group.links.length);
  const secondaryActive = visibleGroups.some((group) => group.links.some(([slug]) => active(slug)));
  const menuItems = (items: string[][]) =>
    items.map(([slug, label]) => (
      <DropdownMenu.Item asChild key={slug}>
        <Link
          href={`/admin/${slug}`}
          className={styles.menuItem}
          aria-current={active(slug) ? 'page' : undefined}
        >
          {label}
        </Link>
      </DropdownMenu.Item>
    ));
  return (
    <Notices>
      <div id="workspace" className={`workspace ${styles.workspace}`}>
        <header className={styles.header}>
          <div className={styles.topline}>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                className={styles.identity}
                aria-label={`Switch tournament: ${name}`}
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
                      {platform ? 'Tournaments' : 'Switch tournament'}
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
                aria-label="View website"
                title="View website"
              >
                <span>View website</span>
                <ArrowUpRight size={18} />
              </Link>
              {!platform && canAccessSection(actor, 'settings') && (
                <Link
                  href="/admin/settings"
                  className={styles.iconButton}
                  aria-label="Tournament settings"
                  title="Tournament settings"
                  aria-current={active('settings') ? 'page' : undefined}
                >
                  <Settings size={18} />
                </Link>
              )}
              <span className={styles.username}>{actor.username}</span>
              <LogoutButton aria-label="Sign out" className={styles.iconButton} />
            </div>
          </div>
          <nav aria-label="Administration" className={styles.navigation}>
            {platform ? (
              <Link href="/admin/tournaments" aria-current="page">
                Tournaments
              </Link>
            ) : (
              <>
                {primary
                  .filter(([slug]) => !slug || canAccessSection(actor, slug))
                  .map(([slug, label]) => (
                    <Link
                      key={slug}
                      href={`/admin${slug ? '/' + slug : ''}`}
                      aria-current={active(slug) ? 'page' : undefined}
                    >
                      {label}
                    </Link>
                  ))}
                {visibleGroups.length > 0 && (
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger
                      className={secondaryActive ? styles.activeMore : undefined}
                    >
                      More
                      <ChevronDown size={14} aria-hidden="true" />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal container={portal}>
                      <DropdownMenu.Content
                        align="end"
                        sideOffset={8}
                        collisionPadding={16}
                        className={styles.menu}
                      >
                        {visibleGroups.map((group) => (
                          <DropdownMenu.Group key={group.label}>
                            <DropdownMenu.Label className={styles.menuLabel}>
                              {group.label}
                            </DropdownMenu.Label>
                            {menuItems(group.links)}
                          </DropdownMenu.Group>
                        ))}
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                )}
              </>
            )}
          </nav>
        </header>
        <main
          id="main"
          className={`workspace-main ${styles.main} ${active('homepage') ? styles.editor : ''}`}
        >
          {children}
        </main>
      </div>
    </Notices>
  );
}
