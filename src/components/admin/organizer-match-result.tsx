'use client';
import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useLocale, useT } from '@/components/locale';
import { localeTag } from '@/lib/i18n';
import { formatMapValue } from '@/lib/score-pipeline';
import type { MatchView } from '@/lib/matches-types';
import type {
  ImportGameDecision,
  MatchResultImpact,
  MultiplayerResultPreview,
} from '@/lib/match-results-contract';
import { firstTo } from '@/lib/match-rules';
import { Button } from '../ui/button';
import Link from '@/components/tournament-scope';
import { MatchInlineResult } from './match-inline-result';
import {
  action,
  api,
  Field,
  LoadingState,
  SaveButton,
  useResource,
  useTask,
  useUnsaved,
  NumberInput,
} from './shared';

export function OrganizerMatchResult({
  id,
  onClose,
  onSaved,
  initialMode = 'manual',
  onStateChange,
  embedded = false,
}: {
  id: string;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
  initialMode?: 'manual' | 'multiplayer';
  onStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
  embedded?: boolean;
}) {
  const tr = useT();
  const language = useLocale();
  const { data, error, reload } = useResource<{ match: MatchView }>(
    `match&id=${encodeURIComponent(id)}`,
  );
  const m = data?.match;
  const [mode, setMode] = useState(initialMode),
    [url, setUrl] = useState('');
  const [warmups, setWarmups] = useState(0),
    [playerSides, setSides] = useState<Record<string, 'A' | 'B'>>({});
  const [preview, setPreview] = useState<MultiplayerResultPreview | null>(null),
    [decisions, setDecisions] = useState<ImportGameDecision[]>([]);
  const [impact, setImpact] = useState<MatchResultImpact | null>(null),
    [approve, setApprove] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [childState, setChildState] = useState({ dirty: false, busy: false });
  const { busy, run } = useTask();
  const root = useRef<HTMLElement>(null);
  useUnsaved(dirty || childState.dirty);
  useEffect(() => {
    onStateChange?.({ dirty: dirty || childState.dirty, busy: busy || childState.busy });
    return () => onStateChange?.({ dirty: false, busy: false });
  }, [dirty, childState.dirty, childState.busy, busy, onStateChange]);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
    root.current?.scrollIntoView({ block: 'start' });
  }, [m?.id]);
  useEffect(() => {
    if (!m) return;
    setUrl(m.lobbyUrl || '');
    setWarmups(m.source?.organizerResult?.warmups || 0);
    setSides(m.source?.organizerResult?.playerSides || {});
  }, [m]);
  const close = () => {
    if (
      !busy &&
      !childState.busy &&
      (!(dirty || childState.dirty) || window.confirm(tr('Discard unsaved changes?')))
    )
      onClose();
  };
  const points = (rows: ImportGameDecision[]) => ({
    A: rows.filter((row) => row.included && row.winnerSide === 'A').length,
    B: rows.filter((row) => row.included && row.winnerSide === 'B').length,
  });
  const totals = points(decisions);
  const save = async (
    source: MultiplayerResultPreview,
    rows: ImportGameDecision[],
    approved = false,
  ) => {
    const score = points(rows),
      target = firstTo(m!.rules);
    const winner = score.A >= target ? 'A' : score.B >= target ? 'B' : null;
    const nextImpact = await api<MatchResultImpact>('/api/admin/match-results', {
      method: 'POST',
      body: JSON.stringify({
        type: 'impact',
        id: m!.id,
        baseVersion: m!.version,
        winnerSide: winner,
      }),
    });
    setImpact(nextImpact);
    const possibleNoop =
      m!.status === 'COMPLETED' &&
      m!.winnerSide === winner &&
      m!.scoreA === score.A &&
      m!.scoreB === score.B;
    if (nextImpact.blocked && !possibleNoop)
      throw Error(
        tr(
          'Downstream matches or frozen standings protect this result. Reconcile them before changing the winner.',
        ),
      );
    if (nextImpact.requiresApproval && !approved && !possibleNoop) return;
    await action({
      type: 'match.result.import',
      id: m!.id,
      baseVersion: m!.version,
      token: source.token,
      decisions: rows,
      confirm: !!winner,
      reason: `Imported osu! multiplayer match ${source.metadata.id}; ${source.warmups || 0} warmups`,
      approveProgression: approved,
      correctionHash: nextImpact.hash || undefined,
    });
    setDirty(false);
    await onSaved();
    onClose();
  };
  const fetchSource = async (continuation = false) => {
    const next = await api<MultiplayerResultPreview>('/api/admin/match-results', {
      method: 'POST',
      body: JSON.stringify({
        type: 'multiplayer',
        id: m!.id,
        baseVersion: m!.version,
        lobbyUrl: url,
        warmups,
        playerSides,
        ...(continuation && preview ? { reviewToken: preview.token } : {}),
      }),
    });
    setPreview(next);
    setDecisions(next.decisions);
    setImpact(null);
    setApprove(false);
    setDirty(true);
    const needsReview = next.games
      .slice(warmups)
      .some((game) => !!game.evidence.endTime && !game.proposal);
    if (next.complete && !needsReview && next.decisions.some((row) => row.included))
      await save(next, next.decisions);
  };
  const update = (gameId: string, patch: Partial<ImportGameDecision>) => {
    setDecisions((rows) => rows.map((row) => (row.gameId === gameId ? { ...row, ...patch } : row)));
    setImpact(null);
    setApprove(false);
    setDirty(true);
  };
  if (!m)
    return (
      <div className="my-4 rounded-xl border p-3">
        <LoadingState error={error} retry={() => void reload().catch(() => {})} />
        <Button onClick={onClose}>{tr('Close result editor')}</Button>
      </div>
    );
  return (
    <section
      ref={root}
      tabIndex={-1}
      aria-label={tr('Result editor for match {0}', m.matchNumber)}
      className={
        embedded
          ? '@container min-w-0 space-y-4 [overflow-wrap:anywhere]'
          : '@container my-4 min-w-0 space-y-4 rounded-2xl border border-[var(--accent-border)] bg-card p-4 [overflow-wrap:anywhere]'
      }
    >
      {!embedded && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">
              {tr('Match {0}', m.matchNumber)} · {tr('Result')}
            </h2>
            <p className="text-sm text-muted [overflow-wrap:anywhere]">
              {m.participants.A.name} · {m.participants.B.name}
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
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={mode === 'manual' ? 'default' : 'outline'}
          disabled={busy || childState.busy}
          onClick={() => setMode('manual')}
        >
          {tr('Manual result')}
        </Button>
        <Button
          size="sm"
          variant={mode === 'multiplayer' ? 'default' : 'outline'}
          disabled={busy || childState.busy || childState.dirty}
          onClick={() => setMode('multiplayer')}
        >
          <Download size={15} />
          {tr('Import mp results')}
        </Button>
        {embedded && (
          <Button
            size="icon"
            variant="ghost"
            aria-label={tr('Close result editor')}
            onClick={close}
          >
            <X size={18} />
          </Button>
        )}
      </div>
      {mode === 'manual' ? (
        <MatchInlineResult
          id={id}
          onClose={onClose}
          onCancel={close}
          onSaved={onSaved}
          onStateChange={setChildState}
          embedded={embedded}
        />
      ) : (
        <>
          <form
            className="grid grid-cols-1 items-end gap-3 @min-[600px]:grid-cols-[minmax(0,1fr)_8rem_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => fetchSource(), tr('Multiplayer history loaded.'));
            }}
          >
            <Field label={tr('osu! multiplayer link')}>
              <input
                type="url"
                required
                disabled={busy}
                value={url}
                placeholder="https://osu.ppy.sh/community/matches/123456"
                onChange={(e) => {
                  setUrl(e.target.value);
                  setPreview(null);
                  setDirty(true);
                }}
              />
            </Field>
            <Field label={tr('Warmup maps')}>
              <NumberInput
                min={0}
                max={120}
                disabled={busy}
                value={warmups}
                onChange={(count) => {
                  setWarmups(count ?? 0);
                  setPreview(null);
                  setDirty(true);
                }}
              />
            </Field>
            <SaveButton busy={busy}>
              <Download size={15} />
              {tr('Import results')}
            </SaveButton>
          </form>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || url === m.lobbyUrl || ['COMPLETED', 'CANCELLED'].includes(m.status)}
            onClick={() =>
              void run(async () => {
                await action({
                  type: 'match.lobby',
                  id: m.id,
                  baseVersion: m.version,
                  lobbyUrl: url,
                });
                setDirty(false);
                await onSaved();
                onClose();
              }, tr('Multiplayer link saved.'))
            }
          >
            {tr('Save multiplayer link')}
          </Button>
          <p className="text-xs text-muted">
            {tr(
              'Teams are matched by osu! ID. Warmups default to zero. Unambiguous games import immediately; mappings and results can be corrected afterwards.',
            )}
          </p>
          {preview && (
            <div className="space-y-4">
              <p className="font-semibold">
                {preview.metadata.name || tr('Multiplayer games')} · {totals.A} : {totals.B}
              </p>
              {!preview.complete && (
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() =>
                    void run(() => fetchSource(true), tr('Multiplayer history loaded.'))
                  }
                >
                  {tr('Load earlier games')}
                </Button>
              )}
              {!!preview.players?.length && (
                <details open={preview.players.some((player) => player.ambiguous)}>
                  <summary className="min-h-11 cursor-pointer py-3 text-sm">
                    {tr('Player team mapping')}
                  </summary>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {preview.players.map((player) => (
                      <Field key={player.osuId} label={`${player.username} · ${player.osuId}`}>
                        <select
                          disabled={busy}
                          value={playerSides[String(player.osuId)] || player.side || ''}
                          onChange={(e) => {
                            const side = e.target.value as 'A' | 'B';
                            setSides((prev) => {
                              const next = { ...prev };
                              if (side) next[String(player.osuId)] = side;
                              else delete next[String(player.osuId)];
                              return next;
                            });
                            setDirty(true);
                          }}
                        >
                          <option value="">{tr('Choose team')}</option>
                          <option value="A">{m.participants.A.name}</option>
                          <option value="B">{m.participants.B.name}</option>
                        </select>
                      </Field>
                    ))}
                  </div>
                  <Button
                    className="mt-3"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(() => fetchSource(true), tr('Multiplayer history loaded.'))
                    }
                  >
                    {tr('Import with team mapping')}
                  </Button>
                </details>
              )}
              <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
                {preview.games.map((game, index) => {
                  const decision = decisions.find((row) => row.gameId === game.evidence.gameId)!;
                  return (
                    <div key={game.evidence.gameId} className="min-w-0 rounded-xl border p-3">
                      <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                        <input
                          type="checkbox"
                          disabled={busy || !preview.complete}
                          checked={decision.included}
                          aria-label={tr('Include game {0}', game.evidence.gameId)}
                          onChange={(e) => update(decision.gameId, { included: e.target.checked })}
                        />
                        {tr('Game {0}', index + 1)} ·{' '}
                        {game.evidence.slotName || tr('Map {0}', game.evidence.beatmapId)}
                        {index < warmups ? ` · ${tr('Warmup')}` : ''}
                      </label>
                      <p className="text-xs text-muted">
                        {game.proposal
                          ? `${formatMapValue(game.proposal.scoreA, localeTag(language))} : ${formatMapValue(game.proposal.scoreB, localeTag(language))}`
                          : tr(game.evidence.issue || '')}
                      </p>
                      {decision.included && (
                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <Field label={tr('Winner of game {0}', decision.gameId)}>
                            <select
                              disabled={busy}
                              value={decision.winnerSide || ''}
                              onChange={(e) =>
                                update(decision.gameId, {
                                  winnerSide: (e.target.value || null) as 'A' | 'B' | null,
                                })
                              }
                            >
                              <option value="">{tr('Choose winner')}</option>
                              <option value="A">{m.participants.A.name}</option>
                              <option value="B">{m.participants.B.name}</option>
                            </select>
                          </Field>
                          <Field label={tr('Game correction reason {0}', decision.gameId)}>
                            <input
                              maxLength={1000}
                              disabled={busy}
                              value={decision.reason}
                              onChange={(e) => update(decision.gameId, { reason: e.target.value })}
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
                              <li key={i} className="py-1">
                                {preview.players?.find((p) => p.osuId === player.user_id)
                                  ?.username || player.user_id}
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
              {impact?.requiresApproval && (
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={approve}
                    onChange={(e) => setApprove(e.target.checked)}
                  />
                  {tr('Approve corrections to unstarted downstream fixtures')}{' '}
                  {impact.affected.map((row) => row.matchNumber).join(', ')}
                </label>
              )}
              <Button
                disabled={
                  busy ||
                  !preview.complete ||
                  !decisions.some((row) => row.included) ||
                  (!!impact?.requiresApproval && !approve)
                }
                onClick={() =>
                  void run(() => save(preview, decisions, approve), tr('Match result saved.'))
                }
              >
                {tr('Apply reviewed results')}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
