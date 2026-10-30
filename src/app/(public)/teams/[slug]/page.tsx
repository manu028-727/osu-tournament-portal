import { localeTag } from '@/lib/i18n';
import { getLocale, getServerT } from '@/lib/server-locale';
import Link from '@/components/tournament-scope';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { publicTeams } from '@/lib/teams-service';
import { publicMatches } from '@/lib/public-matches';
import { MatchList } from '@/components/match-list';
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const team = (await publicTeams((await params).slug))[0];
  return { title: team?.name || 'Team' };
}
export default async function TeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const language = await getLocale();
  const tr = await getServerT();
  const team = (await publicTeams((await params).slug))[0];
  if (!team) notFound();
  const matches = await publicMatches({ teamId: team.id });
  return (
    <div className="wrap py-8">
      <Link href="/teams" className="mb-5 inline-flex items-center gap-2 text-sm text-primary">
        <ArrowLeft size={18} />
        {tr('Tutti i team')}
      </Link>
      <header className="flex flex-wrap items-center gap-4 border-b pb-6">
        {team.logoImageId ? (
          <img
            src={`/api/media/${team.logoImageId}`}
            alt=""
            className="size-16 rounded object-contain"
          />
        ) : (
          <span className="font-mono text-xl text-muted" aria-hidden="true">
            {team.seed ? '#' + team.seed : team.name.slice(0, 2)}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="break-words text-3xl font-semibold">{team.name}</h1>
          <p className="mt-3 text-muted">
            {team.format === 'INDIVIDUAL' ? tr('Individuale') : tr('Team')}
            {team.seed ? tr(' · Seed #{0}', team.seed) : ''}
            {team.qualifierPlayed === false ? tr(' · Qualifiche non disputate') : ''}
          </p>
        </div>
      </header>
      {team.status === 'REJECTED' && (
        <p className="my-5 whitespace-pre-line rounded-xl border border-red-300/40 p-4 text-sm text-red-300">
          <strong>{tr('Rejected')}</strong>
          {team.rejectionReason ? `: ${team.rejectionReason}` : ''}
        </p>
      )}
      {team.description && <p className="my-8 max-w-3xl whitespace-pre-line">{team.description}</p>}
      <h2 className="mb-4 mt-7 text-xl font-semibold">{tr('Roster')}</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {team.members.map((m) => (
          <a
            href={`https://osu.ppy.sh/users/${m.osuId}`}
            key={m.osuId}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 items-center gap-3 border-b py-4 hover:border-primary/40"
          >
            <img src={m.participant.avatarUrl} alt="" className="size-11 shrink-0 rounded" />
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-lg font-semibold">
                {m.registeredUsername || m.participant.username}
              </h3>
              {m.registeredUsername && m.registeredUsername !== m.participant.username && (
                <p className="text-xs text-muted">
                  {tr('Ora:')} {m.participant.username}
                </p>
              )}
              <p className="text-sm text-primary">
                {m.captain ? tr('Capitano') : m.substitute ? tr('Riserva') : tr('Giocatore')}
              </p>
              <p className="text-sm text-muted">
                {tr('osu! #')}
                {m.osuId}
              </p>
              {m.registrationRank && (
                <p className="text-xs text-muted">
                  {tr('Rank all’iscrizione: #')}
                  {m.registrationRank.toLocaleString(localeTag(language))}
                </p>
              )}
            </div>
            <ArrowUpRight size={18} className="shrink-0 text-muted" />
          </a>
        ))}
      </div>
      {matches.length > 0 && (
        <section className="mt-12 border-t pt-8">
          <h2 className="mb-5 text-2xl font-semibold">{tr('Incontri')}</h2>
          <MatchList matches={matches} />
        </section>
      )}
    </div>
  );
}
