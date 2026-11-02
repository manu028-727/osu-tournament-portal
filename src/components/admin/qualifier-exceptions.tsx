'use client';
import type { QualifierView } from '@/lib/qualifiers-types';
import type { QualifierCapture } from '@/lib/qualifier-multiplayer';
import { qualifierCompletion, qualifierScoreExceptions } from '@/lib/qualifier-progress';
import { useT, Feedback } from '@/components/locale';

// Assigned referees see operational exceptions; organizer corrections use the
// shared score manager and its complete-cohort impact preview.
export function QualifierExceptions({ lobby }: { lobby: QualifierView }) {
  const tr = useT();
  const exceptions = qualifierScoreExceptions(lobby);
  const completion = qualifierCompletion(lobby);
  const pending = lobby.games.filter((game) => game.status === 'PENDING');
  const notices = lobby.games.flatMap((game) =>
    ((game.evidence as { proposal?: QualifierCapture }).proposal?.issues || []).map((issue) => ({
      ...issue,
      gameId: game.gameId,
    })),
  );
  return (
    <section
      id="qualifier-exceptions"
      className="space-y-3"
      aria-label={tr('Qualifier exceptions')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{tr('Needs attention')}</h2>
        <span className="text-sm text-muted">
          {tr('{0} excluded scores · {1} pending games', exceptions.length, pending.length)}
        </span>
      </div>
      {!exceptions.length && !pending.length && completion.complete && (
        <p className="text-sm text-muted">
          {tr('No scoring exceptions. Valid results are processed automatically.')}
        </p>
      )}
      {!!notices.length && (
        <details>
          <summary className="cursor-pointer text-sm">
            {tr('Other player evidence ({0})', notices.length)}
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {notices.map((issue, i) => (
              <li key={i}>
                {tr('Game {0}', issue.gameId)} / {issue.osuId || '?'}:{' '}
                <Feedback message={issue.reason} />
              </li>
            ))}
          </ul>
        </details>
      )}
      {!!exceptions.length && (
        <div className="overflow-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{tr('Player')}</th>
                <th>{tr('Map / run')}</th>
                <th>{tr('Raw')}</th>
                <th>{tr('Excluded reason')}</th>
              </tr>
            </thead>
            <tbody>
              {exceptions.map((score) => (
                <tr key={score.id}>
                  <td>
                    {lobby.participants
                      .flatMap((t) => t.members)
                      .find((p) => p.osuId === score.osuId)?.username || score.osuId}
                  </td>
                  <td>
                    {score.slotName} / {score.run}
                  </td>
                  <td>{score.raw}</td>
                  <td>
                    <Feedback
                      message={score.eligibilityReason || 'Score excluded by qualifier rules.'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pending.map((game) => (
        <p key={game.id} className="border-l-2 border-warning pl-3 text-sm">
          {tr('Game {0}', game.gameId)}:{' '}
          <Feedback
            message={game.reason || 'Review player, map and run attribution in multiplayer review.'}
          />
        </p>
      ))}
      {!completion.complete && (
        <details>
          <summary className="cursor-pointer text-sm">
            {tr('Waiting for {0} entrant/map results.', completion.blockers.length)}
          </summary>
          {!lobby.participants.length && (
            <p className="mt-2 text-sm">
              {tr('Assign entrants before starting this qualifier session.')}
            </p>
          )}
          <ul className="mt-2 space-y-1 text-sm">
            {completion.blockers.map((b) => (
              <li key={`${b.team}:${b.slotName}:${b.run}`}>
                {b.team} / {b.slotName} / {tr('Run {0}', b.run)}: {b.recorded}/{b.required}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
