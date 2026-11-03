'use client';
import { localeTag } from '@/lib/i18n';
import { useLocale, useT } from '@/components/locale';

import { useEffect, useState } from 'react';
import { DropdownMenu, ToggleGroup } from 'radix-ui';
import { Check, ChevronDown, Save } from 'lucide-react';
import { MODS, type Side } from '@/lib/match-rules';
import {
  aggregateScores,
  effectiveWinCondition,
  formatMapValue,
  type PlayerScore,
} from '@/lib/score-pipeline';
import type { MatchView } from '@/lib/matches-types';
import { Button } from '../ui/button';
import { action, Field, Modal, SaveButton, useTask, useUnsaved } from './shared';
export type ScoreSelection = { actionId: string; baseVersion: number };
function ModsPicker({
  value,
  onChange,
  label,
}: {
  value: string[];
  onChange: (mods: string[]) => void;
  label: string;
}) {
  const tr = useT();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button type="button" variant="outline" aria-label={label}>
          {value.join(' ') || tr('No Mod')}
          <ChevronDown size={15} />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-[80] min-w-40 rounded-lg border bg-card p-2 shadow-xl"
          sideOffset={5}
        >
          {MODS.map((mod) => (
            <DropdownMenu.CheckboxItem
              key={mod}
              checked={value.includes(mod)}
              onCheckedChange={(checked) =>
                onChange(checked === true ? [...value, mod] : value.filter((v) => v !== mod))
              }
              onSelect={(e) => e.preventDefault()}
              className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 outline-none focus:bg-[var(--surface-hover)]"
            >
              <span className="size-4">
                <DropdownMenu.ItemIndicator>
                  <Check size={16} />
                </DropdownMenu.ItemIndicator>
              </span>
              {mod}
            </DropdownMenu.CheckboxItem>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
export function MatchScoreDialog({
  match,
  selection,
  onClose,
  onSaved,
}: {
  match: MatchView;
  selection: ScoreSelection | null;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const language = useLocale();
  const tr = useT();
  const { busy, run } = useTask();
  const [mode, setMode] = useState('aggregate'),
    [winnerSide, setWinnerSide] = useState<Side>('A'),
    [scoreA, setScoreA] = useState(0),
    [scoreB, setScoreB] = useState(0),
    [players, setPlayers] = useState<PlayerScore[]>([]),
    [notes, setNotes] = useState(''),
    [reason, setReason] = useState(''),
    [dirty, setDirty] = useState(false);
  const picked = match.actions.find((a) => a.id === selection?.actionId),
    previous = match.results.find((r) => r.actionId === picked?.id && !r.voided);
  useEffect(() => {
    if (!selection) return;
    const result = match.results.find((r) => r.actionId === selection.actionId && !r.voided);
    setScoreA(result?.scoreA || 0);
    setScoreB(result?.scoreB || 0);
    setNotes(result?.notes || '');
    setReason(result ? '' : 'Manual score entry');
    setWinnerSide(result?.winnerSide || 'A');
    const rows: PlayerScore[] = [];
    for (const side of ['A', 'B'] as const)
      for (const [index, member] of match.participants[side].members
        .filter((m) => !m.substitute)
        .slice(0, match.rules.teamSize)
        .entries()) {
        const category = match.actions.find((a) => a.id === selection.actionId)?.category || 'NM';
        const mods = match.rules.freeModCategories.includes(category)
          ? index === 0
            ? ['HD']
            : ['HR']
          : (match.rules.categoryMods[category] || '')
              .split(' ')
              .filter((m) => MODS.includes(m as never));
        rows.push({
          osuId: member.osuId,
          side,
          score: 0,
          accuracy: null,
          mods: [...new Set([...(match.rules.enforceNoFail ? ['NF'] : []), ...mods])],
        });
      }
    setPlayers(result?.playerScores.length ? result.playerScores : rows);
    setMode(
      result?.entryMode === 'WINNER_ONLY'
        ? 'winner'
        : result?.playerScores.length
          ? 'individual'
          : 'aggregate',
    );
    setDirty(false);
    // A selection captures its version. Polling must never replace an open score form.
  }, [selection?.actionId, selection?.baseVersion]);
  useUnsaved(dirty);
  const { metric, legacy: legacyMetric } = effectiveWinCondition(match.rules);
  const teamLabel =
    metric === 'ACCURACY'
      ? '{0} accuracy (%)'
      : metric === 'COMBO'
        ? '{0} combo'
        : metric === 'MISSES'
          ? '{0} misses'
          : '{0} score';
  let totals: { scoreA: number; scoreB: number; winnerSide: Side } | null = null,
    issue = '';
  if (selection && mode !== 'winner')
    try {
      totals = aggregateScores(
        match.rules,
        picked?.category || '',
        mode === 'individual' ? players : [],
        {
          A: match.participants.A.members.map((p) => p.osuId),
          B: match.participants.B.members.map((p) => p.osuId),
        },
        scoreA,
        scoreB,
        picked?.slotName,
      );
    } catch (error) {
      issue = (error as Error).message;
    }
  const stale = !!selection && selection.baseVersion !== match.version;
  const close = () => {
    if (!dirty || window.confirm(tr('Discard unsaved score changes?'))) {
      setDirty(false);
      onClose();
    }
  };
  const player = (index: number, fields: Partial<PlayerScore>) => {
    setPlayers((rows) => rows.map((p, i) => (i === index ? { ...p, ...fields } : p)));
    setDirty(true);
  };
  return (
    <Modal
      open={!!selection}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={
        previous
          ? tr('Correct scores · {0}', picked?.slotName || '')
          : tr('Enter scores · {0}', picked?.slotName || '')
      }
      wide
    >
      {selection && (
        <form
          className="space-y-6"
          onChange={() => setDirty(true)}
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await action(
                mode === 'winner'
                  ? {
                      type: 'match.winner',
                      id: match.id,
                      baseVersion: selection.baseVersion,
                      actionId: selection.actionId,
                      winnerSide,
                      notes,
                      reason,
                    }
                  : {
                      type: 'match.score',
                      representation:
                        match.rules.gameplayScoring === 'LAZER' ? 'STANDARDIZED' : 'LEGACY',
                      id: match.id,
                      baseVersion: selection.baseVersion,
                      actionId: selection.actionId,
                      scoreA,
                      scoreB,
                      players: mode === 'individual' ? players : [],
                      notes,
                      reason,
                    },
              );
              setDirty(false);
              onClose();
              await onSaved();
            }, tr('Map result saved.'));
          }}
        >
          {stale && (
            <p role="alert" className="text-red-200">
              {tr(
                'Another referee changed this match. Close and reopen this score entry to review the latest version.',
              )}
            </p>
          )}
          {match.rules.gameplayScoring === 'LAZER' && mode !== 'winner' && (
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" required />
              {tr(
                'Scores are actual standardized lazer values, not classic-scaled display values.',
              )}
            </label>
          )}
          <ToggleGroup.Root
            type="single"
            value={mode}
            onValueChange={(value) => {
              if (value) {
                setMode(value);
                setDirty(true);
              }
            }}
            aria-label={tr('Score entry mode')}
            className="flex w-fit max-w-full flex-wrap rounded-lg border p-1"
          >
            <ToggleGroup.Item
              value="winner"
              className="rounded-md px-4 py-2 text-sm data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
            >
              {tr('Winner only')}
            </ToggleGroup.Item>
            <ToggleGroup.Item
              value="aggregate"
              className="rounded-md px-4 py-2 text-sm data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
            >
              {tr('Team totals')}
            </ToggleGroup.Item>
            <ToggleGroup.Item
              value="individual"
              className="rounded-md px-4 py-2 text-sm data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
            >
              {tr('Individual scores')}
            </ToggleGroup.Item>
          </ToggleGroup.Root>
          {mode === 'winner' ? (
            <Field label={tr('Map winner')}>
              <select value={winnerSide} onChange={(e) => setWinnerSide(e.target.value as Side)}>
                <option value="A">
                  {match.participants.A.name} {tr('· Red')}
                </option>
                <option value="B">
                  {match.participants.B.name} {tr('· Blue')}
                </option>
              </select>
            </Field>
          ) : mode === 'aggregate' ? (
            <div className="grid-fields">
              <Field label={tr(teamLabel, match.participants.A.name)}>
                <input
                  type="number"
                  min={0}
                  max={metric === 'ACCURACY' ? 100 : 1e12}
                  required
                  value={scoreA}
                  step={metric === 'ACCURACY' ? 'any' : 1}
                  onChange={(e) => setScoreA(Number(e.target.value))}
                />
              </Field>
              <Field label={tr(teamLabel, match.participants.B.name)}>
                <input
                  type="number"
                  min={0}
                  max={metric === 'ACCURACY' ? 100 : 1e12}
                  required
                  value={scoreB}
                  step={metric === 'ACCURACY' ? 'any' : 1}
                  onChange={(e) => setScoreB(Number(e.target.value))}
                />
              </Field>
            </div>
          ) : (
            <div className="space-y-6">
              {(['A', 'B'] as const).map((side) => (
                <section key={side} className="border-t pt-5">
                  <h3
                    className={`mb-4 text-xl font-semibold ${side === 'A' ? 'text-red-200' : 'text-sky-200'}`}
                  >
                    {match.participants[side].name}
                  </h3>
                  <div className="space-y-4">
                    {players.map((p, index) =>
                      p.side !== side ? null : (
                        <div
                          key={`${side}-${index}`}
                          className="grid gap-3 border-b pb-5 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_auto]"
                        >
                          <Field label={tr('Team {0} player {1}', side, index + 1)}>
                            <select
                              value={p.osuId}
                              onChange={(e) => player(index, { osuId: Number(e.target.value) })}
                            >
                              {match.participants[side].members.map((m) => (
                                <option key={m.osuId} value={m.osuId}>
                                  {m.username}
                                  {m.substitute ? tr(' · Substitute') : ''}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label={tr('Raw score {0}', index + 1)}>
                            <input
                              type="number"
                              step={legacyMetric ? 'any' : 1}
                              min={0}
                              max={1e12}
                              required
                              value={p.score}
                              onChange={(e) => player(index, { score: Number(e.target.value) })}
                            />
                          </Field>
                          <Field label={tr('Accuracy {0} (%)', index + 1)}>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step="any"
                              required={metric === 'ACCURACY'}
                              value={p.accuracy ?? ''}
                              onChange={(e) =>
                                player(index, {
                                  accuracy: e.target.value ? Number(e.target.value) : null,
                                })
                              }
                            />
                          </Field>
                          {metric === 'COMBO' && !legacyMetric && (
                            <Field label={tr('Max combo {0}', index + 1)}>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                required
                                value={p.maxCombo ?? ''}
                                onChange={(e) =>
                                  player(index, {
                                    maxCombo: e.target.value ? Number(e.target.value) : null,
                                  })
                                }
                              />
                            </Field>
                          )}
                          {metric === 'MISSES' && (
                            <Field label={tr('Misses {0}', index + 1)}>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                required
                                value={p.misses ?? ''}
                                onChange={(e) =>
                                  player(index, {
                                    misses: e.target.value ? Number(e.target.value) : null,
                                  })
                                }
                              />
                            </Field>
                          )}
                          <div className="flex items-end">
                            <ModsPicker
                              value={p.mods}
                              onChange={(mods) => player(index, { mods })}
                              label={tr('Mods for player {0}', index + 1)}
                            />
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                </section>
              ))}
            </div>
          )}
          {totals ? (
            <div className="flex flex-wrap items-center justify-between gap-4 border-y py-4">
              <p className="text-lg font-semibold">
                {formatMapValue(totals.scoreA, localeTag(language))} :{' '}
                {formatMapValue(totals.scoreB, localeTag(language))}
              </p>
              <p className={totals.winnerSide === 'A' ? 'text-red-200' : 'text-sky-200'}>
                {tr('Winner:')} {match.participants[totals.winnerSide].name}
              </p>
            </div>
          ) : (
            <p className="text-amber-200">{issue}</p>
          )}
          <Field label={tr('Map notes')}>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Field label={tr('Result reason')}>
            <input
              required
              minLength={3}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <SaveButton busy={busy} disabled={stale || (mode !== 'winner' && !totals)}>
            <Save size={17} />
            {tr('Save map result')}
          </SaveButton>
        </form>
      )}
    </Modal>
  );
}
