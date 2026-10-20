import Link from '@/components/tournament-scope';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, Users } from 'lucide-react';
import { publicTeams } from '@/lib/teams-service';
import { publicMatches } from '@/lib/public-matches';
import { MatchList } from '@/components/match-list';
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const team = (await publicTeams((await params).slug))[0];
  return { title: team?.name || 'Team' };
}
export default async function TeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const team = (await publicTeams((await params).slug))[0];
  if (!team) notFound();
  const matches = await publicMatches({ teamId: team.id });
  return (
    <div className="wrap py-12 md:py-16">
      <Link href="/teams" className="mb-8 inline-flex items-center gap-2 text-sm text-primary">
        <ArrowLeft size={18} />
        Tutti i team
      </Link>
      <header className="flex flex-wrap items-center gap-6 border-b pb-8">
        {team.logoImageId ? (
          <img
            src={`/api/media/${team.logoImageId}`}
            alt=""
            className="size-24 rounded-lg object-contain"
          />
        ) : (
          <Users size={54} className="text-primary" />
        )}
        <div className="min-w-0">
          <h1 className="break-words text-4xl font-semibold md:text-5xl">{team.name}</h1>
          <p className="mt-3 text-muted">
            {team.format === 'INDIVIDUAL' ? 'Individuale' : 'Team'}
            {team.seed ? ` · Seed #${team.seed}` : ''}
            {team.qualifierPlayed === false ? ' · Qualifiche non disputate' : ''}
          </p>
        </div>
      </header>
      {team.description && <p className="my-8 max-w-3xl whitespace-pre-line">{team.description}</p>}
      <h2 className="mb-6 mt-10 text-2xl font-semibold">Roster</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {team.members.map((m) => (
          <a
            href={`https://osu.ppy.sh/users/${m.osuId}`}
            key={m.osuId}
            target="_blank"
            rel="noopener noreferrer"
            className="card flex min-w-0 items-center gap-4 p-5 hover:border-primary/30"
          >
            <img src={m.participant.avatarUrl} alt="" className="size-16 rounded-lg" />
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-lg font-semibold">
                {m.registeredUsername || m.participant.username}
              </h3>
              {m.registeredUsername && m.registeredUsername !== m.participant.username && (
                <p className="text-xs text-muted">Ora: {m.participant.username}</p>
              )}
              <p className="text-sm text-primary">
                {m.captain ? 'Capitano' : m.substitute ? 'Riserva' : 'Giocatore'}
              </p>
              <p className="text-sm text-muted">osu! #{m.osuId}</p>
              {m.registrationRank && (
                <p className="text-xs text-muted">
                  Rank all’iscrizione: #{m.registrationRank.toLocaleString('it-IT')}
                </p>
              )}
            </div>
            <ArrowUpRight size={18} className="shrink-0 text-muted" />
          </a>
        ))}
      </div>
      {matches.length > 0 && (
        <section className="mt-12 border-t pt-8">
          <h2 className="mb-5 text-2xl font-semibold">Incontri</h2>
          <MatchList matches={matches} />
        </section>
      )}
    </div>
  );
}
