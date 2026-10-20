'use client';
import Link from '@/components/tournament-scope';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { DropdownMenu } from 'radix-ui';
import {
  Menu,
  X,
  ArrowUpRight,
  LogIn,
  ChevronDown,
  ExternalLink,
  LayoutDashboard,
} from 'lucide-react';
import { Button } from './ui/button';
import { LogoutButton } from './logout-button';

type Profile = { username: string; avatarUrl: string; osuId: number; workspace: boolean };
export function PublicNav({
  name,
  acronym,
  logo,
  links,
  user,
}: {
  name: string;
  acronym: string;
  logo: string;
  links: { label: string; href: string }[];
  user?: Profile;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const login = `/api/auth/login?returnTo=${encodeURIComponent(pathname + (search ? '?' + search : ''))}`;
  const item =
    'flex cursor-pointer items-center gap-3 rounded-md px-4 py-3 text-sm outline-none focus:bg-white/10';
  return (
    <header className="sticky top-0 z-40 border-b border-white/[.06] bg-background/95 backdrop-blur-xl">
      <div className="wrap flex min-h-20 items-center justify-between gap-3 py-3">
        <Link href="/" className="flex shrink-0 items-center gap-3" aria-label={`${name} home`}>
          {logo ? (
            <img src={logo} alt={name} className="h-10 w-28 object-contain sm:w-32" />
          ) : (
            <span className="font-semibold text-primary">{acronym}</span>
          )}
          <span className="hidden text-sm font-semibold text-muted xl:inline">{acronym}</span>
        </Link>
        <nav aria-label="Main navigation" className="hidden items-center gap-5 lg:flex">
          <Link href="/tournaments" className="text-sm text-muted">
            Tournaments
          </Link>
          {links.map((l) => (
            <Link
              key={l.href + l.label}
              href={l.href}
              className={`text-sm ${pathname === l.href ? 'text-foreground' : 'text-muted hover:text-foreground'}`}
              aria-current={pathname === l.href ? 'page' : undefined}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          {user ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button
                  variant="ghost"
                  className="gap-2 px-2"
                  aria-label={`${user.username} profile menu`}
                  title="Profile menu"
                >
                  <img
                    src={user.avatarUrl}
                    alt=""
                    className="size-9 shrink-0 rounded-md object-cover"
                  />
                  <span className="hidden max-w-28 truncate xl:inline">{user.username}</span>
                  <ChevronDown size={16} />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={10}
                  collisionPadding={12}
                  className="z-[70] w-72 max-w-[calc(100vw-24px)] rounded-lg border bg-card p-2 shadow-xl"
                >
                  <DropdownMenu.Label className="flex items-center gap-3 border-b px-4 py-3">
                    <img src={user.avatarUrl} alt="" className="size-10 rounded-md" />
                    <span className="min-w-0 truncate font-semibold">{user.username}</span>
                  </DropdownMenu.Label>
                  <DropdownMenu.Item asChild>
                    <a
                      className={item}
                      href={`https://osu.ppy.sh/users/${user.osuId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink size={18} />
                      Profilo osu!
                    </a>
                  </DropdownMenu.Item>
                  {user.workspace && (
                    <DropdownMenu.Item asChild>
                      <Link className={item} href="/admin/tournaments">
                        <LayoutDashboard size={18} />
                        Organizer Workspace
                      </Link>
                    </DropdownMenu.Item>
                  )}
                  <DropdownMenu.Separator className="my-1 border-t" />
                  <DropdownMenu.Item asChild onSelect={(event) => event.preventDefault()}>
                    <LogoutButton className={`${item} w-full`}>Esci</LogoutButton>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : (
            <Button asChild variant="outline" size="sm">
              <a href={login} aria-label="Accedi con osu!" title="Accedi con osu!">
                <LogIn size={17} />
                <span className="hidden sm:inline">Accedi con osu!</span>
                <ArrowUpRight size={14} />
              </a>
            </Button>
          )}
          <Button
            aria-label={open ? 'Close navigation' : 'Open navigation'}
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={21} /> : <Menu size={21} />}
          </Button>
        </div>
      </div>
      {open && (
        <nav className="border-t px-5 py-4 lg:hidden" aria-label="Mobile navigation">
          <Link href="/tournaments" className="block p-3 text-base">
            Tournaments
          </Link>
          {links.map((l) => (
            <Link
              key={l.href + l.label}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block p-3 text-base"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
