import type { QualifierStandingRow } from '@/lib/qualifier-seeding';
import type { PublishedQualifierStandings } from '@/lib/qualifier-standings-service';
import { QUALIFIER_METHOD_LABELS, type QualifierPolicy } from '@/lib/qualifier-policy';

const number = (value: number | null) =>
  value === null ? '-' : value.toLocaleString('en-US', { maximumFractionDigits: 4 });

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
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">
          Qualifier standings: {QUALIFIER_METHOD_LABELS[method]}
        </caption>
        <thead className="border-b text-xs text-muted">
          <tr>
            <th scope="col" className="w-16 px-3 py-3">
              Seed
            </th>
            <th scope="col" className="px-3 py-3">
              Participant
            </th>
            <th scope="col" className="px-3 py-3">
              Status
            </th>
            <th scope="col" className="px-3 py-3 text-right">
              {method === 'Z_SUM' ? 'Z-Sum' : method === 'MATCH_COST' ? 'Match cost' : 'Score'}
            </th>
            {cutoff !== null && (
              <th scope="col" className="px-3 py-3">
                Qualification
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.participantId} className="border-b align-top">
              <td className="px-3 py-4 tabular-nums">
                {row.seed ?? (row.tied ? `T${row.rank}` : '-')}
              </td>
              <th scope="row" className="min-w-40 max-w-96 px-3 py-4 font-medium break-words">
                {row.name}
                {details && (
                  <details className="mt-2 text-xs font-normal">
                    <summary className="cursor-pointer text-muted">Map breakdown</summary>
                    <div className="mt-3 space-y-3">
                      {row.breakdown.map((map) => {
                        const selected = row.selected.find((s) => s.slotName === map.slotName)!;
                        return (
                          <div key={map.slotName} className="border-l-2 pl-3">
                            <p className="font-semibold">
                              {map.slotName} · Run {selected.run}
                            </p>
                            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted">
                              <dt>Map score</dt>
                              <dd title={String(map.score)}>{number(map.score)}</dd>
                              <dt>Contribution</dt>
                              <dd title={String(map.contribution)}>{number(map.contribution)}</dd>
                              {(method === 'Z_SUM' || method === 'MATCH_COST') && (
                                <>
                                  <dt>Cohort mean</dt>
                                  <dd>{number(map.mean)}</dd>
                                </>
                              )}
                              {method === 'Z_SUM' && (
                                <>
                                  <dt>Sample deviation</dt>
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
                                  : {number(p.raw)} raw / {number(p.adjusted)} adjusted
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                      {!row.breakdown.length && (
                        <p className="text-muted">No eligible map scores.</p>
                      )}
                    </div>
                  </details>
                )}
              </th>
              <td className="px-3 py-4 text-muted">
                {!row.eligible
                  ? 'Excluded'
                  : !row.complete
                    ? 'Incomplete'
                    : row.seed === null && row.tied
                      ? 'Tiebreak pending'
                      : row.tied
                        ? 'Tiebreak reviewed'
                        : 'Complete'}
                {row.selectedRun !== null && (
                  <span className="mt-1 block text-xs">Run {row.selectedRun}</span>
                )}
              </td>
              <td className="px-3 py-4 text-right tabular-nums" title={String(row.value)}>
                {number(row.value)}
              </td>
              {cutoff !== null && (
                <td className="px-3 py-4">
                  {row.seed === null
                    ? 'Pending'
                    : row.seed <= cutoff
                      ? 'Qualified'
                      : 'Below cutoff'}
                </td>
              )}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={cutoff === null ? 4 : 5} className="px-3 py-8 text-center text-muted">
                No qualifier performances.
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
  if (!standings) return null;
  return (
    <section className="min-w-0 space-y-4" aria-label={`${standings.stageName} standings`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-3">
        <h2 className="text-xl font-semibold">{standings.stageName}</h2>
        <p className="text-sm text-muted">
          {QUALIFIER_METHOD_LABELS[standings.method]} · Finalized · Version {standings.version}
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
