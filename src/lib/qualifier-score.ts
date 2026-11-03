import { MODS, type MatchRules } from './match-rules';
import type { QualifierPolicy } from './qualifier-policy';
import { convertedScore } from './score-pipeline';
import { qualifierScoreViolation } from './qualifier-eligibility';
import { AppError } from './permissions';

function nativeFraction(mods: readonly string[], gameplayScoring = 'SCORE_V2') {
  const active = new Set(mods);
  const scoreV2 = gameplayScoring === 'SCORE_V2';
  const factors = [
    active.has('HD') ? 106 : 100,
    active.has('HR') ? (scoreV2 ? 110 : 106) : 100,
    active.has('DT') || active.has('NC') ? (scoreV2 ? 120 : 112) : 100,
    active.has('EZ') ? 50 : 100,
    active.has('HT') ? 30 : 100,
    active.has('FL') ? 112 : 100,
    active.has('NF') && !scoreV2 ? 50 : 100,
  ];
  return {
    numerator: factors.reduce((n, f) => n * BigInt(f), 1n),
    denominator: 100n ** BigInt(factors.length),
  };
}

function decimalFraction(value: number) {
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
  const [integer, fraction = ''] = mantissa.split('.');
  const shift = Number(exponent) - fraction.length;
  return {
    numerator: BigInt(integer + fraction) * 10n ** BigInt(Math.max(0, shift)),
    denominator: 10n ** BigInt(Math.max(0, -shift)),
  };
}

// These are score adjustments within the reported legacy gameplay system, never
// a conversion between ScoreV1, ScoreV2 and standardized lazer scores.
export function qualifierBuiltInMultiplier(mods: readonly string[], gameplayScoring = 'SCORE_V2') {
  const value = nativeFraction(mods, gameplayScoring);
  return Number(value.numerator) / Number(value.denominator);
}

export function qualifierEffectiveScore(
  rules: MatchRules,
  policy: QualifierPolicy,
  raw: number,
  mods: readonly string[],
  slot: string,
) {
  const converted = convertedScore(rules, raw, mods, slot);
  if (
    policy.normalization === undefined &&
    policy.multiplierPolicy === undefined &&
    policy.rounding === undefined
  )
    return converted.adjusted;
  if (
    policy.normalization === 'BUILT_IN' &&
    (rules.gameMode !== 'osu' || rules.gameplayScoring === 'LAZER')
  )
    throw new AppError('Built-in mod normalization requires reported legacy osu!standard scores.');
  const scoring = rules.gameplayScoring || (rules.scoreMode === 'SCORE' ? 'SCORE_V1' : 'SCORE_V2');
  const divisor =
    policy.normalization === 'BUILT_IN' ? qualifierBuiltInMultiplier(mods, scoring) : 1;
  const multiplier = policy.multiplierPolicy === 'NONE' ? 1 : converted.multiplier;
  const effective = (raw / divisor) * multiplier;
  if (!Number.isFinite(effective) || effective < 0 || effective > Number.MAX_SAFE_INTEGER)
    throw new AppError('The configured score multiplier exceeds the supported score range.');
  if (Number.isSafeInteger(raw) && ['FLOOR', 'ROUND'].includes(policy.rounding || '')) {
    const native =
      policy.normalization === 'BUILT_IN'
        ? nativeFraction(mods, scoring)
        : { numerator: 1n, denominator: 1n };
    const custom = decimalFraction(multiplier);
    const numerator = BigInt(raw) * native.denominator * custom.numerator;
    const denominator = native.numerator * custom.denominator;
    return Number(
      policy.rounding === 'FLOOR'
        ? numerator / denominator
        : (2n * numerator + denominator) / (2n * denominator),
    );
  }
  return policy.rounding === 'FLOOR'
    ? Math.floor(effective)
    : policy.rounding === 'ROUND'
      ? Math.round(effective)
      : effective;
}

export function qualifierIndividualViolation(
  rules: MatchRules,
  policy: Pick<QualifierPolicy, 'countFailed'>,
  category: string,
  score: {
    mods: string[];
    passed?: boolean | null;
    actualScoring?: string | null;
    actualMode?: string | null;
  },
) {
  if (score.mods.some((mod) => !MODS.includes(mod as (typeof MODS)[number])))
    return 'Unsupported mods require manual review.';
  if (score.actualMode && score.actualMode !== rules.gameMode)
    return 'Gameplay mode or scoring differs from the session snapshot.';
  const expected =
    rules.gameplayScoring ||
    (rules.scoreMode === 'SCORE' ? 'SCORE_V1' : rules.scoreMode === 'SCORE_V2' ? 'SCORE_V2' : null);
  if (score.actualScoring === null)
    return 'Gameplay scoring provenance is unavailable; review this score before counting it.';
  if (score.actualScoring && score.actualScoring !== expected)
    return 'Gameplay mode or scoring differs from the session snapshot.';
  if (policy.countFailed === false && score.passed !== true)
    return score.passed === false
      ? 'Failed scores are excluded by the qualifier policy.'
      : 'Pass status is unavailable; review this score before counting it.';
  return qualifierScoreViolation(rules, category, score.mods);
}
