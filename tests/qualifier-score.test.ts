import { describe, expect, it } from 'vitest';
import { inheritedRules } from '../src/lib/gameplay-scoring';
import { matchRulesSchema } from '../src/lib/match-rules';
import { qualifierPolicySchema } from '../src/lib/qualifier-policy';
import { qualifierEffectiveScore, qualifierIndividualViolation } from '../src/lib/qualifier-score';
import { qualifierTeamModViolation } from '../src/lib/qualifier-eligibility';
import { qualifierCompletion, qualifierProgress } from '../src/lib/qualifier-progress';
import type { QualifierView } from '../src/lib/qualifiers-types';
import { qualifierScoreDecision } from '../src/lib/qualifier-score-decisions';

const rules = inheritedRules({}, 'SCORE_V2');
const normalized = qualifierPolicySchema.parse({
  normalization: 'BUILT_IN',
  multiplierPolicy: 'NONE',
  rounding: 'FLOOR',
});
describe('canonical qualifier score interpretation', () => {
  it('preserves legacy explicit decisions from audit evidence without inferring arbitrary reasons', () => {
    const score = {
      id: 'score',
      gameId: '1:2',
      raw: 100,
      eligible: false,
      eligibilityReason: 'Reviewed exclusion',
      eligibilityOverride: null,
    };
    expect(qualifierScoreDecision(score, [])).toBeNull();
    const event = { kind: 'qualifier.scores.resolve', version: 2, data: { after: [score] } };
    expect(qualifierScoreDecision(score, [event])).toBe('EXCLUDE');
    expect(qualifierScoreDecision({ ...score, raw: 200 }, [event])).toBeNull();
    expect(
      qualifierScoreDecision(score, [
        event,
        { kind: 'qualifier.scores.correct', version: 3, data: { after: [score] } },
      ]),
    ).toBeNull();
  });
  it.each([
    [['NF', 'HD'], 106000],
    [['NF', 'HR'], 110000],
    [['NF', 'HD', 'HR'], 116600],
    [['NF', 'EZ'], 50000],
    [['NF', 'DT'], 120000],
    [['NF', 'DT', 'NC'], 120000],
  ])('removes the configured built-in bonus once for %j', (mods, raw) => {
    expect(qualifierEffectiveScore(rules, normalized, raw, mods, 'FM1')).toBe(100000);
  });
  it('keeps historical reported conversion and explicit tournament multipliers independent', () => {
    expect(
      qualifierEffectiveScore(rules, qualifierPolicySchema.parse({}), 100, ['EZ'], 'FM1'),
    ).toBe(200);
    expect(
      qualifierEffectiveScore(
        rules,
        { ...normalized, multiplierPolicy: 'RULES' },
        50000,
        ['EZ'],
        'FM1',
      ),
    ).toBe(200000);
    expect(
      qualifierEffectiveScore(rules, { ...normalized, rounding: 'NONE' }, 106001, ['HD'], 'FM1'),
    ).toBeCloseTo(100000.943396, 5);
  });
  it('uses ScoreV1 native HR, DT and NF multipliers instead of ScoreV2 values', () => {
    const v1 = inheritedRules({}, 'SCORE_V1');
    expect(qualifierEffectiveScore(v1, normalized, 53000, ['NF', 'HR'], 'HR1')).toBe(100000);
    expect(qualifierEffectiveScore(v1, normalized, 56000, ['NF', 'NC', 'DT'], 'DT1')).toBe(100000);
  });
  it('applies per-player flooring before team aggregation in the reference Freemod cases', () => {
    const value = (raw: number, mods: string[]) =>
      qualifierEffectiveScore(rules, normalized, raw, mods, 'FM1');
    expect(value(186449, ['HR']) + value(316363, ['HD'])).toBe(467954);
    expect(value(32912, ['HD']) + value(149499, ['HD', 'HR'])).toBe(159264);
    expect(
      qualifierTeamModViolation(rules, 'FM', [{ mods: ['HD', 'HR'] }, { mods: ['HD', 'HR'] }]),
    ).toBe('Team does not meet the FreeMod requirements.');
  });
  it('distinguishes an observed invalid score from an unplayed map and a counted total', () => {
    const session = {
      rules,
      policy: qualifierPolicySchema.parse({ requiredPlayers: 2 }),
      poolRevision: { slots: [{ name: 'FM1', category: 'FM' }] },
      participants: [
        { id: 'team', name: 'Synthetic entrant', members: [{ osuId: 1 }, { osuId: 2 }] },
      ],
      scores: [
        {
          id: 'a',
          osuId: 1,
          run: 1,
          slotName: 'FM1',
          raw: 0,
          adjusted: 0,
          mods: ['NF', 'HD'],
          eligible: false,
          verified: true,
        },
        {
          id: 'b',
          osuId: 2,
          run: 1,
          slotName: 'FM1',
          raw: 20,
          adjusted: 20,
          mods: ['NF', 'HR'],
          eligible: true,
          verified: true,
        },
      ],
    } as unknown as QualifierView;
    expect(qualifierProgress(session)[0].teams[0]).toMatchObject({
      complete: true,
      valid: false,
      value: null,
    });
    expect(qualifierCompletion(session).complete).toBe(true);
    expect(qualifierCompletion({ ...session, scores: session.scores.slice(0, 1) }).complete).toBe(
      false,
    );
  });
  it('does not invent a pass status or a compatible scoring system', () => {
    expect(qualifierIndividualViolation(rules, {}, 'NM', { mods: ['NF', 'AP'] })).toContain(
      'Unsupported mods',
    );
    expect(
      qualifierIndividualViolation(rules, {}, 'NM', { mods: ['NF'], actualMode: 'mania' }),
    ).toContain('Gameplay mode');
    expect(
      qualifierIndividualViolation(rules, { countFailed: false }, 'NM', {
        mods: ['NF'],
        passed: false,
      }),
    ).toContain('Failed');
    expect(
      qualifierIndividualViolation(rules, { countFailed: false }, 'NM', { mods: ['NF'] }),
    ).toContain('unavailable');
    expect(
      qualifierIndividualViolation(rules, { countFailed: true }, 'NM', {
        mods: ['NF'],
        passed: false,
      }),
    ).toBeNull();
    expect(
      qualifierIndividualViolation(rules, {}, 'NM', { mods: ['NF'], actualScoring: 'SCORE_V1' }),
    ).toContain('scoring differs');
  });
});

describe('qualifier metric evidence', () => {
  const accuracy = qualifierPolicySchema.parse({
    metric: 'ACCURACY',
    teamAggregation: 'AVERAGE',
    normalization: 'REPORTED',
    multiplierPolicy: 'RULES',
    rounding: 'ROUND',
  });
  it('reports accuracy directly, ignoring multipliers and rounding', () => {
    expect(
      qualifierEffectiveScore(rules, accuracy, 1000, ['NF', 'EZ'], 'NM1', { accuracy: 98.7643 }),
    ).toBe(98.7643);
  });
  it('excludes a score whose metric evidence is missing rather than scoring it zero', () => {
    expect(qualifierEffectiveScore(rules, accuracy, 1000, ['NF'], 'NM1')).toBe(0);
    expect(qualifierIndividualViolation(rules, accuracy, 'NM', { mods: ['NF'] })).toContain(
      'Accuracy evidence is unavailable',
    );
    expect(
      qualifierIndividualViolation(rules, accuracy, 'NM', { mods: ['NF'], accuracy: 90 }),
    ).toBeNull();
  });
  it('accepts Relax in a tournament that requires it', () => {
    const relax = matchRulesSchema.parse({ requiredMods: ['RX'], enforceNoFail: false });
    expect(
      qualifierIndividualViolation(relax, {}, 'NM', { mods: ['RX'], actualScoring: undefined }),
    ).toBeNull();
    expect(qualifierIndividualViolation(rules, {}, 'NM', { mods: ['NF', 'RX'] })).toContain(
      'differ from',
    );
  });
});
