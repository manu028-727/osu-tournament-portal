'use client';
import { localeTag } from '@/lib/i18n';
import { formatMapValue } from '@/lib/score-pipeline';
import { useLocale, useT } from '@/components/locale';

import { useState, useEffect, useRef } from 'react';
import { Check, RefreshCw, X, Link2, Play } from 'lucide-react';
import type { MatchView } from '@/lib/matches-types';
import type { MatchAccess } from '@/lib/match-access';
import { Button } from '../ui/button';
import { api, useTask } from './shared';
type History = {
  games: NonNullable<MatchView['multiplayerGames']>;
  count: number;
  nextCursor: string | null;
};
export function MultiplayerGames({
  match: m,
  access,
  reload,
  post,
}: {
  match: MatchView;
  access: MatchAccess;
  reload: () => Promise<unknown>;
  post: (body: object, message: string) => Promise<unknown>;
}) {
  const language = useLocale();
  const tr = useT();
  const { busy, run } = useTask(),
    [selected, setSelected] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<History | null>(null),
    [historyError, setHistoryError] = useState(''),
    generation = useRef(0);
  const historyUrl = `/api/admin/data?section=multiplayer-history&id=${encodeURIComponent(m.id)}`;
  useEffect(() => {
    const current = ++generation.current;
    setHistory(null);
    setHistoryError('');
    void api<History>(historyUrl)
      .then((value) => {
        if (generation.current === current) setHistory(value);
      })
      .catch((error: Error) => {
        if (generation.current === current) setHistoryError(error.message);
      });
    return () => {
      generation.current++;
    };
  }, [historyUrl, m.version, m.multiplayerSyncedAt, m.multiplayerId]);
  const games = history?.games || m.multiplayerGames || [];
  const pending = m.actions.find((a) => !a.voided && a.id === m.workflow.currentActionId);
  return (
    <section aria-label={tr('Multiplayer game history')} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">{tr('Multiplayer games')}</h2>
          <p className="text-xs text-muted">
            {history?.count ?? games.length} {tr('games ·')}{' '}
            {m.multiplayerSyncedAt
              ? tr(
                  'Synced {0}',
                  new Date(m.multiplayerSyncedAt).toLocaleString(localeTag(language)),
                )
              : tr('Not synchronized')}
            {m.multiplayerSync?.pending ? tr(' · History incomplete') : ''}
          </p>
        </div>
        {access.score && m.multiplayerId && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api('/api/admin/multiplayer', {
                  method: 'POST',
                  body: JSON.stringify({ id: m.id }),
                });
                await reload();
              }, tr('Multiplayer games synchronized for review.'))
            }
          >
            <RefreshCw size={16} />
            {tr('Sync games')}
          </Button>
        )}
      </div>
      {!m.multiplayerId && (
        <p className="text-sm text-muted">{tr('No multiplayer lobby connected.')}</p>
      )}
      {m.multiplayerError && (
        <p role="alert" className="text-sm text-amber-200">
          {m.multiplayerError}
        </p>
      )}
      {historyError && (
        <p role="alert" className="text-sm text-amber-200">
          {historyError}
        </p>
      )}
      <div className="max-h-[60vh] overflow-auto">
        {games.map((game) => {
          const evidence = game.evidence,
            proposal = game.proposal,
            known = m.actions.filter(
              (a) =>
                !a.voided &&
                a.kind === 'PICK' &&
                m.poolRevision?.slots.some(
                  (s) => s.name === a.slotName && s.beatmapId === game.beatmapId,
                ),
            );
          const suggest =
            m.status === 'IN_PROGRESS' &&
            m.workflow.phase === 'PICK' &&
            access.draft &&
            m.workflow.eligibleSlots.includes(game.slotName) &&
            !game.actionId &&
            !!evidence &&
            !!m.startedAt &&
            new Date(evidence.startTime) >= new Date(m.startedAt);
          return (
            <div key={game.id} className="space-y-2 border-b py-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <strong>
                  {tr('Game')} {game.gameId} · {game.slotName || tr('Unmatched')} ·{' '}
                  {evidence?.endTime ? tr('Completed') : tr('Incomplete')}
                </strong>
                <span>
                  {game.confirmedAt
                    ? tr('Confirmed')
                    : game.ignoredAt
                      ? tr('Ignored')
                      : game.actionId
                        ? tr('Linked to official pick')
                        : tr('Unreviewed')}
                </span>
              </div>
              <p className="text-xs text-muted">
                {tr('Beatmap')} {game.beatmapId} · {evidence?.scoringType} ·{' '}
                {evidence?.mods.join(' ') || tr('No mods')} ·{' '}
                {evidence?.startTime
                  ? new Date(evidence.startTime).toLocaleString(localeTag(language))
                  : ''}
              </p>
              {proposal && (
                <p>
                  {tr('Red')} {formatMapValue(proposal.scoreA, localeTag(language))} :{' '}
                  {formatMapValue(proposal.scoreB, localeTag(language))} {tr('Blue · Suggested')}{' '}
                  {proposal.winnerSide === 'A' ? tr('Red') : tr('Blue')} {tr('win')}
                </p>
              )}
              {evidence?.issue && <p className="text-xs text-amber-200">{evidence.issue}</p>}
              {evidence && (
                <details>
                  <summary className="cursor-pointer text-xs text-muted">
                    {tr('Player scores and technical details')}
                  </summary>
                  <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words text-xs">
                    {JSON.stringify(evidence, null, 2)}
                  </pre>
                </details>
              )}
              {!game.confirmedAt && !game.ignoredAt && access.score && (
                <div className="flex flex-wrap items-center gap-2">
                  {suggest && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            tr(
                              "Confirm {0} as {1}'s official pick?",
                              game.slotName,
                              m.participants[m.workflow.side!].name,
                            ),
                          )
                        )
                          void post(
                            {
                              type: 'match.detected_pick',
                              id: m.id,
                              baseVersion: m.version,
                              proposalId: game.id,
                              reason:
                                'Referee explicitly accepted detected map as the expected pick',
                            },
                            'Detected pick confirmed.',
                          );
                      }}
                    >
                      <Play size={14} />
                      {tr('Use as')} {m.workflow.side === 'A' ? tr('Red') : tr('Blue')} {tr('pick')}
                    </Button>
                  )}
                  {proposal &&
                    m.status === 'IN_PROGRESS' &&
                    pending?.slotName === game.slotName && (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              tr(
                                'Confirm game {0} as the result of {1}?',
                                game.gameId,
                                game.slotName,
                              ),
                            )
                          )
                            void post(
                              {
                                type: 'match.import',
                                id: m.id,
                                baseVersion: m.version,
                                proposalId: game.id,
                                reason: 'Referee reviewed multiplayer result',
                              },
                              'Imported result confirmed.',
                            );
                        }}
                      >
                        <Check size={14} />
                        {tr('Confirm result')}
                      </Button>
                    )}
                  {!game.actionId && known.length > 0 && (
                    <>
                      <select
                        aria-label={tr('Official pick for game {0}', game.gameId)}
                        className="max-w-52"
                        value={selected[game.id] || ''}
                        onChange={(e) => setSelected({ ...selected, [game.id]: e.target.value })}
                      >
                        <option value="">{tr('Associate official pick')}</option>
                        {known.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.sequence}. {a.side === 'A' ? tr('Red') : tr('Blue')} - {a.slotName}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="icon"
                        variant="outline"
                        title={tr('Confirm game association')}
                        aria-label={tr('Associate game {0}', game.gameId)}
                        disabled={!selected[game.id] || busy}
                        onClick={() =>
                          void post(
                            {
                              type: 'match.multiplayer.associate',
                              id: m.id,
                              baseVersion: m.version,
                              proposalId: game.id,
                              actionId: selected[game.id],
                              reason: 'Referee reviewed game-to-pick association',
                            },
                            'Game associated without changing scores.',
                          )
                        }
                      >
                        <Link2 size={14} />
                      </Button>
                    </>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    title={tr('Ignore game')}
                    aria-label={tr('Ignore game {0}', game.gameId)}
                    onClick={() =>
                      void post(
                        {
                          type: 'match.multiplayer.ignore',
                          id: m.id,
                          baseVersion: m.version,
                          proposalId: game.id,
                          reason: 'Referee excluded this game from tournament results',
                        },
                        'Game ignored.',
                      )
                    }
                  >
                    <X size={14} />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {history?.nextCursor && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const current = generation.current,
                next = await api<History>(
                  `${historyUrl}&cursor=${encodeURIComponent(history.nextCursor!)}`,
                );
              if (current !== generation.current) return;
              setHistory((old) => ({
                count: next.count,
                nextCursor: next.nextCursor,
                games: [
                  ...new Map([...(old?.games || []), ...next.games].map((g) => [g.id, g])).values(),
                ],
              }));
            }, tr('Older multiplayer games loaded.'))
          }
        >
          <RefreshCw size={14} />
          {tr('Load older games')}
        </Button>
      )}
    </section>
  );
}
