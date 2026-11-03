import { z } from 'zod';

export const qualifierPolicySchema = z
  .strictObject({
    method: z
      .enum([
        'RAW_SCORE',
        'Z_SUM',
        'TEAM_AVERAGE',
        'MATCH_COST',
        'PERCENT_MAX',
        'AVERAGE_PLACEMENT',
      ])
      .default('RAW_SCORE'),
    // Optional, with no default: a defaulted field would enter every saved source hash.
    metric: z.enum(['SCORE', 'ACCURACY', 'COMBO']).optional(),
    runs: z.union([z.literal(1), z.literal(2)]).default(1),
    runSelection: z
      .enum(['BEST_PER_MAP', 'BEST_COMPLETE_RUN', 'FIRST_RUN', 'SECOND_RUN'])
      .default('BEST_PER_MAP'),
    requiredPlayers: z.number().int().min(1).max(16).default(1),
    teamAggregation: z.enum(['SUM', 'AVERAGE', 'TOP_N']).default('SUM'),
    rawAggregation: z.enum(['TOTAL', 'AVERAGE']).default('TOTAL'),
    normalization: z.enum(['REPORTED', 'BUILT_IN']).optional(),
    multiplierPolicy: z.enum(['RULES', 'NONE']).optional(),
    rounding: z.enum(['NONE', 'FLOOR', 'ROUND']).optional(),
    countFailed: z.boolean().optional(),
  })
  .superRefine((policy, ctx) => {
    if (policy.metric === 'ACCURACY' && policy.teamAggregation !== 'AVERAGE')
      ctx.addIssue({
        code: 'custom',
        path: ['teamAggregation'],
        message: 'Team accuracy is an average.',
      });
    if (policy.runs === 1 && policy.runSelection === 'SECOND_RUN')
      ctx.addIssue({
        code: 'custom',
        path: ['runSelection'],
        message: 'Run 2 requires two playthroughs.',
      });
  });

export type QualifierPolicy = z.infer<typeof qualifierPolicySchema>;
export const DEFAULT_QUALIFIER_POLICY: QualifierPolicy = qualifierPolicySchema.parse({});
export const QUALIFIER_METHOD_LABELS: Record<QualifierPolicy['method'], string> = {
  RAW_SCORE: 'Raw score',
  Z_SUM: 'Z-Sum',
  TEAM_AVERAGE: 'Team average',
  MATCH_COST: 'Match cost (osu!plus qualifier adaptation)',
  PERCENT_MAX: 'Percent of map maximum (%MAX)',
  AVERAGE_PLACEMENT: 'Average map placement',
};
export const QUALIFIER_METRIC_LABELS: Record<NonNullable<QualifierPolicy['metric']>, string> = {
  SCORE: 'Score',
  ACCURACY: 'Accuracy',
  COMBO: 'Combo',
};

export function qualifierTeamAggregate<T extends { osuId: number; adjusted: number }>(
  scores: readonly T[],
  policy: QualifierPolicy,
) {
  if (
    scores.length < policy.requiredPlayers ||
    (policy.teamAggregation !== 'TOP_N' && scores.length !== policy.requiredPlayers)
  )
    return null;
  const chosen = [...scores]
    .sort((a, b) => b.adjusted - a.adjusted || a.osuId - b.osuId)
    .slice(0, policy.requiredPlayers);
  const total = chosen.reduce((value, score) => value + score.adjusted, 0);
  return {
    chosen,
    total,
    value: policy.teamAggregation === 'AVERAGE' ? total / chosen.length : total,
  };
}
