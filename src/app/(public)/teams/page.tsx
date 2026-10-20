import Link from '@/components/tournament-scope';
import { Users, ArrowUpRight } from 'lucide-react';
import { PageHeading, EmptyState } from '@/components/content';
import { publicTeams } from '@/lib/teams-service';
export const metadata = { title: 'Team e giocatori' };
export default async function Teams() {
  const teams = await publicTeams();
  return (
    <div className="wrap pb-20">
      <PageHeading
        eyebrow="I PARTECIPANTI"
        title="Team e giocatori"
        description="Le squadre approvate e i giocatori del torneo."
      />
      {teams.length ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((team) => (
            <Link
              href={`/teams/${team.slug}`}
              key={team.id}
              className="card group min-w-0 p-6 hover:border-primary/30"
            >
              <div className="mb-5 flex items-start gap-4">
                {team.logoImageId ? (
                  <img
                    className="size-16 rounded-lg object-contain"
                    src={`/api/media/${team.logoImageId}`}
                    alt=""
                  />
                ) : (
                  <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Users size={30} className="text-primary" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="break-words text-2xl font-semibold">{team.name}</h2>
                  {team.seed && <p className="mt-1 text-sm text-accent">Seed #{team.seed}</p>}
                  {team.qualifierPlayed === false && (
                    <p className="mt-1 text-xs text-muted">Qualifiche non disputate</p>
                  )}
                </div>
                <ArrowUpRight size={20} className="shrink-0 text-primary" />
              </div>
              <p className="text-sm text-muted">
                Capitano:{' '}
                {team.members.find((m) => m.captain)?.registeredUsername ||
                  team.members.find((m) => m.captain)?.participant.username}
              </p>
              <p className="mt-1 text-sm text-muted">
                {team.members.length} {team.members.length === 1 ? 'giocatore' : 'giocatori'}
              </p>
              {team.rankSum && (
                <p className="mt-1 text-xs text-muted">
                  Rank sum all’iscrizione: {team.rankSum.toLocaleString('it-IT')}
                </p>
              )}
              <div className="mt-5 flex flex-wrap gap-2 border-t pt-5">
                {team.members.map((m) => (
                  <img
                    key={m.osuId}
                    src={m.participant.avatarUrl}
                    alt={m.participant.username}
                    title={m.participant.username}
                    className="size-10 rounded-md object-cover"
                  />
                ))}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="Nessuna squadra pubblicata" />
      )}
    </div>
  );
}
