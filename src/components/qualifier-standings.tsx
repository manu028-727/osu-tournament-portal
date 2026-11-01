'use client';
import { localeTag } from '@/lib/i18n';
import { useLocale, useT } from '@/components/locale';
import type { QualifierStandingRow } from '@/lib/qualifier-seeding';
import type { PublishedQualifierStandings } from '@/lib/qualifier-standings-contract';
import { QUALIFIER_METHOD_LABELS, type QualifierPolicy } from '@/lib/qualifier-policy';

export function QualifierStandingsTable({
  rows,
  method,
  cutoff = null,
  details = true,
}: {
  rows: QualifierStandingRow[];
  method: QualifierPolicy['method'];
  cutoff?: number | null;
  details?: boolean;
}) {
  const language = useLocale();
  const tr = useT();
  const number = (value: number | null) =>
    value === null ? '-' : value.toLocaleString(localeTag(language), { maximumFractionDigits: 4 });
  return (
    <div
      className="overflow-x-auto"
      role="region"
      aria-label={tr('Qualifier standings table')}
      tabIndex={0}
    >
      <table className="w-full text-left text-sm">
        <caption className="sr-only">
          {tr('Qualifier standings:')} {tr(QUALIFIER_METHOD_LABELS[method])}
        </caption>
        <thead className="border-b text-xs text-muted">
          <tr>
            <th scope="col" className="w-16 px-3 py-3">
              {tr('Seed')}
            </th>
            <th scope="col" className="px-3 py-3">
              {tr('Participant')}
            </th>
            <th scope="col" className="px-3 py-3">
              {tr('Status')}
            </th>
            <th scope="col" className="px-3 py-3 text-right">
              {method === 'Z_SUM'
                ? tr('Z-Sum')
                : method === 'MATCH_COST'
                  ? tr('Match cost')
                  : tr('Score')}
            </th>
            {cutoff !== null && (
              <th scope="col" className="px-3 py-3">
                {tr('Qualification')}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.participantId} className="border-b align-top">
              <td className="px-3 py-2 tabular-nums">
                {row.seed ?? (row.tied ? tr('T{0}', row.rank) : '-')}
              </td>
              <th scope="row" className="min-w-40 max-w-96 px-3 py-2 font-medium break-words">
                {row.name}
                {details && (
                  <details className="mt-2 text-xs font-normal">
                    <summary className="cursor-pointer text-muted">{tr('Map breakdown')}</summary>
                    <div className="mt-3 space-y-3">
                      {row.breakdown.map((map) => {
                        const selected = row.selected.find((s) => s.slotName === map.slotName)!;
                        return (
                          <div key={map.slotName} className="border-l-2 pl-3">
                            <p className="font-semibold">
                              {map.slotName} {tr('· Run')} {selected.run}
                            </p>
                            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted">
                              <dt>{tr('Map score')}</dt>
                              <dd title={String(map.score)}>{number(map.score)}</dd>
                              <dt>{tr('Contribution')}</dt>
                              <dd title={String(map.contribution)}>{number(map.contribution)}</dd>
                              {(method === 'Z_SUM' || method === 'MATCH_COST') && (
                                <>
                                  <dt>{tr('Cohort mean')}</dt>
                                  <dd>{number(map.mean)}</dd>
                                </>
                              )}
                              {method === 'Z_SUM' && (
                                <>
                                  <dt>{tr('Sample deviation')}</dt>
                                  <dd>{number(map.sampleDeviation)}</dd>
                                </>
                              )}
                            </dl>
                            <ul className="mt-2 space-y-1 text-muted">
                              {selected.players.map((p) => (
                                <li key={p.osuId}>
                                  <a
                                    href={`https://osu.ppy.sh/users/${p.osuId}`}
                                    className="text-primary"
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {p.osuId}
                                  </a>
                                  : {number(p.raw)} {tr('raw /')} {number(p.adjusted)}{' '}
                                  {tr('adjusted')}
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                      {!row.breakdown.length && (
                        <p className="text-muted">{tr('No eligible map scores.')}</p>
                      )}
                    </div>
                  </details>
                )}
              </th>
              <td className="px-3 py-2 text-muted">
                {!row.eligible
                  ? tr('Excluded')
                  : !row.complete
                    ? tr('Incomplete')
                    : row.seed === null && row.tied
                      ? tr('Tiebreak pending')
                      : row.tied
                        ? tr('Tiebreak reviewed')
                        : tr('Complete')}
                {row.selectedRun !== null && (
                  <span className="mt-1 block text-xs">
                    {tr('Run')} {row.selectedRun}
                  </span>
                )}
              </td>
              <td className="px-3 py-4 text-right tabular-nums" title={String(row.value)}>
                {number(row.value)}
              </td>
              {cutoff !== null && (
                <td className="px-3 py-4">
                  {row.seed === null
                    ? tr('Pending')
                    : row.seed <= cutoff
                      ? tr('Qualified')
                      : tr('Below cutoff')}
                </td>
              )}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={cutoff === null ? 4 : 5} className="px-3 py-8 text-center text-muted">
                {tr('No qualifier performances.')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function QualifierStandings({
  standings,
}: {
  standings: PublishedQualifierStandings | null;
}) {
  const tr = useT();
  if (!standings) return null;
  return (
    <section className="min-w-0 space-y-4" aria-label={tr('{0} standings', standings.stageName)}>
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-3">
        <h2 className="text-xl font-semibold">{standings.stageName}</h2>
        <p className="text-sm text-muted">
          {tr(QUALIFIER_METHOD_LABELS[standings.method])} {tr('· Finalized · Version')}{' '}
          {standings.version}
        </p>
      </header>
      <QualifierStandingsTable
        rows={standings.rows}
        method={standings.method}
        cutoff={standings.cutoff}
      />
    </section>
  );
}
