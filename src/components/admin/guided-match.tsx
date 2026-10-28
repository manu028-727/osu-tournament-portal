'use client';
import { humanizeCode, localeTag } from '@/lib/i18n';
import { MATCH_ACTION_MESSAGES } from '@/lib/match-display';
import { useLocale, useT } from '@/components/locale';

import { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Flag,
  Pencil,
  Play,
  Save,
  Terminal,
  SlidersHorizontal,
  RefreshCw,
} from 'lucide-react';
import type { MatchView } from '@/lib/matches-types';
import type { MatchAccess } from '@/lib/match-access';
import { firstTo } from '@/lib/match-rules';
import { lobbyCommands, startingSide } from '@/lib/match-engine';
import type { Side } from '@/lib/match-rules';
import { Button } from '../ui/button';
import { Field } from './shared';
import { RefereePool } from './referee-pool';
type Props = {
  match: MatchView;
  access: MatchAccess;
  acronym: string;
  busy: boolean;
  post: (body: object, message: string) => Promise<unknown>;
  copy: (text: string) => void;
  onScore: (id: string) => void;
  onSubmit: () => void;
  onConfirm: () => void;
  onCorrect: (id: string) => void;
  onSync: () => void;
  onSummary: () => void;
};
export function GuidedMatch({
  match: m,
  access,
  acronym,
  busy,
  post,
  copy,
  onScore,
  onSubmit,
  onConfirm,
  onCorrect,
  onSync,
  onSummary,
}: Props) {
  const language = useLocale();
  const tr = useT();
  const [filter, setFilter] = useState(''),
    [selection, setSelection] = useState<{ slot: string; version: number } | null>(null);
  const [roll, setRoll] = useState({
    a: '',
    b: '',
    ban: 'A' as Side,
    pick: 'A' as Side,
    protect: 'A' as Side,
    version: m.version,
  });
  const w = m.workflow,
    actions = m.actions.filter((a) => !a.voided),
    results = m.results.filter((r) => !r.voided),
    slots = m.poolRevision?.slots || [];
  const pending = actions.find((a) => a.id === w.currentActionId),
    current = slots.find((s) => s.name === pending?.slotName);
  const canDraft = access.draft && m.status === 'IN_PROGRESS' && m.resultMode === 'MAPS';
  const canScore = access.score && m.status === 'IN_PROGRESS' && m.resultMode === 'MAPS';
  const eligible = slots.filter((s) => w.eligibleSlots.includes(s.name));
  const a = Number(roll.a),
    b = Number(roll.b),
    tied = !!roll.a && !!roll.b && a === b;
  useEffect(() => {
    setFilter('');
  }, [w.phase, w.side]);
  const command = current
    ? lobbyCommands(
        m.rules,
        acronym,
        { code: String(m.matchNumber), teamA: m.participants.A.name, teamB: m.participants.B.name },
        current,
      )
    : null;
  const summaryCorrection = m.resultMode === 'SUMMARY' && m.status === 'IN_PROGRESS';
  const heading = summaryCorrection
    ? tr('Historical result')
    : w.phase === 'PREPARATION'
      ? tr('Match ready')
      : w.phase === 'ROLL'
        ? tr('Roll phase')
        : w.phase === 'RESULT'
          ? tr('Now playing - {0}', pending?.slotName || '')
          : w.phase === 'TIEBREAKER'
            ? tr('Tiebreaker')
            : w.phase === 'REVIEW'
              ? tr('Match decided - review result')
              : w.phase === 'COMPLETED'
                ? tr('Match complete')
                : tr(humanizeCode(w.phase)).toLowerCase();
  let scoreA = 0,
    scoreB = 0;
  return (
    <div
      className="guided-match-grid mt-4 grid items-start gap-4"
      aria-label={tr('Live match workflow')}
    >
      <section
        className="guided-current min-w-0 border-t-2 border-primary bg-primary/[.025] p-3"
        aria-label={tr('Current action')}
      >
        <p className="mb-1 text-xs uppercase text-muted">{tr('Current action')}</p>
        {w.side && ['BAN', 'PROTECT', 'PICK', 'TIEBREAKER'].includes(w.phase) && (
          <p
            title={m.participants[w.side].name}
            className={`mb-1 truncate text-base font-semibold ${w.side === 'A' ? 'text-red-200' : 'text-sky-200'}`}
          >
            {tr('Team')} {w.side === 'A' ? tr('Red') : tr('Blue')} · {m.participants[w.side].name}
          </p>
        )}
        <h2 className="text-lg font-semibold capitalize" data-testid="current-phase">
          {heading}
        </h2>
        {summaryCorrection && access.manager && (
          <Button className="mt-3" onClick={onSummary}>
            <Save size={16} />
            {tr('Correct overall result')}
          </Button>
        )}
        {!access.editable && <p className="my-3 text-sm text-muted">{tr('Read-only observer')}</p>}
        {w.phase === 'PREPARATION' && (
          <div className="my-3 space-y-3 text-sm">
            <p>
              {tr('Best of')} {m.rules.bestOf} {tr('· First to')} {firstTo(m.rules)}
            </p>
            <p>
              {tr('Bans:')} {m.rules.banOrder} · {m.rules.bansPerTeam} {tr('each')}
            </p>
            <p>
              {tr('Protects:')} {m.rules.protectsPerTeam} {tr('each · Picks:')} {m.rules.pickOrder}
            </p>
            {access.operate && (
              <Button
                disabled={busy || !m.participants.A.id || !m.participants.B.id || !m.poolRevision}
                onClick={() =>
                  void post(
                    { type: 'match.start', id: m.id, baseVersion: m.version },
                    'Match started.',
                  )
                }
              >
                <Play size={16} />
                {tr('Start match')}
              </Button>
            )}
          </div>
        )}
        {w.phase === 'ROLL' && canDraft && (
          <form
            className="mt-3 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void post(
                {
                  type: 'match.roll',
                  id: m.id,
                  baseVersion: roll.version,
                  rollA: a,
                  rollB: b,
                  firstBanSide: roll.ban,
                  firstPickSide: roll.pick,
                  firstProtectSide: roll.protect,
                },
                'Roll recorded.',
              );
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              {(['a', 'b'] as const).map((side) => (
                <Field
                  key={side}
                  label={tr('Team {0} roll', side === 'a' ? tr('Red') : tr('Blue'))}
                >
                  <input
                    type="number"
                    required
                    min={1}
                    max={100}
                    value={roll[side]}
                    onChange={(e) =>
                      setRoll({
                        ...roll,
                        [side]: e.target.value,
                        ...(!roll.a && !roll.b ? { version: m.version } : {}),
                      })
                    }
                  />
                </Field>
              ))}
            </div>
            {tied ? (
              <p role="status" className="text-sm text-amber-200">
                {tr('Tied rolls. Enter the reroll results.')}
              </p>
            ) : a && b ? (
              <p className="text-sm">
                {tr('Roll winner:')} {m.participants[a > b ? 'A' : 'B'].name}
              </p>
            ) : null}
            {(['ban', 'pick', ...(m.rules.protectsPerTeam ? ['protect'] : [])] as const).map(
              (kind) => {
                const key = kind as 'ban' | 'pick' | 'protect',
                  rule =
                    key === 'ban'
                      ? m.rules.firstBanRule
                      : key === 'pick'
                        ? m.rules.firstPickRule
                        : m.rules.firstProtectRule;
                return (
                  <Field
                    key={key}
                    label={tr(
                      { ban: 'First ban', pick: 'First pick', protect: 'First protect' }[key],
                    )}
                  >
                    <select
                      value={startingSide(rule, a, b, roll[key])}
                      disabled={rule !== 'CHOICE'}
                      onChange={(e) => setRoll({ ...roll, [key]: e.target.value })}
                    >
                      <option value="A">{tr('Red')}</option>
                      <option value="B">{tr('Blue')}</option>
                    </select>
                  </Field>
                );
              },
            )}
            {roll.version !== m.version && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setRoll({ ...roll, version: m.version })}
              >
                {tr('Review latest version')} {m.version}
              </Button>
            )}
            <Button disabled={busy || !a || !b || tied || roll.version !== m.version}>
              <Flag size={16} />
              {tr('Confirm roll')}
            </Button>
          </form>
        )}
        {['BAN', 'PROTECT', 'PICK', 'TIEBREAKER'].includes(w.phase) && (
          <div className="mt-3 space-y-3">
            {canDraft && (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!selection) return;
                  setSelection(null);
                  void post(
                    {
                      type: 'match.draft',
                      id: m.id,
                      baseVersion: selection.version,
                      kind: w.phase === 'TIEBREAKER' ? 'PICK' : w.phase,
                      side: w.side,
                      slotName: selection.slot,
                    },
                    'Draft action recorded.',
                  );
                }}
              >
                <Field label={tr('Search eligible maps')}>
                  <input
                    disabled={busy}
                    type="search"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </Field>
                <Field label={tr('Available map slot')}>
                  <select
                    required
                    disabled={busy}
                    value={selection?.slot || ''}
                    onChange={(e) => setSelection({ slot: e.target.value, version: m.version })}
                  >
                    <option value="">{tr('Select available map')}</option>
                    {eligible
                      .filter((s) =>
                        `${s.name} ${s.metadata.artist} ${s.metadata.title} ${s.metadata.difficulty}`
                          .toLowerCase()
                          .includes(filter.toLowerCase()),
                      )
                      .map((s) => (
                        <option key={s.name} value={s.name}>
                          {s.name} - {s.metadata.title} [{s.metadata.difficulty}]
                        </option>
                      ))}
                  </select>
                </Field>
                {selection && selection.version !== m.version && (
                  <p role="alert" className="text-sm text-amber-200">
                    {tr('Match changed. Select a map again before confirming.')}
                  </p>
                )}
                <Button
                  className="w-full"
                  disabled={
                    busy ||
                    !selection ||
                    selection.version !== m.version ||
                    !w.eligibleSlots.includes(selection.slot)
                  }
                >
                  <Check size={16} />
                  {tr('Confirm')}{' '}
                  {w.phase === 'TIEBREAKER' ? tr('pick') : tr(humanizeCode(w.phase)).toLowerCase()}
                </Button>
              </form>
            )}
            {!eligible.length && (
              <p className="text-sm text-amber-200">
                {tr('No legal maps remain. Review the rules or undo the incorrect action.')}
              </p>
            )}
            <p className="text-xs text-muted">
              {w.remainingProtects} {tr('protects remaining ·')} {w.remainingBans}{' '}
              {tr('bans remaining')}
            </p>
          </div>
        )}
        {current && pending && (
          <div className="mt-3 space-y-3">
            <p className="break-words text-sm">
              {current.metadata.artist} - {current.metadata.title} [{current.metadata.difficulty}]
            </p>
            <p className="text-sm text-muted">
              {tr('Picked by')} {m.participants[pending.side].name}
            </p>
            <p className="font-mono text-base">{current.beatmapId}</p>
            <div className="flex gap-1">
              {[
                [tr('Copy {0} ID', current.name), String(current.beatmapId), Copy],
                [tr('Copy {0} map command', current.name), command!.map, Terminal],
                [tr('Copy {0} mod command', current.name), command!.mods, SlidersHorizontal],
              ].map(([label, value, Icon]) => {
                const I = Icon as typeof Copy;
                return (
                  <Button
                    key={String(label)}
                    variant="outline"
                    size="icon"
                    title={String(label)}
                    aria-label={String(label)}
                    onClick={() => copy(String(value))}
                  >
                    <I size={16} />
                  </Button>
                );
              })}
            </div>
            {canScore && (
              <div className="grid gap-2">
                {(['A', 'B'] as const).map((side) => (
                  <Button
                    key={side}
                    variant="outline"
                    disabled={busy}
                    className={side === 'A' ? 'text-red-200' : 'text-sky-200'}
                    onClick={() =>
                      void post(
                        {
                          type: 'match.winner',
                          id: m.id,
                          baseVersion: m.version,
                          actionId: pending.id,
                          winnerSide: side,
                          reason: 'Referee confirmed map winner',
                          notes: '',
                        },
                        'Map winner saved.',
                      )
                    }
                  >
                    <Check size={16} />
                    {side === 'A' ? tr('Red') : tr('Blue')} {tr('wins')} {pending.slotName}
                  </Button>
                ))}
                <Button variant="ghost" disabled={busy} onClick={() => onScore(pending.id)}>
                  <Save size={16} />
                  {tr('Enter scores')} {pending.slotName}
                </Button>
              </div>
            )}
            {m.multiplayerId && (
              <div className="space-y-2 border-t pt-2">
                <p className="text-xs text-muted">
                  {m.multiplayerSyncedAt
                    ? tr(
                        'Last sync {0}',
                        new Date(m.multiplayerSyncedAt).toLocaleTimeString(localeTag(language)),
                      )
                    : tr('Games not synchronized')}
                </p>
                {canScore && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={onSync}>
                    <RefreshCw size={14} />
                    {tr('Sync games')}
                  </Button>
                )}
                {m.multiplayerGames
                  ?.filter(
                    (g) =>
                      !g.confirmedAt &&
                      !g.ignoredAt &&
                      g.proposal &&
                      g.slotName === pending.slotName &&
                      (g.actionId === pending.id ||
                        (pending.createdAt &&
                          new Date(g.proposal.startTime) >= new Date(pending.createdAt))),
                  )
                  .slice(0, 1)
                  .map((g) => (
                    <div key={g.id} className="space-y-2 text-sm">
                      <p>
                        {tr('Detected game')} {g.gameId}
                      </p>
                      <p>
                        {tr('Red')} {g.proposal!.scoreA.toLocaleString(localeTag(language))} :{' '}
                        {g.proposal!.scoreB.toLocaleString(localeTag(language))} {tr('Blue')}
                      </p>
                      {canScore && (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(tr('Confirm the result of game {0}?', g.gameId)))
                              void post(
                                {
                                  type: 'match.import',
                                  id: m.id,
                                  baseVersion: m.version,
                                  proposalId: g.id,
                                  reason: 'Referee confirmed the detected current map result',
                                },
                                'Imported result confirmed.',
                              );
                          }}
                        >
                          <Check size={14} />
                          {tr('Confirm detected result')}
                        </Button>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
        {['REVIEW', 'AWAITING_CONFIRMATION', 'COMPLETED'].includes(w.phase) && (
          <div className="my-3 space-y-3">
            <p className="font-semibold">
              {m.winnerSide ? m.participants[m.winnerSide].name : tr('Result')} · {m.scoreA} :{' '}
              {m.scoreB}
            </p>
            {w.phase === 'REVIEW' && access.submit && !summaryCorrection && (
              <Button onClick={onSubmit}>
                <Check size={16} />
                {tr('Review & submit result')}
              </Button>
            )}
            {w.phase === 'AWAITING_CONFIRMATION' && access.manager && (
              <Button onClick={onConfirm}>
                <Check size={16} />
                {tr('Confirm result')}
              </Button>
            )}
          </div>
        )}
        <p className="mt-4 border-t pt-3 text-xs text-muted">
          {tr('Saved version')} {m.version}
        </p>
      </section>
      <RefereePool
        dense
        slots={slots}
        rules={m.rules}
        copy={copy}
        state={(slot) => {
          const picked = actions.find((a) => a.slotName === slot.name && a.kind === 'PICK'),
            banned = actions.find((a) => a.slotName === slot.name && a.kind === 'BAN'),
            protectedMap = actions.find((a) => a.slotName === slot.name && a.kind === 'PROTECT');
          const result = results.find((r) => r.actionId === picked?.id);
          return result
            ? tr('Played - {0} won', tr(result.winnerSide === 'A' ? 'Red' : 'Blue'))
            : picked
              ? tr('Current map')
              : banned
                ? tr('Banned')
                : protectedMap
                  ? tr('Protected')
                  : slot.category === m.rules.tiebreakerCategory
                    ? tr('Tiebreaker - reserved')
                    : tr('Available');
        }}
      />
      <section
        className="guided-history min-w-0 border-t pt-3"
        aria-label={tr('Match action timeline')}
      >
        <h2 className="mb-3 text-base font-semibold">{tr('Match history')}</h2>
        <ol className="referee-scroll max-h-[56vh] space-y-0 overflow-auto text-sm">
          {actions.map((a, index) => {
            const result = results.find((r) => r.actionId === a.id);
            if (result) result.winnerSide === 'A' ? scoreA++ : scoreB++;
            return (
              <li key={a.id} className="border-b py-2">
                <div className="flex items-start gap-2">
                  <span className="text-xs text-muted">{String(index + 1).padStart(2, '0')}</span>
                  <span className={`flex-1 ${a.side === 'A' ? 'text-red-200' : 'text-sky-200'}`}>
                    {tr(MATCH_ACTION_MESSAGES[a.kind], a.side === 'A' ? tr('Red') : tr('Blue'))}{' '}
                    <strong>{a.slotName}</strong>
                  </span>
                  {result && canScore && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 shrink-0"
                      title={tr('Correct {0} result', a.slotName)}
                      aria-label={tr('Correct {0} result', a.slotName)}
                      onClick={() => onScore(a.id)}
                    >
                      <Save size={13} />
                    </Button>
                  )}
                  {canDraft && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 shrink-0"
                      title={tr('Correct action {0}', a.sequence)}
                      aria-label={tr('Correct action {0}', a.sequence)}
                      onClick={() => onCorrect(a.id)}
                    >
                      <Pencil size={13} />
                    </Button>
                  )}
                </div>
                {result && (
                  <p className="mt-1 pl-6 text-xs">
                    {result.winnerSide === 'A' ? tr('Red') : tr('Blue')} {tr('wins ·')} {scoreA} :{' '}
                    {scoreB}
                  </p>
                )}
                <div className="flex min-w-0 gap-2 pl-6 text-xs text-muted">
                  {a.createdAt && (
                    <time className="shrink-0" dateTime={a.createdAt}>
                      {new Date(a.createdAt).toLocaleTimeString(localeTag(language), {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  )}
                  {a.actor && (
                    <span className="truncate" title={a.actor.username}>
                      {a.actor.username}
                    </span>
                  )}
                </div>
                {a.provenance?.type === 'XLSX' && (
                  <p className="pl-6 text-xs text-muted">
                    {tr('Sheet')} {a.provenance.worksheet}:{a.provenance.sourceRow}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        {!actions.length && <p className="text-sm text-muted">{tr('No actions recorded.')}</p>}
      </section>
    </div>
  );
}
