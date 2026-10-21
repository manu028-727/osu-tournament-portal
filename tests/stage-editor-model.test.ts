import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_RULES, matchRulesSchema } from '@/lib/match-rules';
import {
  moveStageActionSequence,
  stageActionSequenceLabel,
  withStageActionSequence,
  withStageBestOf,
} from '@/components/admin/stage-editor-model';

describe('stage overview rule editing', () => {
  it('changes count-based Best-of without forcing a custom action sequence', () => {
    const changed = withStageBestOf(DEFAULT_MATCH_RULES, 13);

    expect(changed.bestOf).toBe(13);
    expect(changed.draftSequence).toEqual([]);
  });

  it('keeps custom action pairs in order and adjusts pick pairs for Best-of', () => {
    const rules = withStageActionSequence(DEFAULT_MATCH_RULES, [
      'PROTECT',
      'BAN',
      'PICK',
      'BAN',
      'PICK',
      'TB_BAN',
    ]);
    const shortened = withStageBestOf(rules, 3);

    expect(shortened.draftSequence).toEqual(['PROTECT', 'BAN', 'PICK', 'BAN', 'TB_BAN']);
    expect(shortened.bestOf).toBe(3);
    expect(shortened.bansPerTeam).toBe(2);
    expect(matchRulesSchema.safeParse(shortened).success).toBe(true);
  });

  it('inserts additional picks before the final tiebreaker action', () => {
    const rules = withStageActionSequence(DEFAULT_MATCH_RULES, ['PICK', 'BAN', 'TB_BAN']);
    const expanded = withStageBestOf(rules, 7);

    expect(expanded.draftSequence).toEqual(['PICK', 'BAN', 'PICK', 'PICK', 'TB_BAN']);
    expect(expanded.draftSequence.at(-1)).toBe('TB_BAN');
    expect(matchRulesSchema.safeParse(expanded).success).toBe(true);
  });

  it('keeps the tiebreaker action at the end and describes count-based rules', () => {
    const sequence = ['PICK', 'TB_BAN'] as const;
    expect(moveStageActionSequence([...sequence], 0, 1)).toEqual([...sequence]);
    expect(stageActionSequenceLabel(DEFAULT_MATCH_RULES)).toContain('Count-based · BO11');
  });
});
