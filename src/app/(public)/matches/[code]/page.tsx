import { getLocale, getServerT } from '@/lib/server-locale';
import Link from '@/components/tournament-scope';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink, Users } from 'lucide-react';
import { publicMatches, publicMatchHistory } from '@/lib/public-matches';
import { matchTime, PUBLIC_MATCH_STATUS, bracketEntrant } from '@/lib/match-display';
import { MatchStatusBadge } from '@/components/ui/badge';
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const tr = await getServerT();
  const m = (await publicMatches({ code: (await params).code }))[0];
  return {
    title: m
      ? tr('Match {0} · {1} vs {2}', m.matchNumber, m.participants.A.name, m.participants.B.name)
      : tr('Incontro'),
  };
}
export default async function Match({ params }: { params: Promise<{ code: string }> }) {
  const language = await getLocale();
  const tr = await getServerT();
  const m = await publicMatchHistory((await params).code);
  if (!m) notFound();
  return (
    <div className="wrap py-8">
      <Link href="/matches" className="inline-flex items-center gap-2 text-sm text-primary">
        <ArrowLeft size={18} />
        {tr('Tutti gli incontri')}
      </Link>
      <header className="public-scoreboard mt-6 border-b pb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted">
            {tr('Incontro')} {m.matchNumber} · {m.stage.name} · {m.bracket}
            {m.code !== String(m.matchNumber) ? tr(' · Ref {0}', m.code) : ''}
          </p>
          <MatchStatusBadge status={m.status}>{tr(PUBLIC_MATCH_STATUS[m.status])}</MatchStatusBadge>
        </div>
        <h1 className="sr-only">
          {m.participants.A.name} {tr('contro')} {m.participants.B.name}
        </h1>
        <div className="my-5 grid grid-cols-2 items-center gap-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          {(['A', 'B'] as const).map((side, i) => (
            <div
              key={side}
              className={`min-w-0 ${i ? 'col-start-2 row-start-2 text-right sm:col-start-3 sm:row-start-1' : 'col-start-1 row-start-2 sm:row-start-1'}`}
            >
              <h2
                className={`break-words text-xl font-semibold md:text-2xl ${i ? 'text-sky-200' : 'text-red-200'}`}
              >
                {m.participants[side].name}
              </h2>
              {m.forfeitSide === side && (
                <p className="mt-2 text-sm text-amber-200">{tr('Forfait')}</p>
              )}
            </div>
          ))}
          <p className="col-span-2 row-start-1 whitespace-nowrap text-center font-mono text-3xl tabular-nums sm:col-span-1 sm:col-start-2">
            {m.status === 'SCHEDULED'
              ? tr('vs')
              : `${m.forfeitSide === 'A' ? tr('FF') : m.scoreA} : ${m.forfeitSide === 'B' ? tr('FF') : m.scoreB}`}
          </p>
        </div>
        <p className="text-sm text-muted">
          {matchTime(m.scheduledAt, m.timezone, language)} · {m.timezone}
        </p>
      </header>
      <dl className="my-5 grid gap-4 border-b pb-5 sm:grid-cols-3">
        {[
          ['Referee', m.credits.referee],
          ['Streamer', m.credits.streamer],
          ['Commento', m.credits.commentators.join(', ')],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-muted">{tr(label)}</dt>
            <dd className="mt-1 break-words font-semibold">{value || tr('Da definire')}</dd>
          </div>
        ))}
      </dl>
      {m.lobbyUrl && (
        <a
          href={m.lobbyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-primary"
        >
          {tr('Multiplayer osu!')}
          <ExternalLink size={18} />
        </a>
      )}
      {m.resultMode === 'SUMMARY' && (
        <p className="mt-5 text-sm text-muted">
          {tr('Risultato storico importato. I punteggi delle singole mappe non sono disponibili.')}
        </p>
      )}
      {m.bracket === 'Reset' && (
        <p className="mt-5 text-sm text-muted">
          {tr('Il reset viene disputato solo se richiesto dall’esito della Grand Final.')}
        </p>
      )}
      {!!m.history.length && (
        <section aria-label={tr('Match action history')} className="mt-8 border-y py-6">
          <h2 className="mb-4 text-xl font-semibold">{tr('Cronologia della partita')}</h2>
          <div className="overflow-x-auto">
            <table className="history-table w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="px-2 py-3">#</th>
                  <th className="px-2 py-3">{tr('Team')}</th>
                  <th className="px-2 py-3">{tr('Azione')}</th>
                  <th className="px-2 py-3">{tr('Mappa')}</th>
                  <th className="px-2 py-3">{tr('Vincitore')}</th>
                  <th className="px-2 py-3">{tr('Punteggio')}</th>
                </tr>
              </thead>
              <tbody>
                {m.history.map((a, index) => (
                  <tr key={a.sequence} data-history-sequence={a.sequence} className="border-t">
                    <td className="px-2 py-3">{index + 1}</td>
                    <td className={`px-2 py-3 ${a.side === 'A' ? 'text-red-200' : 'text-sky-200'}`}>
                      {m.participants[a.side].name}
                    </td>
                    <td className="px-2 py-3">
                      {{ BAN: 'Ban', PROTECT: 'Protect', PICK: 'Pick' }[a.kind]}
                    </td>
                    <td className="px-2 py-3 font-mono">
                      {a.beatmapId ? (
                        <a
                          className="text-primary"
                          href={`https://osu.ppy.sh/beatmaps/${a.beatmapId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {a.slotName}
                        </a>
                      ) : (
                        a.slotName
                      )}
                    </td>
                    <td className="px-2 py-3">
                      {a.winnerSide ? m.participants[a.winnerSide].name : '-'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-3">
                      {a.winnerSide ? `${a.pointsA} : ${a.pointsB}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className="mt-10 grid gap-8 md:grid-cols-2">
        {(['A', 'B'] as const).map((side) => (
          <section key={side}>
            <h2 className="mb-5 flex items-center gap-3 text-xl font-semibold">
              <Users size={22} />
              {m.participants[side].name}
            </h2>
            {m.participants[side].members.length ? (
              <div className="space-y-4">
                {m.participants[side].members.map((p) => (
                  <a
                    key={p.osuId}
                    href={`https://osu.ppy.sh/users/${p.osuId}`}
                    className="flex items-center gap-4 border-b pb-4"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img src={p.avatarUrl} alt="" className="size-12 rounded-md" />
                    <div className="min-w-0">
                      <p className="break-words font-semibold">{p.username}</p>
                      <p className="text-sm text-muted">
                        {p.captain
                          ? tr('Capitano')
                          : p.substitute
                            ? tr('Riserva')
                            : tr('Giocatore')}
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-muted">
                {bracketEntrant(m.participants[side].name, language)} {tr('· esito da definire')}
              </p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
