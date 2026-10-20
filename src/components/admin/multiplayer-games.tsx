'use client';
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
    <section aria-label="Multiplayer game history" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Multiplayer games</h2>
          <p className="text-xs text-muted">
            {history?.count ?? games.length} games ·{' '}
            {m.multiplayerSyncedAt
              ? `Synced ${new Date(m.multiplayerSyncedAt).toLocaleString()}`
              : 'Not synchronized'}
            {m.multiplayerSync?.pending ? ' · History incomplete' : ''}
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
              }, 'Multiplayer games synchronized for review.')
            }
          >
            <RefreshCw size={16} />
            Sync games
          </Button>
        )}
      </div>
      {!m.multiplayerId && <p className="text-sm text-muted">No multiplayer lobby connected.</p>}
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
                  Game {game.gameId} · {game.slotName || 'Unmatched'} ·{' '}
                  {evidence?.endTime ? 'Completed' : 'Incomplete'}
                </strong>
                <span>
                  {game.confirmedAt
                    ? 'Confirmed'
                    : game.ignoredAt
                      ? 'Ignored'
                      : game.actionId
                        ? 'Linked to official pick'
                        : 'Unreviewed'}
                </span>
              </div>
              <p className="text-xs text-muted">
                Beatmap {game.beatmapId} · {evidence?.scoringType} ·{' '}
                {evidence?.mods.join(' ') || 'No mods'} ·{' '}
                {evidence?.startTime ? new Date(evidence.startTime).toLocaleString() : ''}
              </p>
              {proposal && (
                <p>
                  Red {proposal.scoreA.toLocaleString()} : {proposal.scoreB.toLocaleString()} Blue ·
                  Suggested {proposal.winnerSide === 'A' ? 'Red' : 'Blue'} win
                </p>
              )}
              {evidence?.issue && <p className="text-xs text-amber-200">{evidence.issue}</p>}
              {evidence && (
                <details>
                  <summary className="cursor-pointer text-xs text-muted">
                    Player scores and technical details
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
                            `Confirm ${game.slotName} as ${m.participants[m.workflow.side!].name}'s official pick?`,
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
                      Use as {m.workflow.side === 'A' ? 'Red' : 'Blue'} pick
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
                              `Confirm game ${game.gameId} as the result of ${game.slotName}?`,
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
                        Confirm result
                      </Button>
                    )}
                  {!game.actionId && known.length > 0 && (
                    <>
                      <select
                        aria-label={`Official pick for game ${game.gameId}`}
                        className="max-w-52"
                        value={selected[game.id] || ''}
                        onChange={(e) => setSelected({ ...selected, [game.id]: e.target.value })}
                      >
                        <option value="">Associate official pick</option>
                        {known.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.sequence}. {a.side === 'A' ? 'Red' : 'Blue'} - {a.slotName}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="icon"
                        variant="outline"
                        title="Confirm game association"
                        aria-label={`Associate game ${game.gameId}`}
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
                    title="Ignore game"
                    aria-label={`Ignore game ${game.gameId}`}
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
            }, 'Older multiplayer games loaded.')
          }
        >
          <RefreshCw size={14} />
          Load older games
        </Button>
      )}
    </section>
  );
}
