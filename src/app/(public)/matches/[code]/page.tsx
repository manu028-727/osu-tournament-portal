import Link from '@/components/tournament-scope';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink, Users } from 'lucide-react';
import { publicMatches, publicMatchHistory } from '@/lib/public-matches';
import { matchTime, PUBLIC_MATCH_STATUS, bracketEntrant } from '@/lib/match-display';
import { Badge } from '@/components/ui/badge';
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const m = (await publicMatches({ code: (await params).code }))[0];
  return {
    title: m ? `#${m.code} · ${m.participants.A.name} vs ${m.participants.B.name}` : 'Incontro',
  };
}
export default async function Match({ params }: { params: Promise<{ code: string }> }) {
  const m = await publicMatchHistory((await params).code);
  if (!m) notFound();
  return (
    <div className="wrap py-12 md:py-16">
      <Link href="/matches" className="inline-flex items-center gap-2 text-sm text-primary">
        <ArrowLeft size={18} />
        Tutti gli incontri
      </Link>
      <header className="mt-8 border-b pb-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted">
            Incontro #{m.code} · {m.stage.name} · {m.bracket}
          </p>
          <Badge>{PUBLIC_MATCH_STATUS[m.status]}</Badge>
        </div>
        <h1 className="sr-only">
          {m.participants.A.name} contro {m.participants.B.name}
        </h1>
        <div className="my-8 grid grid-cols-2 items-center gap-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          {(['A', 'B'] as const).map((side, i) => (
            <div
              key={side}
              className={`min-w-0 ${i ? 'col-start-2 row-start-2 text-right sm:col-start-3 sm:row-start-1' : 'col-start-1 row-start-2 sm:row-start-1'}`}
            >
              <h2
                className={`break-words text-2xl font-semibold md:text-3xl ${i ? 'text-sky-200' : 'text-red-200'}`}
              >
                {m.participants[side].name}
              </h2>
              {m.forfeitSide === side && <p className="mt-2 text-sm text-amber-200">Forfait</p>}
            </div>
          ))}
          <p className="col-span-2 row-start-1 whitespace-nowrap text-center text-4xl font-semibold sm:col-span-1 sm:col-start-2">
            {m.status === 'SCHEDULED'
              ? 'vs'
              : `${m.forfeitSide === 'A' ? 'FF' : m.scoreA} : ${m.forfeitSide === 'B' ? 'FF' : m.scoreB}`}
          </p>
        </div>
        <p className="text-sm text-muted">
          {matchTime(m.scheduledAt, m.timezone)} · {m.timezone}
        </p>
      </header>
      <dl className="my-8 grid gap-6 border-b pb-8 sm:grid-cols-3">
        {[
          ['Referee', m.credits.referee],
          ['Streamer', m.credits.streamer],
          ['Commento', m.credits.commentators.join(', ')],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="mt-1 break-words font-semibold">{value || 'Da definire'}</dd>
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
          Multiplayer osu!
          <ExternalLink size={18} />
        </a>
      )}
      {m.resultMode === 'SUMMARY' && (
        <p className="mt-5 text-sm text-muted">
          Risultato storico importato. I punteggi delle singole mappe non sono disponibili.
        </p>
      )}
      {m.bracket === 'Reset' && (
        <p className="mt-5 text-sm text-muted">
          Il reset viene disputato solo se richiesto dall’esito della Grand Final.
        </p>
      )}
      {!!m.history.length && (
        <section aria-label="Match action history" className="mt-8 border-y py-6">
          <h2 className="mb-4 text-xl font-semibold">Cronologia della partita</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="px-2 py-3">#</th>
                  <th className="px-2 py-3">Team</th>
                  <th className="px-2 py-3">Azione</th>
                  <th className="px-2 py-3">Mappa</th>
                  <th className="px-2 py-3">Vincitore</th>
                  <th className="px-2 py-3">Punteggio</th>
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
                        {p.captain ? 'Capitano' : p.substitute ? 'Riserva' : 'Giocatore'}
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-muted">
                {bracketEntrant(m.participants[side].name)} · esito da definire
              </p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
