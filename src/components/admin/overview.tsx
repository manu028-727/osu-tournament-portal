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
    mappool: { state: string; updatedAt: string } | null;
  }[];
};
export function Overview({ actor }: { actor: Actor }) {
  const { data, error, reload } = useResource<Overview>('overview');
  const { busy, run } = useTask();
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  const t = data.tournament;
  const destinations = [
    {
      title: 'Mappools',
      href: '/admin/mappools',
      permission: 'mappools.edit' as const,
      detail: '',
    },
    {
      title: 'Stages',
      href: '/admin/stages',
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
    { title: 'Rules', href: '/admin/rules', permission: 'rules.edit' as const, detail: '' },
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
                <Link href="/admin/homepage">
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
