'use client';
import { useState } from 'react';
import type { QualifierView } from '@/lib/qualifiers-types';
import type { QualifierCapture } from '@/lib/qualifier-multiplayer';
import { qualifierCompletion, qualifierScoreExceptions } from '@/lib/qualifier-progress';
import { useT, Feedback } from '@/components/locale';
import { Button } from '../ui/button';
import { action, Field, useTask, useUnsaved } from './shared';

export function QualifierExceptions({
  lobby,
  manager,
  onChanged,
}: {
  lobby: QualifierView;
  manager: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const tr = useT();
  const [showAll, setShowAll] = useState(false);
  const exceptions = qualifierScoreExceptions(lobby);
  const excluded = showAll ? lobby.scores : exceptions;
  const pending = lobby.games.filter((game) => game.status === 'PENDING');
  const notices = lobby.games.flatMap((game) =>
    ((game.evidence as { proposal?: QualifierCapture }).proposal?.issues || []).map((issue) => ({
      ...issue,
      gameId: game.gameId,
    })),
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [version, setVersion] = useState<number | null>(null);
  const { run, busy } = useTask();
  useUnsaved(selected.length > 0 || !!reason);
  const completion = qualifierCompletion(lobby);
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
      {manager && lobby.scores.length > 0 && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(event) => {
              setShowAll(event.target.checked);
              setSelected([]);
            }}
          />
          {tr('Review all scores')}
        </label>
      )}
      {!excluded.length && !pending.length && completion.complete && (
        <p className="text-sm text-muted">
          {tr('No scoring exceptions. Valid results are processed automatically.')}
        </p>
      )}
      {!completion.complete && (
        <p className="text-sm text-muted">
          {tr('Waiting for {0} entrant/map results.', completion.blockers.length)}
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
                {tr('Game {0}', issue.gameId)} · {issue.osuId || '?'}:{' '}
                <Feedback message={issue.reason} />
              </li>
            ))}
          </ul>
        </details>
      )}
      {!!excluded.length && (
        <div className="overflow-auto">
          <table className="admin-table">
            <thead>
              <tr>
                {manager && (
                  <th>
                    <input
                      type="checkbox"
                      aria-label={tr('Select all excluded scores')}
                      checked={excluded.every((s) => selected.includes(s.id))}
                      onChange={(event) => {
                        setVersion(lobby.version);
                        setSelected(event.target.checked ? excluded.map((s) => s.id) : []);
                      }}
                    />
                  </th>
                )}
                <th>{tr('Player')}</th>
                <th>{tr('Map / run')}</th>
                <th>{tr('Raw')}</th>
                <th>{tr('Excluded reason')}</th>
              </tr>
            </thead>
            <tbody>
              {excluded.map((s) => (
                <tr key={s.id}>
                  {manager && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={tr('Select score {0}', s.osuId)}
                        checked={selected.includes(s.id)}
                        onChange={(event) => {
                          if (!selected.length) setVersion(lobby.version);
                          setSelected(
                            event.target.checked
                              ? [...selected, s.id]
                              : selected.filter((id) => id !== s.id),
                          );
                        }}
                      />
                    </td>
                  )}
                  <td>
                    {lobby.participants.flatMap((t) => t.members).find((p) => p.osuId === s.osuId)
                      ?.username || s.osuId}
                  </td>
                  <td>
                    {s.slotName} / {s.run}
                  </td>
                  <td>{s.raw}</td>
                  <td>
                    <Feedback
                      message={s.eligibilityReason || 'Score excluded by qualifier rules.'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {manager && selected.length > 0 && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await action({
                type: 'qualifier.scores.resolve',
                id: lobby.id,
                baseVersion: version,
                scoreIds: selected,
                eligible:
                  (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') !== 'exclude',
                reason,
              });
              setSelected([]);
              setReason('');
              await onChanged();
            }, 'Qualifier exceptions resolved.');
          }}
        >
          <Field label={tr('Override reason')}>
            <input
              required
              minLength={3}
              maxLength={2000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <Button type="submit" value="include" disabled={busy}>
            {tr('Include {0} selected scores', selected.length)}
          </Button>
          <Button type="submit" value="exclude" variant="outline" disabled={busy}>
            {tr('Exclude selected scores')}
          </Button>
        </form>
      )}
      {pending.map((game) => (
        <p key={game.id} className="border-l-2 border-amber-400 pl-3 text-sm">
          {tr('Game {0}', game.gameId)}:{' '}
          <Feedback
            message={game.reason || 'Review player, map and run attribution in multiplayer review.'}
          />
        </p>
      ))}
      {!completion.complete && (
        <details>
          <summary className="cursor-pointer text-sm">{tr('What prevents completion?')}</summary>
          {!lobby.participants.length && (
            <p className="mt-2 text-sm">
              {tr('Assign entrants before starting this qualifier session.')}
            </p>
          )}
          <ul className="mt-2 space-y-1 text-sm">
            {completion.blockers.map((b) => (
              <li key={`${b.team}:${b.slotName}:${b.run}`}>
                {b.team} · {b.slotName} · {tr('Run {0}', b.run)}: {b.recorded}/{b.required}{' '}
                {tr('eligible scores; check missing scores and FreeMod requirements.')}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
