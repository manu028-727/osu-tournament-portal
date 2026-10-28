'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Download, X } from 'lucide-react';
import { Feedback, useT } from '@/components/locale';
import type { MatchView } from '@/lib/matches-types';
import type {
  ImportGameDecision,
  MatchResultImpact,
  MultiplayerResultPreview,
} from '@/lib/match-results-contract';
import { firstTo } from '@/lib/match-rules';
import { Button } from '../ui/button';
import Link from '@/components/tournament-scope';
import {
  action,
  api,
  Field,
  LoadingState,
  SaveButton,
  useResource,
  useTask,
  useUnsaved,
} from './shared';

export function OrganizerMatchResult({
  id,
  onClose,
  onSaved,
}: {
  id: string;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const tr = useT();
  const { data, error, reload } = useResource<{ match: MatchView }>(
    `match&id=${encodeURIComponent(id)}`,
  );
  const m = data?.match;
  const [mode, setMode] = useState<'manual' | 'multiplayer'>('manual');
  const [scoreA, setScoreA] = useState(0),
    [scoreB, setScoreB] = useState(0),
    [forfeit, setForfeit] = useState<'A' | 'B' | ''>('');
  const [externalReferee, setExternalReferee] = useState(''),
    [reason, setReason] = useState(''),
    [confirm, setConfirm] = useState(true);
  const [url, setUrl] = useState(''),
    [redSide, setRedSide] = useState<'A' | 'B'>('A');
  const [preview, setPreview] = useState<MultiplayerResultPreview | null>(null),
    [decisions, setDecisions] = useState<ImportGameDecision[]>([]);
  const [impact, setImpact] = useState<MatchResultImpact | null>(null),
    [impactError, setImpactError] = useState(''),
    [approve, setApprove] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { busy, run } = useTask();
  const root = useRef<HTMLElement>(null);
  useUnsaved(dirty);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (opener?.isConnected) opener.focus();
      else document.querySelector<HTMLElement>('main input[type="search"]')?.focus();
    };
  }, []);
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
    root.current?.scrollIntoView({ block: 'start' });
  }, [m?.id]);
  useEffect(() => {
    if (!m) return;
    setScoreA(m.scoreA);
    setScoreB(m.scoreB);
    setForfeit(m.forfeitSide || '');
    setUrl(m.lobbyUrl);
    setExternalReferee(m.source?.referee || '');
    setRedSide(m.source?.organizerResult?.redSide || 'A');
  }, [m]);
  const pointsA =
    mode === 'manual' ? scoreA : decisions.filter((d) => d.included && d.winnerSide === 'A').length;
  const pointsB =
    mode === 'manual' ? scoreB : decisions.filter((d) => d.included && d.winnerSide === 'B').length;
  const target = m ? firstTo(m.rules) : 1;
  const winner =
    pointsA >= target && pointsB < target
      ? 'A'
      : pointsB >= target && pointsA < target
        ? 'B'
        : null;
  const proposedWinner = confirm ? winner : null;
  useEffect(() => {
    if (!m) return;
    let active = true;
    setImpact(null);
    setImpactError('');
    setApprove(false);
    void api<MatchResultImpact>('/api/admin/match-results', {
      method: 'POST',
      body: JSON.stringify({
        type: 'impact',
        id: m.id,
        baseVersion: m.version,
        winnerSide: proposedWinner,
      }),
    })
      .then((value) => {
        if (active) setImpact(value);
      })
      .catch((error: Error) => {
        if (active) setImpactError(error.message);
      });
    return () => {
      active = false;
    };
  }, [m?.id, m?.version, proposedWinner]);
  if (!m)
    return (
      <div className="my-5 rounded-2xl border p-4">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {tr('Close result editor')}
        </Button>
        <LoadingState error={error} retry={() => void reload().catch(() => {})} />
      </div>
    );
  const edit = () => setDirty(true);
  const close = () => {
    if (busy) return;
    if (!dirty || window.confirm(tr('Discard unsaved changes?'))) onClose();
  };
  const changeDecision = (gameId: string, patch: Partial<ImportGameDecision>) => {
    setDecisions((rows) => rows.map((row) => (row.gameId === gameId ? { ...row, ...patch } : row)));
    edit();
  };
  return (
    <section
      ref={root}
      tabIndex={-1}
      className="my-5 min-w-0 rounded-2xl border border-[var(--accent-border)] bg-card p-4 [overflow-wrap:anywhere] md:p-6"
      aria-label={tr('Result editor for match {0}', m.matchNumber)}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">
            {tr('Match {0}', m.matchNumber)} · {tr('Result')}
          </h2>
          <p className="text-sm text-muted [overflow-wrap:anywhere]">
            {m.participants.A.name} · {m.participants.B.name} · {tr('First to {0}', target)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/admin/referee/${m.matchNumber}`}>{tr('Referee')}</Link>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={tr('Close result editor')}
            onClick={close}
          >
            <X size={18} />
          </Button>
        </div>
      </div>
      <p className="mb-4 text-sm text-muted">
        {tr(
          'Organizer results preserve the referee history. Confirmed results update the bracket; protected downstream matches cannot be replaced.',
        )}
      </p>
      <div role="group" aria-label={tr('Result source')} className="mb-5 flex flex-wrap gap-2">
        <Button
          variant={mode === 'manual' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('manual')}
        >
          {tr('Manual result')}
        </Button>
        <Button
          variant={mode === 'multiplayer' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('multiplayer')}
        >
          <Download size={15} />
          {tr('Import mp results')}
        </Button>
      </div>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            if (!impact || impact.blocked)
              throw new Error(tr('Review the bracket impact before saving.'));
            const common = {
              id: m.id,
              baseVersion: m.version,
              reason,
              confirm,
              approveProgression: approve,
              correctionHash: impact.hash || undefined,
            };
            await action(
              mode === 'manual'
                ? {
                    ...common,
                    type: 'match.result.set',
                    scoreA,
                    scoreB,
                    winnerSide: winner,
                    forfeitSide: forfeit || null,
                    externalReferee,
                  }
                : { ...common, type: 'match.result.import', token: preview!.token, decisions },
            );
            setDirty(false);
            await onSaved();
            onClose();
          }, tr('Match result saved.'));
        }}
      >
        <fieldset disabled={busy} className="space-y-4">
          {mode === 'manual' ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label={tr('Score for {0}', m.participants.A.name)}>
                  <input
                    type="number"
                    min={0}
                    max={target}
                    value={scoreA}
                    onChange={(e) => {
                      setScoreA(Number(e.target.value));
                      edit();
                    }}
                  />
                </Field>
                <Field label={tr('Score for {0}', m.participants.B.name)}>
                  <input
                    type="number"
                    min={0}
                    max={target}
                    value={scoreB}
                    onChange={(e) => {
                      setScoreB(Number(e.target.value));
                      edit();
                    }}
                  />
                </Field>
                <Field label={tr('Forfeit (FF)')}>
                  <select
                    value={forfeit}
                    onChange={(e) => {
                      const value = e.target.value as typeof forfeit;
                      setForfeit(value);
                      edit();
                      if (value === 'A') {
                        setScoreB(target);
                        setScoreA(Math.min(scoreA, target - 1));
                      }
                      if (value === 'B') {
                        setScoreA(target);
                        setScoreB(Math.min(scoreB, target - 1));
                      }
                    }}
                  >
                    <option value="">{tr('No forfeit')}</option>
                    <option value="A">{m.participants.A.name}</option>
                    <option value="B">{m.participants.B.name}</option>
                  </select>
                </Field>
              </div>
              <div className="flex flex-wrap gap-2">
                {(['A', 'B'] as const).map((side) => (
                  <Button
                    key={side}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (side === 'A') {
                        setScoreA(target);
                        setScoreB(Math.min(scoreB, target - 1));
                      } else {
                        setScoreB(target);
                        setScoreA(Math.min(scoreA, target - 1));
                      }
                      setForfeit('');
                      edit();
                    }}
                  >
                    {tr('{0} wins', m.participants[side].name)}
                  </Button>
                ))}
              </div>
              <Field label={tr('External referee credit (optional)')}>
                <input
                  maxLength={120}
                  value={externalReferee}
                  onChange={(e) => {
                    setExternalReferee(e.target.value);
                    edit();
                  }}
                />
              </Field>
            </>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
                <Field label={tr('osu! multiplayer link')}>
                  <input
                    type="url"
                    value={url}
                    placeholder="https://osu.ppy.sh/community/matches/123456"
                    onChange={(e) => {
                      setUrl(e.target.value);
                      setPreview(null);
                      setDecisions([]);
                      edit();
                    }}
                  />
                </Field>
                <Field label={tr('osu! red team')}>
                  <select
                    value={redSide}
                    onChange={(e) => {
                      setRedSide(e.target.value as 'A' | 'B');
                      setPreview(null);
                      setDecisions([]);
                      edit();
                    }}
                  >
                    {(['A', 'B'] as const).map((side) => (
                      <option key={side} value={side}>
                        {m.participants[side].name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Button
                  className="self-end"
                  type="button"
                  variant="outline"
                  disabled={busy || !url}
                  onClick={() =>
                    void run(async () => {
                      const value = await api<MultiplayerResultPreview>(
                        '/api/admin/match-results',
                        {
                          method: 'POST',
                          body: JSON.stringify({
                            type: 'multiplayer',
                            id: m.id,
                            baseVersion: m.version,
                            lobbyUrl: url,
                            redSide,
                          }),
                        },
                      );
                      setPreview(value);
                      setDecisions(value.decisions);
                      edit();
                    }, tr('Multiplayer history ready for review.'))
                  }
                >
                  {tr('Fetch games')}
                </Button>
              </div>
              {preview && (
                <>
                  <p className="text-sm font-semibold">
                    {preview.metadata.name || tr('Multiplayer match {0}', preview.metadata.id)} ·{' '}
                    {preview.games.length} {tr('games')}
                  </p>
                  {!preview.complete && (
                    <div className="flex flex-wrap items-center gap-3">
                      <p role="alert" className="text-sm text-amber-200">
                        {tr('Load the earlier history before reviewing or importing this lobby.')}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const next = await api<MultiplayerResultPreview>(
                              '/api/admin/match-results',
                              {
                                method: 'POST',
                                body: JSON.stringify({
                                  type: 'multiplayer',
                                  id: m.id,
                                  baseVersion: m.version,
                                  lobbyUrl: url,
                                  redSide,
                                  reviewToken: preview.token,
                                }),
                              },
                            );
                            setPreview(next);
                            setDecisions(next.decisions);
                          }, tr('Multiplayer history ready for review.'))
                        }
                      >
                        {tr('Load earlier games')}
                      </Button>
                    </div>
                  )}
                  <p className="text-sm text-muted">
                    {tr(
                      'Exclude warmups and replays. API evidence stays unchanged; manual winner corrections require a reason. No pick or ban history is invented.',
                    )}
                  </p>
                  <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
                    {preview.games.map((game) => {
                      const decision = decisions.find(
                        (row) => row.gameId === game.evidence.gameId,
                      )!;
                      return (
                        <div key={decision.gameId} className="rounded-xl border p-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <label className="flex min-h-11 items-center gap-2">
                              <input
                                type="checkbox"
                                aria-label={tr('Include game {0}', decision.gameId)}
                                checked={decision.included}
                                disabled={!game.evidence.endTime || !preview.complete}
                                onChange={(e) =>
                                  changeDecision(decision.gameId, { included: e.target.checked })
                                }
                              />
                              {game.evidence.slotName || tr('Map {0}', game.evidence.beatmapId)}
                            </label>
                            <a
                              className="text-sm text-primary"
                              href={`https://osu.ppy.sh/beatmaps/${game.evidence.beatmapId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {tr('Game {0}', decision.gameId)}
                            </a>
                            <span className="text-sm tabular-nums">
                              {game.proposal
                                ? `${game.proposal.scoreA} : ${game.proposal.scoreB}`
                                : tr('Manual review required')}
                            </span>
                          </div>
                          {game.evidence.issue && (
                            <p className="mb-2 text-xs text-muted">
                              <Feedback message={game.evidence.issue} />
                            </p>
                          )}
                          {decision.included && (
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Field label={tr('Winner of game {0}', decision.gameId)}>
                                <select
                                  value={decision.winnerSide || ''}
                                  disabled={!preview.complete}
                                  onChange={(e) =>
                                    changeDecision(decision.gameId, {
                                      winnerSide: (e.target.value || null) as 'A' | 'B' | null,
                                    })
                                  }
                                >
                                  <option value="">{tr('Choose winner')}</option>
                                  {(['A', 'B'] as const).map((side) => (
                                    <option key={side} value={side}>
                                      {m.participants[side].name}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field label={tr('Game correction reason {0}', decision.gameId)}>
                                <input
                                  value={decision.reason}
                                  disabled={!preview.complete}
                                  maxLength={1000}
                                  required={
                                    !game.proposal ||
                                    game.proposal.winnerSide !== decision.winnerSide
                                  }
                                  onChange={(e) =>
                                    changeDecision(decision.gameId, { reason: e.target.value })
                                  }
                                />
                              </Field>
                            </div>
                          )}
                          <details className="mt-2 text-xs text-muted">
                            <summary className="min-h-11 cursor-pointer py-3">
                              {tr('Player scores and source details')}
                            </summary>
                            <p>
                              {game.evidence.startTime} · {game.evidence.mode} ·{' '}
                              {game.evidence.scoringType}
                            </p>
                            <ul>
                              {game.evidence.scores.map((score, i) => {
                                const player = score as {
                                  user_id: number;
                                  score: number;
                                  accuracy: number;
                                  mods: string[];
                                };
                                return (
                                  <li className="py-1" key={i}>
                                    {Object.values(m.participants)
                                      .flatMap((p) => p.members)
                                      .find((p) => p.osuId === player.user_id)?.username ||
                                      player.user_id}
                                    : {player.score} · {(player.accuracy * 100).toFixed(2)}% ·{' '}
                                    {player.mods.join(', ')}
                                  </li>
                                );
                              })}
                            </ul>
                          </details>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
          <p className="font-mono text-xl tabular-nums">
            {pointsA} : {pointsB} {winner ? `· ${m.participants[winner].name}` : ''}
          </p>
          <Field label={tr('Result reason / source')}>
            <input
              required
              minLength={3}
              maxLength={2000}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                edit();
              }}
            />
          </Field>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => {
                setConfirm(e.target.checked);
                edit();
              }}
            />
            {tr('Confirm result and advance bracket')}
          </label>
          {impactError && (
            <p role="alert" className="text-sm text-red-200">
              {impactError}
            </p>
          )}
          {impact?.blocked && (
            <p role="alert" className="text-sm text-red-200">
              {tr(
                'Downstream matches or frozen standings protect this result. Reconcile them before changing the winner.',
              )}
            </p>
          )}
          {!!impact?.affected.length && (
            <p className="text-sm text-muted">
              {tr(
                'Affected matches: {0}',
                impact.affected.map((row) => row.matchNumber).join(', '),
              )}
            </p>
          )}
          {impact?.requiresApproval && (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={approve}
                onChange={(e) => setApprove(e.target.checked)}
              />
              {tr('Approve corrections to unstarted downstream fixtures')}
            </label>
          )}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <SaveButton
            busy={busy}
            disabled={
              busy ||
              !impact ||
              impact.blocked ||
              (impact.requiresApproval && !approve) ||
              reason.trim().length < 3 ||
              (mode === 'manual' ? !winner : !preview?.complete || (confirm && !winner))
            }
          >
            <Check size={16} />
            {tr('Save result')}
          </SaveButton>
          <Button type="button" variant="outline" onClick={close}>
            {tr('Cancel')}
          </Button>
        </div>
      </form>
    </section>
  );
}
