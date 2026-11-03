import { notFound } from 'next/navigation';
import { PageHeading } from '@/components/content';
import { LiveRefresh } from '@/components/live-refresh';
import { db } from '@/lib/db';
import { isPublicTournament } from '@/lib/public-visibility';
import { publicResources } from '@/lib/resource-service';
import { getServerT } from '@/lib/server-locale';
import { publicTeamFormation } from '@/lib/team-formation-service';
import { requestScope } from '@/lib/tournament-context';
import styles from './team-formation.module.css';

export async function generateMetadata() {
  const tr = await getServerT();
  return { title: tr('Team formation') };
}

const seedLabel = (seed: number | null) => (seed === null ? '' : `#${seed}`);

export default async function TeamFormation() {
  const tr = await getServerT();
  const { tournamentId } = await requestScope();
  const tournament = await db.tournament.findUnique({ where: { id: tournamentId } });
  if (!isPublicTournament(tournament)) notFound();
  const [sessions, resources] = await Promise.all([
    publicTeamFormation(db, tournamentId),
    publicResources(db, tournamentId),
  ]);
  if (!sessions.length && !resources) notFound();
  const currency = resources?.currency ?? '$';
  return (
    <div className="wrap pb-20">
      <PageHeading
        eyebrow={tr('Players and captains')}
        title={tr('Team formation')}
        description={tr('Who has joined which team, as it happens.')}
      />
      {sessions.some((session) => session.state === 'OPEN') && <LiveRefresh seconds={5} />}
      {sessions.map((session) => (
        <section key={session.name} className={styles.session} aria-label={session.name}>
          <h2 className={styles.heading}>{session.name}</h2>
          {session.state === 'CONFIRMED' && (
            <p className="text-sm text-muted">{tr('These teams are final.')}</p>
          )}
          {session.current && (
            <p className={styles.current} role="status">
              <span className="text-sm text-muted">{tr('Now offering')}</span>
              <strong>{session.current.username}</strong>
              <span className="text-sm text-muted">{seedLabel(session.current.seed)}</span>
            </p>
          )}
          {session.onTheClock && (
            <p className={styles.current} role="status">
              <span className="text-sm text-muted">{tr('On the clock')}</span>
              <strong>{session.onTheClock}</strong>
            </p>
          )}
          <ul className={styles.teams}>
            {session.teams.map((team) => (
              <li key={team.name} className={styles.team}>
                <h3 className="font-semibold">{team.name}</h3>
                {team.moneyLeft !== null && (
                  <p className="text-sm text-muted">
                    {tr('{0} left', `${currency} ${team.moneyLeft}`)}
                  </p>
                )}
                <ol className={styles.roster}>
                  {team.players.map((player) => (
                    <li key={player.osuId}>
                      <span>
                        {player.username}
                        {player.captain && <span className="text-muted"> ({tr('Captain')})</span>}
                      </span>
                      {player.price !== null && (
                        <span className="text-muted">
                          {currency} {player.price}
                          {player.filled ? ` (${tr('filled')})` : ''}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
          {session.reserves.length > 0 && (
            <div className={styles.list}>
              <h3 className="font-semibold">{tr('Reserves')}</h3>
              <p className="text-sm">{session.reserves.map((lot) => lot.username).join(', ')}</p>
            </div>
          )}
          {session.undecided.length > 0 && (
            <div className={styles.list}>
              <h3 className="font-semibold">{tr('Still to come')}</h3>
              <p className="text-sm">
                {session.undecided
                  .map((lot) => `${lot.username} ${seedLabel(lot.seed)}`.trim())
                  .join(', ')}
              </p>
            </div>
          )}
        </section>
      ))}
      {resources && (
        <section className={styles.session} aria-label={tr('Team balances')}>
          <h2 className={styles.heading}>{tr('Team balances')}</h2>
          <div className="overflow-x-auto">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{tr('Team')}</th>
                  <th>{tr('Balance')}</th>
                  <th>{tr('Items bought')}</th>
                </tr>
              </thead>
              <tbody>
                {resources.teams.map((team) => (
                  <tr key={team.name}>
                    <td>{team.name}</td>
                    <td>
                      {currency} {team.balance}
                    </td>
                    <td>
                      {team.purchases
                        .map((row) => (row.stage ? `${row.item} (${row.stage})` : row.item))
                        .join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {resources.items.length > 0 && (
            <>
              <h3 className="font-semibold">{tr('Items on sale')}</h3>
              <ul className="grid gap-2 text-sm">
                {resources.items.map((item) => (
                  <li key={item.name}>
                    <strong>{item.name}</strong> ({currency} {item.price})
                    {item.unlocksAt && ` · ${tr('Unlocks at {0}', item.unlocksAt)}`}
                    {item.description && <p className="text-muted">{item.description}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
