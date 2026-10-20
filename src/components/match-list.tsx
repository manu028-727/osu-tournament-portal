import Link from '@/components/tournament-scope';
import { ArrowUpRight } from 'lucide-react';
import { MatchStatusBadge } from './ui/badge';
import { matchTime, PUBLIC_MATCH_STATUS } from '@/lib/match-display';
import type { PublicMatch } from '@/lib/public-matches';

export function MatchList({ matches }: { matches: PublicMatch[] }) {
  return (
    <div>
      <div className="md:hidden">
        {matches.map((m) => (
          <Link
            key={m.id}
            href={`/matches/${encodeURIComponent(m.code)}`}
            className="block border-b py-4"
            data-match-status={m.status}
            aria-label={`Apri incontro ${m.code}`}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <p className="min-w-0 text-xs text-muted">
                <span className="font-semibold text-primary">#{m.code}</span> · {m.stage.name}
                <span className="mt-1 block">{m.bracket}</span>
              </p>
              <MatchStatusBadge status={m.status}>{PUBLIC_MATCH_STATUS[m.status]}</MatchStatusBadge>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2">
              {(['A', 'B'] as const).map((side) => (
                <div key={side} className="contents">
                  <p
                    className={`min-w-0 font-semibold ${side === 'A' ? 'text-red-200' : 'text-sky-200'}`}
                  >
                    {m.participants[side].name}
                  </p>
                  <p className="min-w-8 text-right font-mono text-xl tabular-nums">
                    {m.status === 'SCHEDULED'
                      ? '?'
                      : m.forfeitSide === side
                        ? 'FF'
                        : side === 'A'
                          ? m.scoreA
                          : m.scoreB}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-4 flex items-center justify-between gap-3 text-xs text-muted">
              {matchTime(m.scheduledAt, m.timezone)}
              <ArrowUpRight size={17} className="shrink-0 text-primary" />
            </p>
          </Link>
        ))}
      </div>
      <div className="relative hidden overflow-x-auto md:block">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Incontro</th>
              <th>Squadre</th>
              <th>Risultato</th>
              <th>Data</th>
              <th>Stato</th>
              <th>
                <span className="sr-only">Dettagli</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {matches.map((m) => (
              <tr key={m.id} data-match-status={m.status}>
                <td className="min-w-32">
                  <Link
                    className="font-semibold text-primary"
                    href={`/matches/${encodeURIComponent(m.code)}`}
                  >
                    #{m.code}
                  </Link>
                  <p className="mt-1 text-xs text-muted">
                    {m.stage.name} · {m.bracket}
                  </p>
                </td>
                <td className="min-w-52">
                  <p className="text-red-200">{m.participants.A.name}</p>
                  <p className="mt-1 text-sky-200">{m.participants.B.name}</p>
                </td>
                <td className="whitespace-nowrap font-mono text-lg tabular-nums">
                  {m.status === 'SCHEDULED'
                    ? 'vs'
                    : `${m.forfeitSide === 'A' ? 'FF' : m.scoreA} : ${m.forfeitSide === 'B' ? 'FF' : m.scoreB}`}
                </td>
                <td className="min-w-40 text-sm text-muted">
                  {matchTime(m.scheduledAt, m.timezone)}
                </td>
                <td>
                  <MatchStatusBadge status={m.status}>
                    {PUBLIC_MATCH_STATUS[m.status]}
                  </MatchStatusBadge>
                </td>
                <td>
                  <Link
                    className="inline-flex size-10 items-center justify-center rounded-md hover:bg-[var(--surface-hover)]"
                    href={`/matches/${encodeURIComponent(m.code)}`}
                    aria-label={`Apri incontro ${m.code}`}
                    title="Dettagli incontro"
                  >
                    <ArrowUpRight size={20} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
