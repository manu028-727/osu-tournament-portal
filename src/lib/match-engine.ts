import { AppError } from './permissions';
import { firstTo, otherSide, type MatchRules, type Side } from './match-rules';
import { lobbyModTokens } from './score-pipeline';
export type DraftKind = 'PROTECT' | 'BAN' | 'PICK';
export type DraftAction = {
  id: string;
  kind: DraftKind;
  side: Side;
  slotName: string;
  category: string;
  voided: boolean;
};
export type DraftSlot = { name: string; category: string; beatmapId: number };
export type DraftState = {
  firstPickSide: Side | null;
  firstBanSide: Side | null;
  firstProtectSide?: Side | null;
  scoreA: number;
  scoreB: number;
  actions: DraftAction[];
  pendingPick: boolean;
};
export function startingSide(
  rule: MatchRules['firstBanRule'],
  rollA: number,
  rollB: number,
  choice: Side,
): Side {
  if (rule === 'RED') return 'A';
  if (rule === 'BLUE') return 'B';
  const winner = rollA > rollB ? 'A' : 'B';
  return rule === 'ROLL_WINNER' ? winner : rule === 'ROLL_LOSER' ? otherSide(winner) : choice;
}
export type MatchWorkflow = {
  phase:
    | 'PREPARATION'
    | 'ROLL'
    | 'PROTECT'
    | 'BAN'
    | 'PICK'
    | 'TIEBREAKER'
    | 'RESULT'
    | 'REVIEW'
    | 'AWAITING_CONFIRMATION'
    | 'COMPLETED'
    | 'DISPUTED'
    | 'CANCELLED';
  side: Side | null;
  eligibleSlots: string[];
  currentActionId: string | null;
  remainingBans: number;
  remainingProtects: number;
};
export function matchWorkflow(
  rules: MatchRules,
  state: DraftState,
  slots: DraftSlot[],
  status: string,
  pendingId: string | null,
): MatchWorkflow {
  const turn = nextDraftStep(rules, state);
  const used = state.actions.filter((a) => !a.voided);
  const eligibleSlots =
    turn && turn.kind !== 'ROLL'
      ? slots
          .filter((slot) => {
            try {
              validateDraftAction(rules, state, slots, {
                kind: turn.kind as DraftKind,
                side: turn.side!,
                slotName: slot.name,
              });
              return true;
            } catch {
              return false;
            }
          })
          .map((s) => s.name)
      : [];
  const finalMap =
    rules.enableTiebreaker &&
    firstTo(rules) > 1 &&
    state.scoreA === firstTo(rules) - 1 &&
    state.scoreB === firstTo(rules) - 1;
  const phase: MatchWorkflow['phase'] =
    status === 'SCHEDULED'
      ? 'PREPARATION'
      : status !== 'IN_PROGRESS'
        ? (status as MatchWorkflow['phase'])
        : Math.max(state.scoreA, state.scoreB) >= firstTo(rules)
          ? 'REVIEW'
          : pendingId
            ? 'RESULT'
            : turn?.kind === 'PICK' && finalMap
              ? 'TIEBREAKER'
              : turn?.kind || 'REVIEW';
  return {
    phase,
    side: turn?.side || null,
    eligibleSlots: status === 'IN_PROGRESS' ? eligibleSlots : [],
    currentActionId: phase === 'RESULT' ? pendingId : null,
    remainingBans: Math.max(0, 2 * rules.bansPerTeam - used.filter((a) => a.kind === 'BAN').length),
    remainingProtects: Math.max(
      0,
      2 * rules.protectsPerTeam - used.filter((a) => a.kind === 'PROTECT').length,
    ),
  };
}
export function replayDraft(
  rules: MatchRules,
  starters: Pick<DraftState, 'firstPickSide' | 'firstBanSide' | 'firstProtectSide'>,
  slots: DraftSlot[],
  actions: DraftAction[],
  results: { actionId: string; winnerSide: Side; voided: boolean }[],
) {
  const state: DraftState = { ...starters, scoreA: 0, scoreB: 0, actions: [], pendingPick: false };
  for (const action of actions.filter((a) => !a.voided)) {
    validateDraftAction(rules, state, slots, action);
    state.actions.push(action);
    if (action.kind === 'PICK') {
      const result = results.find((r) => r.actionId === action.id && !r.voided);
      if (result) result.winnerSide === 'A' ? state.scoreA++ : state.scoreB++;
      else state.pendingPick = true;
    }
  }
  return state;
}
function sequence(order: string, index: number, start: Side): Side {
  return order[index % order.length] === 'A' ? start : otherSide(start);
}
export function nextDraftStep(
  rules: MatchRules,
  state: DraftState,
): { kind: DraftKind | 'ROLL'; side: Side | null; tiebreakerOnly?: boolean } | null {
  if (Math.max(state.scoreA, state.scoreB) >= firstTo(rules)) return null;
  if (!state.firstPickSide || !state.firstBanSide) return { kind: 'ROLL', side: null };
  const actions = state.actions.filter((a) => !a.voided);
  if (state.pendingPick) return null;
  if (rules.draftSequence.length) {
    const expanded = rules.draftSequence.flatMap((kind) => [kind, kind]);
    expanded.push('PICK');
    const entry = expanded[actions.length];
    if (!entry) return null;
    const ordinal = expanded.slice(0, actions.length).filter((kind) => kind === entry).length;
    const kind = entry === 'TB_BAN' ? 'BAN' : entry;
    const start =
      entry === 'TB_BAN'
        ? rules.tiebreakerBanFirstSide
        : kind === 'PICK'
          ? state.firstPickSide
          : kind === 'PROTECT'
            ? state.firstProtectSide || state.firstBanSide
            : state.firstBanSide;
    const order =
      entry === 'TB_BAN'
        ? rules.tiebreakerBanOrder
        : kind === 'PICK'
          ? rules.pickOrder
          : kind === 'PROTECT'
            ? rules.protectOrder
            : rules.banOrder;
    return {
      kind,
      side: sequence(order, ordinal, start),
      ...(entry === 'TB_BAN' ? { tiebreakerOnly: true } : {}),
    };
  }
  const protects = actions.filter((a) => a.kind === 'PROTECT').length;
  if (protects < 2 * rules.protectsPerTeam)
    return {
      kind: 'PROTECT',
      side: sequence(rules.protectOrder, protects, state.firstProtectSide || state.firstBanSide),
    };
  const bans = actions.filter((a) => a.kind === 'BAN').length;
  if (bans < 2 * rules.bansPerTeam)
    return { kind: 'BAN', side: sequence(rules.banOrder, bans, state.firstBanSide) };
  if (state.pendingPick) return null;
  const picks = actions.filter((a) => a.kind === 'PICK').length;
  return { kind: 'PICK', side: sequence(rules.pickOrder, picks, state.firstPickSide) };
}
export function validateDraftAction(
  rules: MatchRules,
  state: DraftState,
  slots: DraftSlot[],
  input: { kind: DraftKind; side: Side; slotName: string },
) {
  const expected = nextDraftStep(rules, state);
  if (!expected || expected.kind !== input.kind || expected.side !== input.side)
    throw new AppError('This action is out of turn. Refresh the match state.', 409);
  const slot = slots.find((s) => s.name === input.slotName);
  if (!slot) throw new AppError('This map is not in the match mappool.');
  if (expected.tiebreakerOnly && slot.category !== rules.tiebreakerCategory)
    throw new AppError('This action requires a tiebreaker map.');
  const actions = state.actions.filter((a) => !a.voided);
  if (
    actions.some(
      (a) =>
        a.slotName === slot.name &&
        (a.kind === 'PICK' || a.kind === 'BAN' || input.kind !== 'PICK'),
    )
  )
    throw new AppError('This map is already used or protected.');
  const tiebreak = rules.enableTiebreaker && firstTo(rules) > 1;
  const finalMap =
    tiebreak && state.scoreA === firstTo(rules) - 1 && state.scoreB === firstTo(rules) - 1;
  if (tiebreak && slot.category === rules.tiebreakerCategory) {
    if (input.kind === 'PICK' && !finalMap)
      throw new AppError('The tiebreaker is not available yet.');
    if (input.kind !== 'PICK' && !rules.allowTiebreakerBans && !expected.tiebreakerOnly)
      throw new AppError('The tiebreaker cannot be banned or protected.');
  } else if (finalMap && input.kind === 'PICK')
    throw new AppError('Select a tiebreaker at match point.');
  const previous = actions.filter((a) => a.side === input.side && a.kind === input.kind).at(-1);
  const restricted =
    input.kind === 'PICK'
      ? !rules.allowDoublePicks
      : input.kind === 'BAN'
        ? !rules.allowDoubleBans
        : false;
  if (restricted && !expected.tiebreakerOnly && !rules.categoryExceptions.includes(slot.category)) {
    if (
      rules.doubleSelectionScope === 'ANY' &&
      actions.some(
        (a) => a.side === input.side && a.kind === input.kind && a.category === slot.category,
      )
    )
      throw new AppError('This team already chose a map from this category.');
    if (previous?.category === slot.category)
      throw new AppError('Consecutive picks or bans from this category are not allowed.');
  }
  return slot;
}
// What the rules ask for when a timer runs out, given how often this team has done so.
export function timerConsequence(
  rules: MatchRules,
  kind: 'PICK' | 'BAN' | 'READY',
  priorOffences: number,
) {
  const configured =
    kind === 'PICK'
      ? rules.timerExpiry.pick
      : kind === 'BAN'
        ? rules.timerExpiry.ban
        : rules.timerExpiry.ready;
  if (configured === 'NONE') return null;
  return rules.timerExpiry.warnFirst && priorOffences === 0 ? ('WARNING' as const) : configured;
}
export function lobbyCommands(
  rules: MatchRules,
  acronym: string,
  match: { code: string; teamA: string; teamB: string },
  slot?: DraftSlot,
  lobby?: { qualifierPlayers: number },
) {
  if (
    lobby &&
    (!Number.isInteger(lobby.qualifierPlayers) ||
      lobby.qualifierPlayers < 1 ||
      lobby.qualifierPlayers > 16)
  )
    throw new AppError('Qualifier lobbies require between one and sixteen active players.');
  const safe = (value: string) => value.replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 120);
  const name = lobby
    ? `${safe(acronym)}: Qualifiers ${safe(match.code)}`
    : `${safe(acronym)}: (${safe(match.teamA)}) vs (${safe(match.teamB)})`;
  const commands = {
    name,
    make: rules.gameplayScoring === 'LAZER' ? '' : `!mp make ${name}`,
    settings:
      rules.gameplayScoring === 'LAZER'
        ? ''
        : `!mp set ${lobby ? 0 : { HEAD_TO_HEAD: 0, TAG_COOP: 1, TEAM_VS: 2, TAG_TEAM_VS: 3 }[rules.teamMode]} ${{ SCORE: 0, ACCURACY: 1, COMBO: 2, SCORE_V2: 3 }[rules.scoreMode]} ${lobby?.qualifierPlayers ?? Math.min(rules.teamSize * 2 + 1, 16)}`,
    map: slot
      ? `!mp map ${slot.beatmapId} ${{ osu: 0, taiko: 1, fruits: 2, mania: 3 }[rules.gameMode]}`
      : '',
    mods: slot ? `!mp mods ${lobbyModTokens(rules, slot.category).join(' ') || 'None'}` : '',
    start: '!mp start 5',
    timer: `!mp timer ${rules.readySeconds}`,
    inspect: '!mp settings',
    abort: '!mp abort',
  };
  if (rules.gameplayScoring === 'LAZER')
    for (const key of [
      'make',
      'settings',
      'map',
      'mods',
      'start',
      'timer',
      'inspect',
      'abort',
    ] as const)
      commands[key] = '';
  return commands;
}
