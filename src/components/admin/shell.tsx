'use client';
import Link from '@/components/tournament-scope';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutDashboard,
  PanelsTopLeft,
  Disc3,
  Users,
  BookOpen,
  Image,
  UserRoundCog,
  Shield,
  Settings,
  ScrollText,
  ArrowUpRight,
  ChevronRight,
  Menu,
  X,
  Table2,
  ClipboardCheck,
  Swords,
} from 'lucide-react';
import type { Actor } from '@/lib/permissions';
import { canAccessSection } from '@/lib/workspace';
import { Notices } from './shared';
import { useTournamentScope } from '@/components/tournament-scope';
import { Button } from '../ui/button';
import { LogoutButton } from '../logout-button';
const links = [
  ['', 'Overview', LayoutDashboard, null],
  ['homepage', 'Homepage', PanelsTopLeft, 'homepage.edit'],
  ['mappools', 'Mappools', Disc3, 'mappools.view_drafts'],
  ['staff', 'Staff', Users, 'staff.edit'],
  ['rules', 'Rules', BookOpen, 'rules.edit'],
  ['media', 'Media library', Image, 'media.upload'],
  ['teams', 'Teams & players', Users, 'teams.view'],
  ['stages', 'Stages', Disc3, 'mappools.create'],
  ['referee', 'Referee', ClipboardCheck, 'referee.access'],
  ['matches', 'Matches', Swords, 'matches.manage'],
  ['users', 'Users', UserRoundCog, 'users.manage'],
  ['roles', 'Roles & permissions', Shield, 'roles.manage'],
  ['settings', 'Tournament settings', Settings, 'settings.manage'],
  ['audit', 'Audit logs', ScrollText, 'audit.view'],
  ['sheet-data', 'Sheet data', Table2, 'tournament.data.read'],
] as const;
export function AdminShell({
  actor,
  name,
  acronym,
  children,
}: {
  actor: Actor;
  name: string;
  acronym: string;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const scope = useTournamentScope();
  const localPath = scope.slug ? path.replace(scope.adminBase, '/admin') : path;
  const [open, setOpen] = useState(false);
  const current = links.find(
    ([slug]) =>
      localPath === `/admin${slug ? '/' + slug : ''}` ||
      (slug && localPath.startsWith(`/admin/${slug}/`)),
  );
  return (
    <Notices>
      <div className="min-h-screen">
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-72 max-w-[calc(100vw-32px)] flex-col border-r bg-[#16161d] transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
        >
          <div className="flex min-h-20 shrink-0 items-center gap-3 border-b px-6 py-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-primary/60 text-xs font-semibold text-primary">
              {acronym.slice(0, 4)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-semibold">{name}</p>
              <p className="mt-1 text-xs text-muted">Organizer workspace</p>
            </div>
            <button
              className="ml-auto lg:hidden"
              aria-label="Close sidebar"
              onClick={() => setOpen(false)}
            >
              <X size={17} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-7">
            <nav aria-label="Administration" className="space-y-1">
              <Link
                href="/admin/tournaments"
                className="mb-5 flex items-center gap-3 rounded-lg border px-3 py-3 text-sm"
              >
                <PanelsTopLeft size={16} />
                Switch tournament
              </Link>
              {[
                { label: 'Overview', sections: [''] },
                {
                  label: 'Content management',
                  sections: ['homepage', 'mappools', 'staff', 'rules', 'media'],
                },
                {
                  label: 'Tournament management',
                  sections: ['teams', 'stages', 'referee', 'matches', 'sheet-data'],
                },
                { label: 'Administration', sections: ['users', 'roles', 'settings', 'audit'] },
              ].map((group) => {
                const visible = links.filter(
                  ([slug]) =>
                    group.sections.includes(slug) && (!slug || canAccessSection(actor, slug)),
                );
                return visible.length ? (
                  <div key={group.label} className="mb-6">
                    <p className="mb-2 px-3 text-xs font-semibold text-muted">{group.label}</p>
                    {visible.map(([slug, label, Icon]) => {
                      const href = `/admin${slug ? '/' + slug : ''}`,
                        active = localPath === href || (!!slug && localPath.startsWith(href + '/'));
                      return (
                        <Link
                          href={href}
                          key={href}
                          onClick={() => setOpen(false)}
                          className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm ${active ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-white/5 hover:text-foreground'}`}
                        >
                          <Icon size={16} />
                          {label}
                          {active && <span className="ml-auto size-1 rounded-full bg-primary" />}
                        </Link>
                      );
                    })}
                  </div>
                ) : null;
              })}
            </nav>
          </div>
          <div className="border-t p-4">
            <div className="flex items-center gap-3">
              <img src={actor.avatarUrl} alt="" className="size-9 rounded-lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{actor.username}</p>
                <p className="mt-1 truncate text-[10px] text-muted">
                  {actor.roles.map((r) => r.name).join(', ')}
                </p>
              </div>
              <LogoutButton aria-label="Sign out" className="p-2 text-muted" />
            </div>
          </div>
        </aside>
        {open && (
          <button
            onClick={() => setOpen(false)}
            aria-label="Close sidebar"
            className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          />
        )}
        <div className="lg:pl-72">
          <header className="flex min-h-20 items-center justify-between gap-3 border-b bg-background/95 px-5 py-3 md:px-10">
            <div className="flex min-w-0 flex-1 items-center gap-3 text-sm">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setOpen(true)}
                aria-label="Open sidebar"
              >
                <Menu size={18} />
              </Button>
              <span className="hidden text-muted sm:inline">Workspace</span>
              <ChevronRight size={12} className="hidden shrink-0 text-muted sm:block" />
              <span className="truncate">{current?.[1] || 'Editor'}</span>
            </div>
            <Button asChild variant="outline" size="sm" className="shrink-0 whitespace-nowrap">
              <Link href="/">
                View website
                <ArrowUpRight size={13} />
              </Link>
            </Button>
          </header>
          <main id="main" className="mx-auto max-w-[1600px] p-5 py-8 md:p-10">
            {children}
          </main>
          <footer className="px-10 py-6 text-[10px] text-white/25">
            {name} · Organizer workspace
          </footer>
        </div>
      </div>
    </Notices>
  );
}
