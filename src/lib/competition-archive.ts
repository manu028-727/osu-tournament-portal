import { z } from 'zod';
import { AppError } from './permissions';
import { competitionActionSchema } from './competition-validation';

const key = z.string().min(1).max(100);
export const competitionGroupSourceSchema = z.object({
  bracketId: key,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  seeds: z
    .array(z.object({ teamId: key, seed: z.number().int().positive() }))
    .min(1)
    .max(128),
});
export const competitionStoredConfigSchema = competitionActionSchema.options[0]
  .extend({
    // A format's bracket exists before its entrants, so saved seeds may be empty.
    teamIds: z.array(key).max(128),
    phaseKey: key.optional(),
    phaseRanking: z
      .object({
        tiebreakers: z.array(z.string()),
        forfeitMapDifference: z.enum(['COUNT', 'IGNORE']),
      })
      .optional(),
    phaseAdvancing: z.record(z.string(), z.array(z.number().int())).optional(),
    sourceStandingIds: z.array(key).optional(),
    sourceBracketIds: z.array(key).optional(),
    groupTieOrder: z.array(key).max(128).optional(),
    groupTieReason: z.string().trim().min(3).max(1000).optional(),
    groupTieSourceHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    groupSource: competitionGroupSourceSchema.optional(),
  })
  .passthrough();

// The creation request alone, for comparing a bracket's identity across an archive.
export const competitionCreationSchema = competitionActionSchema.options[0].extend({
  teamIds: z.array(key).max(128),
});

function mapped(ids: ReadonlyMap<string, string>, id: string) {
  const target = ids.get(id);
  if (!target)
    throw new AppError('Competition archive reference {0} has no imported identity.', 400, [id]);
  return target;
}
export function remapCompetitionSeedOrder(value: unknown, ids: ReadonlyMap<string, string>) {
  return z
    .array(key)
    .max(128)
    .parse(value)
    .map((id) => mapped(ids, id));
}
// Hashes deliberately remain unchanged until validated source rows are restored and rebound.
export function remapCompetitionConfig(value: unknown, ids: ReadonlyMap<string, string>) {
  const config = competitionStoredConfigSchema.parse(value);
  return {
    ...config,
    stageId: mapped(ids, config.stageId),
    teamIds: config.teamIds.map((id) => mapped(ids, id)),
    roundStages: Object.fromEntries(
      Object.entries(config.roundStages).map(([round, stageId]) => [round, mapped(ids, stageId)]),
    ),
    ...(config.sourceStandingId ? { sourceStandingId: mapped(ids, config.sourceStandingId) } : {}),
    ...(config.sourceStandingIds
      ? { sourceStandingIds: config.sourceStandingIds.map((id) => mapped(ids, id)) }
      : {}),
    ...(config.sourceBracketIds
      ? { sourceBracketIds: config.sourceBracketIds.map((id) => mapped(ids, id)) }
      : {}),
    ...(config.sourceBracketId ? { sourceBracketId: mapped(ids, config.sourceBracketId) } : {}),
    ...(config.groupTieOrder
      ? { groupTieOrder: config.groupTieOrder.map((id) => mapped(ids, id)) }
      : {}),
    ...(config.groupSource
      ? {
          groupSource: {
            ...config.groupSource,
            bracketId: mapped(ids, config.groupSource.bracketId),
            seeds: config.groupSource.seeds.map((seed) => ({
              ...seed,
              teamId: mapped(ids, seed.teamId),
            })),
          },
        }
      : {}),
  };
}
