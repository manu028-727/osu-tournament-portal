'use client';
import Link from '@/components/tournament-scope';
import { ArrowUpRight, Users, Disc3, FileEdit, Activity, CalendarDays, Music2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge, StateBadge } from '../ui/badge';
import type { Actor } from '@/lib/permissions';
import { can } from '@/lib/permissions';
import type { TournamentView } from '@/lib/types';
import { formatDate } from '@/lib/utils';
import { LoadingState, SectionTitle, useResource } from './shared';
type Audit = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  actor: { username: string } | null;
};
type Overview = {
  tournament: TournamentView;
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
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  const t = data.tournament;
  const quick = [
    {
      title: 'Homepage',
      href: '/admin/homepage',
      permission: 'homepage.edit' as const,
    },
    {
      title: 'Mappools',
      href: '/admin/mappools',
      permission: 'mappools.edit' as const,
    },
    {
      title: 'Staff',
      href: '/admin/staff',
      permission: 'staff.edit' as const,
    },
    {
      title: 'Rules',
      href: '/admin/rules',
      permission: 'rules.edit' as const,
    },
  ].filter((q) => can(actor, q.permission));
  return (
    <>
      <SectionTitle title="Overview" />
      <div className="card relative mb-7 overflow-hidden p-7 md:p-9">
        <img
          src={t.settings.banner}
          alt=""
          className="absolute inset-0 size-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-card via-card/90 to-transparent" />
        <div className="relative">
          <Badge className="mb-5 border-emerald-200/20 text-emerald-200">
            <span className="size-1 rounded-full bg-current" />
            {t.status.replaceAll('_', ' ').toLowerCase()}
          </Badge>
          <h2 className="text-3xl font-semibold tracking-tight">{t.name}</h2>
          {t.description && (
            <p className="mt-3 max-w-lg text-xs leading-6 text-white/60">{t.description}</p>
          )}
          <div className="mt-6 flex gap-3">
            <Button asChild size="sm">
              <Link href="/">
                Visit tournament
                <ArrowUpRight size={13} />
              </Link>
            </Button>
            {can(actor, 'settings.manage') && (
              <Button asChild size="sm" variant="outline">
                <Link href="/admin/settings">Tournament settings</Link>
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="mb-9 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[
          {
            label: 'Website users',
            value: data.users,
            Icon: Users,
            note: 'Authenticated osu! accounts',
          },
          {
            label: 'Staff members',
            value: data.staff,
            Icon: Users,
            note: 'Across all public positions',
          },
          {
            label: 'Published pools',
            value: data.published,
            Icon: Disc3,
            note: 'Visible to the community',
          },
          {
            label: 'Pools with drafts',
            value: data.drafts,
            Icon: FileEdit,
            note: 'Saved mappool revisions',
          },
        ].map((m) => (
          <div className="card p-5 md:p-6" key={m.label}>
            <div className="mb-5 flex items-center justify-between">
              <span className="text-[11px] text-muted">{m.label}</span>
              <m.Icon size={16} className="text-primary/70" />
            </div>
            <span className="text-4xl font-semibold tracking-tight">{m.value ?? '—'}</span>
            <p className="mt-3 text-[10px] text-muted">{m.note}</p>
          </div>
        ))}
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          {quick.length > 0 && (
            <section>
              <h2 className="mb-4 text-base font-semibold">Content</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {quick.map((q) => (
                  <Link
                    key={q.href}
                    href={q.href}
                    className="card group p-5 hover:border-primary/20"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium">{q.title}</h3>
                      <ArrowUpRight size={15} className="text-muted group-hover:text-primary" />
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
          <section className="card p-6">
            <div className="mb-5 flex justify-between">
              <h2 className="text-sm font-semibold">Tournament stages</h2>
              <Music2 size={15} className="text-muted" />
            </div>
            {data.stages.map((s, i) => (
              <div
                key={s.id}
                className="flex items-center justify-between border-b py-4 last:border-0"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[10px] text-muted">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="text-xs">{s.name}</span>
                </div>
                <StateBadge state={s.mappool?.state || 'DRAFT'} />
              </div>
            ))}
          </section>
        </div>
        <div className="space-y-6">
          <section className="card p-6">
            <div className="mb-5 flex justify-between">
              <h2 className="text-sm font-semibold">On the horizon</h2>
              <CalendarDays size={15} className="text-primary" />
            </div>
            {t.settings.importantDates.map((d, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-3 border-b py-4 last:border-0"
              >
                <span className="text-xs text-muted">{d.label}</span>
                <span className="text-[11px] font-medium">{formatDate(d.date)}</span>
              </div>
            ))}
          </section>
          {can(actor, 'audit.view') && (
            <section className="card p-6">
              <div className="mb-5 flex justify-between">
                <h2 className="text-sm font-semibold">Recent activity</h2>
                <Activity size={15} className="text-muted" />
              </div>
              {data.recent.length ? (
                data.recent.map((a) => (
                  <div key={a.id} className="flex gap-3 border-b py-4 last:border-0">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/60" />
                    <div>
                      <p className="text-xs">
                        {a.actor?.username || 'System'}{' '}
                        <span className="text-muted">· {a.action}</span>
                      </p>
                      <p className="mt-2 text-[10px] text-muted">
                        {new Date(a.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="py-7 text-xs text-muted">Administrative activity will appear here.</p>
              )}
              <Link
                href="/admin/audit"
                className="mt-4 inline-flex items-center gap-2 text-[11px] text-primary"
              >
                View audit log
                <ArrowUpRight size={12} />
              </Link>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
export function AuditLogs() {
  const { data, error, reload } = useResource<Audit[]>('audit');
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  return (
    <>
      <SectionTitle
        title="Audit logs"
        description="A record of significant administrative actions. Entries are written alongside content changes."
      />
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
      <p className="mt-4 text-[11px] text-muted">Showing the 150 most recent actions.</p>
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
      <SectionTitle
        title="Sheet data"
        description="Designated tournament fields available to Sheeters. This view contains only tournament identity and published stage references."
      />
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
