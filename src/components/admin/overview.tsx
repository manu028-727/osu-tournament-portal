'use client';
import Link from '@/components/tournament-scope';
import { ArrowRight, Pencil, Send } from 'lucide-react';
import { Button } from '../ui/button';
import type { Actor } from '@/lib/permissions';
import { can } from '@/lib/permissions';
import type { TournamentView } from '@/lib/types';
import { formatDate } from '@/lib/utils';
import { api, ConfirmButton, LoadingState, SectionTitle, useResource, useTask } from './shared';
import styles from './workspace-pilot.module.css';
type Audit = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  actor: { username: string } | null;
};
type Overview = {
  setup: {
    homeSaved: boolean;
    rulesSaved: boolean;
    homePublished: boolean;
    pendingPages: number;
    teams: number;
    matches: number;
  };
  tournament: TournamentView & {
    id: string;
    published: boolean;
    version: number;
    archivedAt: string | null;
  };
  users: number | null;
  staff: number;
  published: number;
  drafts: number | null;
  recent: Audit[];
  stages: {
    id: string;
    name: string;
    slug: string;
    kind: string;
    mappool: { state: string; updatedAt: string } | null;
  }[];
};
export function Overview({ actor }: { actor: Actor }) {
  const { data, error, reload } = useResource<Overview>('overview');
  const { busy, run } = useTask();
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  const t = data.tournament;
  const tasks = [
    {
      label: 'Add tournament information (optional)',
      href: '/admin/website?view=info',
      missing: !t.description,
      allowed: can(actor, 'settings.manage'),
    },
    {
      label: 'Add website artwork (optional)',
      href: '/admin/website?view=branding',
      missing: !t.settings.banner,
      allowed: can(actor, 'settings.manage'),
    },
    {
      label: 'Create a homepage draft',
      href: '/admin/website',
      missing: !data.setup.homeSaved,
      allowed: can(actor, 'homepage.edit'),
    },
    {
      label: 'Publish the saved homepage',
      href: '/admin/website',
      missing: data.setup.homeSaved && !data.setup.homePublished,
      allowed: can(actor, 'homepage.publish'),
    },
    {
      label: 'Add tournament rules (optional)',
      href: '/admin/website?view=rules',
      missing: !data.setup.rulesSaved,
      allowed: can(actor, 'rules.edit'),
    },
    {
      label: 'Create your first stage',
      href: '/admin/mappools?view=stages&new=1&return=pool',
      missing: !data.stages.length,
      allowed: can(actor, 'mappools.create'),
    },
    {
      label: 'Prepare a stage mappool',
      href: '/admin/mappools',
      missing: !!data.stages.length && !data.published,
      allowed: can(actor, 'mappools.edit'),
    },
    {
      label: 'Add teams or solo entrants',
      href: '/admin/teams',
      missing: !data.setup.teams,
      allowed: can(actor, 'teams.create'),
    },
    {
      label: data.stages.every((stage) => stage.kind === 'QUALIFIERS')
        ? 'Schedule a qualifier lobby'
        : 'Create the first match',
      href: data.stages.every((stage) => stage.kind === 'QUALIFIERS')
        ? '/admin/referee/qualifiers'
        : '/admin/matches',
      missing: !!data.published && data.setup.teams >= 2 && !data.setup.matches,
      allowed: can(actor, 'matches.manage'),
    },
    {
      label: 'Add public staff (optional)',
      href: '/admin/staff',
      missing: !data.staff,
      allowed: can(actor, 'staff.edit'),
    },
  ].filter((task) => task.allowed && task.missing);
  const destinations = [
    {
      title: 'Mappools',
      href: '/admin/mappools',
      permission: 'mappools.edit' as const,
      detail: '',
    },
    {
      title: 'Stages',
      href: '/admin/mappools?view=stages',
      permission: 'mappools.create' as const,
      detail: data.stages.length
        ? data.stages
            .map((s) => s.name)
            .slice(0, 2)
            .join(' / ')
        : '',
    },
    { title: 'Matches', href: '/admin/matches', permission: 'matches.manage' as const, detail: '' },
    {
      title: 'Teams & players',
      href: '/admin/teams',
      permission: 'teams.view' as const,
      detail: '',
    },
    {
      title: 'Rules',
      href: '/admin/website?view=rules',
      permission: 'rules.edit' as const,
      detail: '',
    },
  ].filter((destination) => can(actor, destination.permission));
  return (
    <div className={styles.overview}>
      <div className={styles.overviewTop}>
        <section>
          <div className={styles.overviewHeading}>
            <h1>Overview</h1>
            <span className={styles.publication} role="status">
              {t.published ? 'Published' : 'Unpublished'}
            </span>
          </div>
          <div className={styles.actions}>
            {can(actor, 'homepage.edit') && (
              <Button asChild>
                <Link href="/admin/website">
                  <Pencil size={16} />
                  Edit homepage
                </Link>
              </Button>
            )}
            {can(actor, 'tournament.publish') && (
              <ConfirmButton
                variant="outline"
                title={t.published ? 'Unpublish tournament?' : 'Publish tournament?'}
                description={
                  t.published
                    ? 'The public website will become unavailable. Saved content is preserved.'
                    : 'The tournament will become visible to visitors. Only published page revisions will be shown.'
                }
                disabled={busy}
                onConfirm={() =>
                  void run(
                    async () => {
                      await api('/api/tournaments', {
                        method: 'POST',
                        body: JSON.stringify({
                          type: 'lifecycle',
                          id: t.id,
                          baseVersion: t.version,
                          published: !t.published,
                          archived: !!t.archivedAt,
                        }),
                      });
                      await reload();
                    },
                    t.published ? 'Tournament unpublished.' : 'Tournament published.',
                  )
                }
              >
                <Send size={15} />
                {t.published ? 'Unpublish' : 'Publish'}
              </ConfirmButton>
            )}
          </div>
        </section>
        {t.settings.importantDates.length > 0 && (
          <section className={styles.dates}>
            <h2>Key dates</h2>
            <ul>
              {t.settings.importantDates.slice(0, 2).map((date, i) => (
                <li key={i}>
                  {date.label}
                  <time dateTime={date.date}>{formatDate(date.date, t.timezone)}</time>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {data.setup.pendingPages > 0 && (can(actor, 'homepage.edit') || can(actor, 'rules.edit')) && (
        <p className="mt-6 text-sm text-muted">
          Saved page drafts have unpublished changes.{' '}
          <Link className="text-primary" href="/admin/website">
            Review website
          </Link>
        </p>
      )}
      {!!tasks.length && (
        <details open={!t.published} className="mt-6 border-y py-3">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">Getting started</summary>
          <ul className="divide-y">
            {tasks.map((task) => (
              <li key={task.href}>
                <Link
                  className="flex min-h-11 items-center justify-between gap-3 py-3 text-sm"
                  href={task.href}
                >
                  {task.label}
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
      {destinations.length > 0 && (
        <nav className={styles.destinations} aria-label="Tournament management">
          {destinations.map((destination) => (
            <Link key={destination.href} href={destination.href} className={styles.destination}>
              <strong>{destination.title}</strong>
              {destination.detail && <small>{destination.detail}</small>}
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
export function AuditLogs() {
  const { data, error, reload } = useResource<Audit[]>('audit');
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  return (
    <>
      <SectionTitle title="Audit logs" />
      <div className="card overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Resource</th>
            </tr>
          </thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap text-xs text-muted">
                  {new Date(a.createdAt).toLocaleString()}
                </td>
                <td>{a.actor?.username || 'System'}</td>
                <td className="font-mono text-xs text-primary">{a.action}</td>
                <td className="max-w-48 truncate text-xs text-muted" title={a.entityId}>
                  {a.entityType} / {a.entityId}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.length && (
          <p className="p-12 text-center text-sm text-muted">
            No administrative actions recorded yet.
          </p>
        )}
      </div>
      <p className="mt-4 text-xs text-muted">Showing the 150 most recent actions.</p>
    </>
  );
}
export function SheetData() {
  const { data, error, reload } = useResource<{
    tournament: { name: string };
    mappools: { name: string; slug: string }[];
  }>('sheet-data');
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  return (
    <>
      <SectionTitle title="Sheet data" />
      <div className="card p-6">
        <p className="mb-6 text-lg font-semibold">{data.tournament.name}</p>
        <div className="overflow-x-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Stage</th>
                <th>Published URL</th>
              </tr>
            </thead>
            <tbody>
              {data.mappools.map((p) => (
                <tr key={p.slug}>
                  <td>{p.name}</td>
                  <td>
                    <Link href={`/mappools/${p.slug}`} className="text-primary">
                      /mappools/{p.slug}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.mappools.length && (
          <p className="text-sm text-muted">No mappools have been published yet.</p>
        )}
      </div>
    </>
  );
}
