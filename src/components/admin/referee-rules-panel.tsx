'use client';
import { useEffect, useState } from 'react';
import { useT } from '@/components/locale';
import { Button } from '@/components/ui/button';
import { timerConsequence } from '@/lib/match-engine';
import type { Side } from '@/lib/match-rules';
import type { MatchView } from '@/lib/matches-types';
import { Field } from './shared';

const SANCTION_LABELS = {
  WARNING: 'Warning',
  PASS_TO_OPPONENT: 'Turn passes to the opponent',
  RANDOM_MAP: 'A random map is chosen',
  FORCE_START: 'Force the map to start',
  MAP_LOSS: 'Lose this map',
  MATCH_LOSS: 'Lose the match',
  DISQUALIFICATION: 'Disqualify from the bracket',
} as const;
type Sanction = keyof typeof SANCTION_LABELS;
type TimerKind = 'PICK' | 'BAN' | 'READY';

// Suggests and records what the rules say. Nothing here plays a command or moves a turn:
// the referee does that, and the record says what they decided.
export function RefereeRulesPanel({
  match,
  serverNow,
  busy,
  post,
}: {
  match: MatchView;
  serverNow: string;
  busy: boolean;
  post: (input: Record<string, unknown>, message: string) => void;
}) {
  const tr = useT();
  const rules = match.rules;
  const [now, setNow] = useState(() => new Date(serverNow).getTime());
  const [sanction, setSanction] = useState<Sanction>('WARNING');
  const [sanctionSide, setSanctionSide] = useState<Side>('A');
  const [sanctionReason, setSanctionReason] = useState('');
  const [attemptKind, setAttemptKind] = useState<'DRAW' | 'REPLAY'>('REPLAY');
  const [attemptSide, setAttemptSide] = useState<Side>('A');
  const [attemptPlayer, setAttemptPlayer] = useState('');
  const [attemptReason, setAttemptReason] = useState('');
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const pendingPick = match.workflow.currentActionId;
  const timerKind = match.timerKind as string | null;
  const timerRule = timerKind === 'TIMEOUT' ? null : (timerKind as TimerKind | null);
  const expired =
    !!match.timerStartedAt &&
    !!timerRule &&
    new Date(match.timerStartedAt).getTime() + match.timerRemainingSeconds * 1000 <= now;
  const actingSide = (match.workflow.side as Side | null) ?? attemptSide;
  const offences = (match.events ?? []).filter(
    (event) =>
      event.kind === 'match.sanction' &&
      event.side === actingSide &&
      !!(event.data as { timerKind?: string } | null)?.timerKind,
  ).length;
  const due = expired && timerRule ? timerConsequence(rules, timerRule, offences) : null;
  const attempts = match.attempts ?? [];
  const members = [
    ...match.participants.A.members.map((member) => ({ ...member, side: 'A' as const })),
    ...match.participants.B.members.map((member) => ({ ...member, side: 'B' as const })),
  ];
  const nameOf = (osuId: number | null) =>
    members.find((member) => member.osuId === osuId)?.username ?? '';
  const used =
    rules.replayAllowance.scope === 'PLAYER'
      ? attempts.filter((row) => row.kind === 'REPLAY' && row.osuId === Number(attemptPlayer))
          .length
      : attempts.filter((row) => row.kind === 'REPLAY' && row.side === attemptSide).length;
  const overAllowance =
    attemptKind === 'REPLAY' &&
    rules.replayAllowance.scope !== 'NONE' &&
    used >= rules.replayAllowance.perMatch;
  const randomMaps = match.workflow.eligibleSlots.length;
  const record = (kind: Sanction, side: Side, reason: string, fromTimer: TimerKind | null) =>
    post(
      {
        type: 'match.sanction',
        id: match.id,
        baseVersion: match.version,
        sanction: kind,
        side,
        timerKind: fromTimer,
        reason,
      },
      'Sanction recorded.',
    );
  return (
    <details className="border-y py-4">
      <summary className="min-h-10 cursor-pointer font-semibold">
        {tr('Timers, replays and sanctions')}
      </summary>
      <div className="mt-4 grid gap-5">
        {due && (
          <div role="status" className="grid gap-2 border-l-2 border-amber-200 pl-3">
            <p className="text-sm font-semibold">
              {tr('The timer ran out. The rules ask for: {0}', tr(SANCTION_LABELS[due]))}
            </p>
            {due === 'FORCE_START' && <p className="font-mono text-sm">!mp start 10</p>}
            {due === 'RANDOM_MAP' && randomMaps > 0 && (
              <p className="font-mono text-sm">!roll {randomMaps}</p>
            )}
            <div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => record(due, actingSide, tr('Timer ran out'), timerRule)}
              >
                {tr('Record it')}
              </Button>
            </div>
          </div>
        )}
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            post(
              {
                type: 'match.attempt',
                id: match.id,
                baseVersion: match.version,
                actionId: pendingPick,
                kind: attemptKind,
                side: attemptSide,
                osuId: attemptPlayer ? Number(attemptPlayer) : null,
                reason: attemptReason,
                beyondAllowance: overAllowance,
              },
              'Attempt recorded.',
            );
            setAttemptReason('');
          }}
        >
          <h3 className="font-semibold">{tr('Replay or draw on this map')}</h3>
          <div className="grid-fields">
            <Field label={tr('What happened')}>
              <select
                value={attemptKind}
                onChange={(event) => setAttemptKind(event.target.value as 'DRAW' | 'REPLAY')}
              >
                <option value="REPLAY">{tr('Replay requested')}</option>
                <option value="DRAW">{tr('Draw, to be replayed')}</option>
              </select>
            </Field>
            {attemptKind === 'REPLAY' && rules.replayAllowance.scope !== 'PLAYER' && (
              <Field label={tr('Team')}>
                <select
                  value={attemptSide}
                  onChange={(event) => setAttemptSide(event.target.value as Side)}
                >
                  <option value="A">{match.participants.A.name}</option>
                  <option value="B">{match.participants.B.name}</option>
                </select>
              </Field>
            )}
            {attemptKind === 'REPLAY' && rules.replayAllowance.scope === 'PLAYER' && (
              <Field label={tr('Player')}>
                <select
                  required
                  value={attemptPlayer}
                  onChange={(event) => {
                    setAttemptPlayer(event.target.value);
                    const member = members.find(
                      (item) => item.osuId === Number(event.target.value),
                    );
                    if (member) setAttemptSide(member.side);
                  }}
                >
                  <option value="">{tr('Choose a player')}</option>
                  {members.map((member) => (
                    <option key={member.osuId} value={member.osuId}>
                      {member.username}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label={tr('Why this replay or draw')}>
              <input
                required
                minLength={3}
                maxLength={2000}
                value={attemptReason}
                onChange={(event) => setAttemptReason(event.target.value)}
              />
            </Field>
          </div>
          {rules.replayAllowance.scope !== 'NONE' && attemptKind === 'REPLAY' && (
            <p className="text-sm text-muted">
              {tr('{0} of {1} replays used.', used, rules.replayAllowance.perMatch)}{' '}
              {overAllowance ? tr('Recording this goes over the allowance.') : ''}
            </p>
          )}
          <div>
            <Button type="submit" size="sm" variant="outline" disabled={busy || !pendingPick}>
              {tr('Record attempt')}
            </Button>
          </div>
        </form>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            record(sanction, sanctionSide, sanctionReason, null);
            setSanctionReason('');
          }}
        >
          <h3 className="font-semibold">{tr('Sanction')}</h3>
          <div className="grid-fields">
            <Field label={tr('Sanction')}>
              <select
                value={sanction}
                onChange={(event) => setSanction(event.target.value as Sanction)}
              >
                {(Object.keys(SANCTION_LABELS) as Sanction[]).map((key) => (
                  <option key={key} value={key}>
                    {tr(SANCTION_LABELS[key])}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={tr('Team')}>
              <select
                value={sanctionSide}
                onChange={(event) => setSanctionSide(event.target.value as Side)}
              >
                <option value="A">{match.participants.A.name}</option>
                <option value="B">{match.participants.B.name}</option>
              </select>
            </Field>
            <Field label={tr('Why this sanction')}>
              <input
                required
                minLength={3}
                maxLength={2000}
                value={sanctionReason}
                onChange={(event) => setSanctionReason(event.target.value)}
              />
            </Field>
          </div>
          <div>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={busy || (sanction === 'MAP_LOSS' && !pendingPick)}
            >
              {tr('Record sanction')}
            </Button>
          </div>
        </form>
        {attempts.length > 0 && (
          <div>
            <h3 className="mb-2 font-semibold">{tr('Replays and draws')}</h3>
            <ul className="space-y-1 text-sm">
              {attempts.map((row) => (
                <li key={row.id}>
                  {tr(row.kind === 'DRAW' ? 'Draw' : 'Replay')}
                  {row.osuId
                    ? ` · ${nameOf(row.osuId)}`
                    : row.side
                      ? ` · ${match.participants[row.side].name}`
                      : ''}
                  {row.beyondAllowance ? ` · ${tr('over the allowance')}` : ''} · {row.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
