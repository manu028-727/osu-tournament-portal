'use client';
import Link from '@/components/tournament-scope';
import { usePathname, useSearchParams } from 'next/navigation';
import { DropdownMenu } from 'radix-ui';
import {
  ArrowUpRight,
  LogIn,
  ChevronDown,
  ExternalLink,
  LayoutDashboard,
  ArrowLeft,
} from 'lucide-react';
import { Button } from './ui/button';
import { LogoutButton } from './logout-button';
import { AppearanceControl } from './appearance';

type Profile = { username: string; avatarUrl: string; osuId: number; workspace: boolean };
export function PublicNav({ user }: { user?: Profile }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const login = `/api/auth/login?returnTo=${encodeURIComponent(pathname + (search ? '?' + search : ''))}`;
  const item =
    'flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-sm outline-none focus:bg-[var(--surface-hover)]';
  return (
    <header
      className="public-navigation sticky top-0 z-40 border-b bg-background"
      aria-label="Platform controls"
    >
      <div className="wrap flex min-h-16 items-center justify-between gap-3 py-2">
        <Link
          href="/tournaments"
          className="flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm text-muted hover:bg-card"
        >
          <ArrowLeft size={16} />
          Tournaments
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          <AppearanceControl />
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
                  className="z-[70] w-72 max-w-[calc(100vw-24px)] rounded-2xl border bg-card p-2 shadow-xl"
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
        </div>
      </div>
    </header>
  );
}
