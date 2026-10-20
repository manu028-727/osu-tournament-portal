import Link from '@/components/tournament-scope';
import { tournamentList } from '@/lib/tournaments-service';
import { db } from '@/lib/db';
import { getActor } from '@/lib/auth';
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
    (t) =>
      (!mode || t.gameMode === mode) &&
      (!status || (status === 'ARCHIVED' ? !!t.archivedAt : !t.archivedAt && t.status === status)),
  );
  return (
    <main id="main" className="wrap py-10">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4 border-b pb-6">
        <h1 className="text-2xl font-semibold">{platform?.name || 'osu! Tournaments'}</h1>
        <a
          className="text-primary"
          href={
            actor?.workspaceAny ? '/admin/tournaments' : '/api/auth/login?returnTo=/tournaments'
          }
        >
          {actor?.workspaceAny ? 'Organizer workspace' : 'Login with osu!'}
        </a>
      </header>
      {platform?.logo && (
        <img
          src={platform.logo}
          alt={platform.name}
          className="mb-6 h-16 max-w-full object-contain"
        />
      )}
      {platform?.description && <p className="mb-8 max-w-2xl text-muted">{platform.description}</p>}
      <form className="mb-8 flex flex-wrap gap-4" action="/tournaments">
        <label>
          Status
          <select name="status" defaultValue={status}>
            <option value="">All tournaments</option>
            {['UPCOMING', 'REGISTRATIONS_OPEN', 'ONGOING', 'COMPLETED', 'ARCHIVED'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Game mode
          <select name="mode" defaultValue={mode}>
            <option value="">All modes</option>
            {['osu', 'taiko', 'fruits', 'mania'].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <button className="self-end rounded border px-5 py-2">Filter</button>
      </form>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {tournaments.map((t) => (
          <Link
            href={`/t/${t.slug}`}
            key={t.id}
            className="card overflow-hidden hover:border-primary/50"
          >
            {t.settings?.banner && (
              <img src={t.settings.banner} alt="" className="h-44 w-full object-cover" />
            )}
            <div className="p-5">
              <p className="text-xs text-primary">
                {t.gameMode} · {t.archivedAt ? 'ARCHIVED' : t.status}
              </p>
              <h2 className="mt-2 text-xl font-semibold">{t.name}</h2>
              <p className="mt-3 line-clamp-3 text-sm text-muted">{t.description}</p>
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
