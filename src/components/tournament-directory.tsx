import Link from '@/components/tournament-scope';
import { tournamentList } from '@/lib/tournaments-service';
import { db } from '@/lib/db';
import { getActor } from '@/lib/auth';
import { ArrowUpRight, Search } from 'lucide-react';
import { Button } from './ui/button';
import { AppearanceControl } from './appearance';
export async function TournamentDirectory({
  status = '',
  mode = '',
}: {
  status?: string;
  mode?: string;
}) {
  const [items, platform, actor] = await Promise.all([
    tournamentList(null, true),
    db.platformSettings.findUnique({ where: { id: 'main' } }),
    getActor(),
  ]);
  const tournaments = items.filter(
    (t) => (!mode || t.gameMode === mode) && (!status || t.status === status),
  );
  return (
    <main id="main" className="directory wrap py-7">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b pb-5">
        <div className="flex min-w-0 items-center gap-4">
          {platform?.logo && <img src={platform.logo} alt="" className="size-12 object-contain" />}
          <div>
            <p className="eyebrow mb-1">osu! community</p>
            <h1 className="text-2xl font-semibold">{platform?.name || 'osu! Tournaments'}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AppearanceControl />
          <Button asChild variant="outline" size="sm">
            <a
              href={
                actor?.workspaceAny ? '/admin/tournaments' : '/api/auth/login?returnTo=/tournaments'
              }
            >
              {actor?.workspaceAny ? 'Organizer workspace' : 'Login with osu!'}
              <ArrowUpRight size={16} />
            </a>
          </Button>
        </div>
      </header>
      {platform?.description && <p className="mb-8 max-w-2xl text-muted">{platform.description}</p>}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4 border-b pb-5">
        <h2 className="text-lg font-semibold">
          Tournaments{' '}
          <span className="ml-2 font-mono text-sm text-muted">{tournaments.length}</span>
        </h2>
        <form className="directory-filters flex flex-wrap items-end gap-3" action="/tournaments">
          <label className="field">
            Status
            <select name="status" defaultValue={status}>
              <option value="">All tournaments</option>
              {['UPCOMING', 'REGISTRATIONS_OPEN', 'ONGOING', 'COMPLETED'].map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase().replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Game mode
            <select name="mode" defaultValue={mode}>
              <option value="">All modes</option>
              {['osu', 'taiko', 'fruits', 'mania'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <Button variant="outline" type="submit">
            <Search size={16} />
            Filter
          </Button>
        </form>
      </div>
      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tournaments.map((t) => (
          <Link
            href={`/t/${t.slug}`}
            key={t.id}
            className="tournament-tile card group min-w-0 overflow-hidden hover:border-primary/50"
          >
            {t.settings?.banner && (
              <img src={t.settings.banner} alt="" className="h-32 w-full object-cover" />
            )}
            <div className="p-4">
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="font-mono">{t.gameMode}</span>
                <span aria-hidden="true">/</span>
                {t.status.charAt(0) + t.status.slice(1).toLowerCase().replaceAll('_', ' ')}
              </p>
              <div className="mt-2 flex items-start justify-between gap-3">
                <h3 className="text-xl font-semibold">{t.name}</h3>
                <ArrowUpRight
                  size={18}
                  className="mt-1 shrink-0 text-muted group-hover:text-primary"
                />
              </div>
              {t.description && (
                <p className="mt-2 line-clamp-2 text-sm text-muted">{t.description}</p>
              )}
              {t.startsAt && (
                <p className="mt-3 text-sm text-muted">
                  {t.startsAt.toLocaleDateString('it-IT', { timeZone: t.timezone })}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
      {!tournaments.length && (
        <div className="border-y py-12 space-y-4">
          <p className="text-muted">
            {items.length ? 'No tournaments match these filters.' : 'No tournaments published yet.'}
          </p>
          {actor?.platformAdmin && (
            <a className="text-primary" href="/admin/tournaments">
              Create tournament
            </a>
          )}
          {!platform?.ownerBootstrappedAt && (
            <a className="block text-primary" href="/setup">
              Setup
            </a>
          )}
        </div>
      )}
      {(platform?.footer ||
        platform?.contact ||
        (Array.isArray(platform?.socialLinks) && platform.socialLinks.length > 0)) && (
        <footer className="mt-12 border-t pt-6 text-sm text-muted space-y-3">
          <p>{platform?.footer}</p>
          <p>{platform?.contact}</p>
          {((platform?.socialLinks as { label: string; href: string }[]) || []).map((l) => (
            <a key={l.href} href={l.href} rel="noopener noreferrer" className="mr-5">
              {l.label}
            </a>
          ))}
        </footer>
      )}
    </main>
  );
}
