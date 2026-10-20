import Link from '@/components/tournament-scope';
import { ArrowUpRight } from 'lucide-react';
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
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((team) => (
            <Link
              href={`/teams/${team.slug}`}
              key={team.id}
              className="card group min-w-0 p-4 hover:border-primary/40"
            >
              <div className="mb-3 flex items-start gap-3">
                {team.logoImageId ? (
                  <img
                    className="size-11 shrink-0 rounded object-contain"
                    src={`/api/media/${team.logoImageId}`}
                    alt=""
                  />
                ) : (
                  <div
                    className="flex size-11 shrink-0 items-center justify-center rounded border font-mono text-sm text-muted"
                    aria-hidden="true"
                  >
                    {team.seed ? String(team.seed).padStart(2, '0') : team.name.slice(0, 2)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="break-words text-lg font-semibold leading-snug">{team.name}</h2>
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
              <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                {team.members.map((m) => (
                  <img
                    key={m.osuId}
                    src={m.participant.avatarUrl}
                    alt={m.participant.username}
                    title={m.participant.username}
                    className="size-8 rounded object-cover"
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
