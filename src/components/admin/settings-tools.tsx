'use client';
import { localeTag } from '@/lib/i18n';
import { useLocale, useT } from '@/components/locale';

import Link from '@/components/tournament-scope';
import { LoadingState, SectionTitle, useResource } from './shared';
type Audit = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  actor: { username: string } | null;
};
export function AuditLogs() {
  const language = useLocale();
  const tr = useT();
  const { data, error, reload } = useResource<Audit[]>('audit');
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  return (
    <>
      <SectionTitle title={tr('Audit logs')} />
      <div className="card overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{tr('Time')}</th>
              <th>{tr('Actor')}</th>
              <th>{tr('Action')}</th>
              <th>{tr('Resource')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap text-xs text-muted">
                  {new Date(a.createdAt).toLocaleString(localeTag(language))}
                </td>
                <td>{a.actor?.username || tr('System')}</td>
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
            {tr('No administrative actions recorded yet.')}
          </p>
        )}
      </div>
      <p className="mt-4 text-xs text-muted">{tr('Showing the 150 most recent actions.')}</p>
    </>
  );
}
export function SheetData() {
  const tr = useT();
  const { data, error, reload } = useResource<{
    tournament: { name: string };
    mappools: { name: string; slug: string }[];
  }>('sheet-data');
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  return (
    <>
      <SectionTitle title={tr('Sheet data')} />
      <div className="card p-6">
        <p className="mb-6 text-lg font-semibold">{data.tournament.name}</p>
        <div className="overflow-x-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{tr('Stage')}</th>
                <th>{tr('Published URL')}</th>
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
          <p className="text-sm text-muted">{tr('No mappools have been published yet.')}</p>
        )}
      </div>
    </>
  );
}
