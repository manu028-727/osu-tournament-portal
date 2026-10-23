import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_RULES, matchRulesSchema } from '@/lib/match-rules';
import {
  moveStageActionSequence,
  stageActionSequenceLabel,
  withStageActionSequence,
  withStageBestOf,
  previewStageActions,
  mixedStageValue,
  stageActionPreset,
  explicitStageSequence,
} from '@/components/admin/stage-editor-model';
import {
  patchStageRules,
  stagePoolIssues,
  stageRulePatchSchema,
  stageWorkflowActionSchema,
} from '@/lib/stage-workflows-validation';
import { stageConfigurationToken } from '@/lib/stage-workflows';
import { stagePoolProblems } from '@/lib/stage-pool-validation';

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

describe('stage rule patches and reusable configuration', () => {
  it('retains only explicitly supplied fields when parsing patches', () => {
    expect(stageRulePatchSchema.parse({ bestOf: 13 })).toEqual({ bestOf: 13 });
    expect(stageRulePatchSchema.safeParse({}).success).toBe(false);
    expect(stageRulePatchSchema.safeParse({ scoreMode: 'SCORE' }).success).toBe(false);
    expect(stageRulePatchSchema.safeParse({ bestOf: 10 }).success).toBe(false);
  });

  it('preserves other rules and custom action order for a Best-of patch', () => {
    const rules = withStageActionSequence(
      { ...DEFAULT_MATCH_RULES, timeoutSeconds: 180, pickOrder: 'ABAB' },
      ['BAN', 'PICK', 'BAN', 'PICK'],
    );
    const next = patchStageRules(rules, { bestOf: 9 });
    expect(next.draftSequence).toEqual(['BAN', 'PICK', 'BAN', 'PICK', 'PICK', 'PICK']);
    expect(next.timeoutSeconds).toBe(180);
    expect(next.pickOrder).toBe('ABAB');
    expect(rules.draftSequence).toEqual(['BAN', 'PICK', 'BAN', 'PICK']);
  });

  it('adjusts ban and protect pairs without removing custom picks', () => {
    const base = withStageActionSequence(DEFAULT_MATCH_RULES, [
      'BAN',
      'PICK',
      'BAN',
      'PICK',
      'TB_BAN',
    ]);
    const next = patchStageRules(base, { protectsPerTeam: 1, bansPerTeam: 1, banOrder: 'AB' });
    expect(next.draftSequence).toEqual(['PROTECT', 'BAN', 'PICK', 'PICK', 'TB_BAN']);
    expect(next.bestOf).toBe(5);
  });

  it('rejects explicit sequence/count conflicts instead of changing Best-of silently', () => {
    expect(() =>
      patchStageRules(DEFAULT_MATCH_RULES, { bestOf: 11, draftSequence: ['BAN', 'PICK'] }),
    ).toThrow('bestOf conflicts');
    expect(() => patchStageRules(DEFAULT_MATCH_RULES, { bansPerTeam: 2, banOrder: 'AB' })).toThrow(
      'AB requires',
    );
    const next = patchStageRules(DEFAULT_MATCH_RULES, {
      draftSequence: ['PROTECT', 'BAN', 'PICK'],
    });
    expect(next.bestOf).toBe(3);
    expect(next.protectsPerTeam).toBe(1);
  });

  it('supports reusing tournament-specific Best-of with an action preset', () => {
    const preset = stageActionPreset({ ...DEFAULT_MATCH_RULES, bestOf: 17 }, 'ONE_BAN');
    expect(preset.bestOf).toBe(17);
    expect(preset.bansPerTeam).toBe(1);
    expect(preset.banOrder).toBe('AB');
    expect(preset.draftSequence.filter((kind) => kind === 'PICK')).toHaveLength(8);
    expect(matchRulesSchema.safeParse(preset).success).toBe(true);
  });

  it('materializes count-based pairs without changing engine turn counts', () => {
    expect(explicitStageSequence(DEFAULT_MATCH_RULES)).toEqual([
      'BAN',
      'BAN',
      'PICK',
      'PICK',
      'PICK',
      'PICK',
      'PICK',
    ]);
    expect(previewStageActions(DEFAULT_MATCH_RULES).map((step) => step.kind)).toEqual(
      previewStageActions({
        ...DEFAULT_MATCH_RULES,
        draftSequence: explicitStageSequence(DEFAULT_MATCH_RULES),
      }).map((step) => step.kind),
    );
  });

  it.each(['ABAB', 'ABBA'] as const)(
    'previews %s using actual referee engine semantics',
    (order) => {
      const rules = { ...DEFAULT_MATCH_RULES, bestOf: 5, pickOrder: order };
      const picks = previewStageActions(rules).filter((step) => step.kind === 'PICK');
      expect(
        picks
          .slice(0, 4)
          .map((step) => step.side)
          .join(''),
      ).toBe(order);
      expect(picks.at(-1)?.tiebreaker).toBe(true);
      expect(picks).toHaveLength(5);
    },
  );

  it('previews fixed starters, roll-loser starts, and AB bans separately', () => {
    const rules = {
      ...DEFAULT_MATCH_RULES,
      bestOf: 3,
      bansPerTeam: 1,
      banOrder: 'AB' as const,
      firstPickRule: 'BLUE' as const,
      firstBanRule: 'ROLL_LOSER' as const,
    };
    const preview = previewStageActions(rules, 'A');
    expect(preview.slice(0, 3).map((step) => step.side)).toEqual(['B', 'A', 'B']);
  });

  it('reports mixed values and hashes saved dates and object keys consistently', () => {
    expect(mixedStageValue([11, 13])).toBe('MIXED');
    expect(mixedStageValue([11, 11])).toBe(11);
    expect(stageConfigurationToken({ a: 1, at: new Date('2026-10-01T10:00:00Z') })).toBe(
      stageConfigurationToken({ at: '2026-10-01T10:00:00.000Z', a: 1 }),
    );
    expect(stageConfigurationToken({ a: 1 })).not.toBe(stageConfigurationToken({ a: 2 }));
  });

  it('rejects duplicate selections and enforces configuration tokens', () => {
    const stage = { id: 'stage', baseConfigurationToken: 'a'.repeat(64) };
    expect(
      stageWorkflowActionSchema.safeParse({ type: 'stage.reorder', stages: [stage, stage] })
        .success,
    ).toBe(false);
    expect(
      stageWorkflowActionSchema.safeParse({
        type: 'stage.rules.patch',
        stages: [stage],
        patch: { bestOf: 7 },
      }).success,
    ).toBe(false);
    expect(
      stageWorkflowActionSchema.safeParse({
        type: 'stage.rules.patch',
        stages: [stage],
        defaultsToken: 'b'.repeat(64),
        patch: { bestOf: 7 },
      }).success,
    ).toBe(true);
  });
});

describe('stage readiness', () => {
  const maps = (regular: number, tb = 1) => [
    ...Array.from({ length: regular }, (_, index) => ({
      name: `NM${index + 1}`,
      category: 'NM',
      beatmapId: index + 1,
    })),
    ...Array.from({ length: tb }, (_, index) => ({
      name: `TB${index + 1}`,
      category: 'TB',
      beatmapId: 100 + index,
    })),
  ];
  it('allows a draft to be empty while explaining match readiness', () => {
    expect(stagePoolIssues(DEFAULT_MATCH_RULES, null)[0].code).toBe('EMPTY_POOL');
    expect(stagePoolIssues(DEFAULT_MATCH_RULES, maps(14))).toEqual([]);
    expect(
      stagePoolIssues(DEFAULT_MATCH_RULES, maps(12)).find((issue) =>
        issue.message.includes('more maps'),
      )?.message,
    ).toContain('2 more');
  });
  it('requires regular maps, a deciding map, and distinct slots', () => {
    expect(
      stagePoolIssues(DEFAULT_MATCH_RULES, maps(15, 0)).some((issue) =>
        issue.message.includes('tiebreaker'),
      ),
    ).toBe(true);
    expect(
      stagePoolIssues(DEFAULT_MATCH_RULES, maps(10, 5)).some(
        (issue) => issue.code === 'REGULAR_MAPS',
      ),
    ).toBe(true);
    const duplicate = maps(14);
    duplicate[1].name = 'nm1';
    expect(
      stagePoolIssues(DEFAULT_MATCH_RULES, duplicate).some(
        (issue) => issue.code === 'DUPLICATE_SLOTS',
      ),
    ).toBe(true);
  });
  it('accounts for tiebreaker bans without counting TB maps as ordinary picks', () => {
    const rules = withStageActionSequence(DEFAULT_MATCH_RULES, ['BAN', 'PICK', 'TB_BAN']);
    expect(stagePoolIssues(rules, maps(4, 3))).toEqual([]);
    expect(
      stagePoolIssues(rules, maps(4, 1)).some((issue) =>
        issue.message.includes('three tiebreaker'),
      ),
    ).toBe(true);
  });
  it('uses the same tiebreaker-ban capacity checks when publishing', () => {
    const rules = withStageActionSequence(DEFAULT_MATCH_RULES, ['BAN', 'PICK', 'TB_BAN']);
    expect(stagePoolProblems('ELIMINATION', rules, maps(4, 3))).toEqual([]);
    expect(stagePoolProblems('ELIMINATION', rules, maps(3, 3)).join(' ')).toContain('1 more maps');
    expect(stagePoolProblems('ELIMINATION', rules, maps(2, 5)).join(' ')).toContain(
      '2 more non-tiebreaker',
    );
  });
});
