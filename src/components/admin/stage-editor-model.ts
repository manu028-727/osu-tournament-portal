import type { MatchRules } from '@/lib/match-rules';

export type StageAction = MatchRules['draftSequence'][number];

export function withStageBestOf(rules: MatchRules, bestOf: number): MatchRules {
  if (!rules.draftSequence.length) return { ...rules, bestOf };

  const picks = (bestOf - 1) / 2;
  const sequence = [...rules.draftSequence];
  let currentPicks = sequence.filter((action) => action === 'PICK').length;

  while (currentPicks > picks) {
    const index = sequence.lastIndexOf('PICK');
    sequence.splice(index, 1);
    currentPicks--;
  }

  while (currentPicks < picks) {
    const tiebreaker = sequence.indexOf('TB_BAN');
    sequence.splice(tiebreaker < 0 ? sequence.length : tiebreaker, 0, 'PICK');
    currentPicks++;
  }

  return withStageActionSequence({ ...rules, draftSequence: [] }, sequence);
}

export function withStageActionSequence(
  rules: MatchRules,
  draftSequence: StageAction[],
): MatchRules {
  if (!draftSequence.length) return { ...rules, draftSequence: [] };

  return {
    ...rules,
    draftSequence,
    bestOf: 1 + 2 * draftSequence.filter((action) => action === 'PICK').length,
    bansPerTeam: draftSequence.filter((action) => action === 'BAN').length,
    protectsPerTeam: draftSequence.filter((action) => action === 'PROTECT').length,
    ...(draftSequence.includes('TB_BAN') ? { enableTiebreaker: true } : {}),
  };
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
