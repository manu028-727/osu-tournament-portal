import type { MatchRules } from '@/lib/match-rules';
import { nextDraftStep, startingSide, type DraftState } from '@/lib/match-engine';
import { stageRulesWithSequence } from '@/lib/stage-workflows-validation';

export type StageAction = MatchRules['draftSequence'][number];

export function withStageBestOf(rules: MatchRules, bestOf: number): MatchRules {
  if (!rules.draftSequence.length) return { ...rules, bestOf };
  const sequence = [...rules.draftSequence];
  let picks = sequence.filter((kind) => kind === 'PICK').length;
  while (picks > (bestOf - 1) / 2) {
    sequence.splice(sequence.lastIndexOf('PICK'), 1);
    picks--;
  }
  while (picks < (bestOf - 1) / 2) {
    const before = sequence.indexOf('TB_BAN');
    sequence.splice(before < 0 ? sequence.length : before, 0, 'PICK');
    picks++;
  }
  return stageRulesWithSequence({ ...rules, bestOf }, sequence);
}

export function withStageActionSequence(
  rules: MatchRules,
  draftSequence: StageAction[],
): MatchRules {
  return stageRulesWithSequence(rules, draftSequence);
}

export function moveStageActionSequence(
  sequence: StageAction[],
  index: number,
  offset: -1 | 1,
): StageAction[] {
  const target = index + offset;
  if (
    index < 0 ||
    index >= sequence.length ||
    target < 0 ||
    target >= sequence.length ||
    sequence[index] === 'TB_BAN' ||
    sequence[target] === 'TB_BAN'
  )
    return sequence;

  const next = [...sequence];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function stageActionSequenceLabel(rules: MatchRules): string {
  if (!rules.draftSequence.length) {
    return `Count-based · BO${rules.bestOf} · ${rules.bansPerTeam} bans · ${rules.protectsPerTeam} protects`;
  }

  return rules.draftSequence.map((action) => action.replace('_', ' ')).join(' → ');
}

export const STAGE_TEMPLATES = [
  { key: 'QUALIFIERS', name: 'Qualifiers', kind: 'QUALIFIERS' },
  { key: 'STANDARD', name: 'Bracket round', kind: 'ELIMINATION' },
  { key: 'QUARTERFINALS', name: 'Quarterfinals', kind: 'ELIMINATION' },
  { key: 'SEMIFINALS', name: 'Semifinals', kind: 'ELIMINATION' },
  { key: 'FINALS', name: 'Finals', kind: 'ELIMINATION' },
  { key: 'GRAND_FINALS', name: 'Grand Finals', kind: 'ELIMINATION' },
  { key: 'CUSTOM', name: 'Custom stage', kind: 'CUSTOM' },
] as const;

export function mixedStageValue<T>(values: T[]): T | 'MIXED' {
  return values.length &&
    values.every((value) => JSON.stringify(value) === JSON.stringify(values[0]))
    ? values[0]
    : 'MIXED';
}

export function previewStageActions(rules: MatchRules, first: 'A' | 'B' = 'A') {
  const resolve = (rule: MatchRules['firstPickRule']) =>
    startingSide(rule, first === 'A' ? 100 : 1, first === 'B' ? 100 : 1, first);
  const state: DraftState = {
    firstPickSide: resolve(rules.firstPickRule),
    firstBanSide: resolve(rules.firstBanRule),
    firstProtectSide: resolve(rules.firstProtectRule),
    scoreA: 0,
    scoreB: 0,
    pendingPick: false,
    actions: [],
  };
  const preview: { kind: string; side: 'A' | 'B' | null; tiebreaker: boolean }[] = [];
  for (let index = 0; index < 150; index++) {
    const next = nextDraftStep(rules, state);
    if (!next || next.kind === 'ROLL') break;
    const tiebreaker =
      next.kind === 'PICK' &&
      rules.enableTiebreaker &&
      rules.bestOf > 1 &&
      state.scoreA === (rules.bestOf - 1) / 2 &&
      state.scoreB === state.scoreA;
    preview.push({
      kind: next.kind,
      side: next.side,
      tiebreaker: tiebreaker || !!next.tiebreakerOnly,
    });
    state.actions.push({
      id: String(index),
      kind: next.kind,
      side: next.side!,
      slotName: `preview-${index}`,
      category: 'NM',
      voided: false,
    });
    if (next.kind === 'PICK') state.scoreA > state.scoreB ? state.scoreB++ : state.scoreA++;
  }
  return preview;
}

export function stageActionPreset(
  rules: MatchRules,
  preset: 'ONE_BAN' | 'TWO_BANS' | 'PROTECT_BANS' | 'ALTERNATING',
): MatchRules {
  if (preset === 'ALTERNATING') return { ...rules, pickOrder: 'ABAB' };
  const bansPerTeam = preset === 'ONE_BAN' ? 1 : 2;
  return stageRulesWithSequence(
    {
      ...rules,
      bansPerTeam,
      protectsPerTeam: preset === 'PROTECT_BANS' ? 1 : 0,
      banOrder: bansPerTeam === 1 ? 'AB' : 'ABBA',
    },
    [
      ...(preset === 'PROTECT_BANS' ? ['PROTECT' as const] : []),
      ...Array<StageAction>(bansPerTeam).fill('BAN'),
      ...Array<StageAction>((rules.bestOf - 1) / 2).fill('PICK'),
    ],
  );
}

export function explicitStageSequence(rules: MatchRules): StageAction[] {
  return rules.draftSequence.length
    ? rules.draftSequence
    : [
        ...Array<StageAction>(rules.protectsPerTeam).fill('PROTECT'),
        ...Array<StageAction>(rules.bansPerTeam).fill('BAN'),
        ...Array<StageAction>((rules.bestOf - 1) / 2).fill('PICK'),
      ];
}
