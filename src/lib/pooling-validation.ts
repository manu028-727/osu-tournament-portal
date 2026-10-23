import { z } from 'zod';

const id = z.string().min(1).max(100);
const selection = z
  .array(id)
  .max(30)
  .refine((ids) => new Set(ids).size === ids.length, 'Duplicate selection.');
export const poolPlanFields = {
  slots: z
    .array(
      z.object({
        name: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9_-]{1,20}$/),
        category: z
          .string()
          .trim()
          .regex(/^[A-Z0-9]{1,10}$/),
      }),
    )
    .max(100),
  minStars: z.number().min(0).max(30).nullable(),
  maxStars: z.number().min(0).max(30).nullable(),
  baseVersion: z.number().int().positive().nullable(),
};
export const poolPlanSchema = z
  .object(poolPlanFields)
  .refine(
    (plan) => plan.minStars == null || plan.maxStars == null || plan.minStars <= plan.maxStars,
    'Minimum star target must not exceed the maximum.',
  );
const tags = { primaryTagIds: selection.optional(), secondaryTagIds: selection.optional() };
export const poolingActionOptions = [
  z.object({
    type: z.literal('pooling.pools.release'),
    operation: z.enum(['PUBLISH', 'UNPUBLISH']),
    pools: z
      .array(
        z.object({
          id,
          draftRevisionId: id.nullable(),
          publishedRevisionId: id.nullable(),
          state: z.enum(['DRAFT', 'PUBLISHED', 'UNPUBLISHED']),
        }),
      )
      .min(1)
      .max(100)
      .refine(
        (pools) => new Set(pools.map((pool) => pool.id)).size === pools.length,
        'Duplicate pools.',
      ),
  }),
  z.object({
    type: z.literal('pooling.pool.transfer'),
    sourcePoolId: id,
    sourceRevisionId: id,
    targetStageId: id,
    targetBaseRevisionId: id.nullable(),
    slotNames: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{1,20}$/))
      .min(1)
      .max(100)
      .refine((names) => new Set(names).size === names.length),
    mode: z.enum(['COPY', 'MOVE']),
    replace: z.boolean().default(false),
  }),
  z.object({ type: z.literal('pooling.plan.save'), stageId: id, ...poolPlanFields }),
  z.object({
    type: z.literal('pooling.plan.review'),
    stageId: id,
    baseVersion: z.number().int().positive(),
    state: z.enum(['DRAFT', 'REVIEW', 'APPROVED']),
  }),
  z.object({
    type: z.literal('pooling.suggest'),
    beatmapIds: z
      .array(z.number().int().positive().max(2147483647))
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, 'Duplicate beatmaps.'),
    stageId: id.nullable(),
    category: z.string().regex(/^[A-Z0-9]{1,10}$/),
    notes: z.string().max(4000),
    ...tags,
  }),
  z.object({
    type: z.literal('pooling.bulk'),
    candidates: z
      .array(z.object({ id, baseVersion: z.number().int().positive() }))
      .min(1)
      .max(100)
      .refine(
        (rows) => new Set(rows.map((r) => r.id)).size === rows.length,
        'Duplicate candidates.',
      ),
    patch: z
      .object({
        stageId: id.nullable().optional(),
        category: z
          .string()
          .regex(/^[A-Z0-9]{1,10}$/)
          .optional(),
        status: z.enum(['SUGGESTED', 'REVIEW', 'PLAYTESTING', 'ACCEPTED', 'REJECTED']).optional(),
        notes: z.string().max(4000).optional(),
        reviewerIds: selection.optional(),
        ...tags,
      })
      .refine(
        (patch) => Object.values(patch).some((value) => value !== undefined),
        'Choose a change.',
      ),
  }),
  z.object({
    type: z.literal('pooling.review.save'),
    candidateId: id,
    baseVersion: z.number().int().positive().nullable(),
    fit: z.number().int().min(1).max(5),
    difficulty: z.number().int().min(1).max(5),
    flags: z.string().max(1000),
    notes: z.string().max(4000),
  }),
  z.object({
    type: z.literal('pooling.select'),
    candidateId: id,
    baseVersion: z.number().int().positive(),
    stageId: id,
    slotName: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,20}$/),
    baseRevisionId: id.nullable(),
    replace: z.boolean().default(false),
    warningResolution: z.string().trim().max(2000).default(''),
  }),
  z.object({
    type: z.literal('pooling.skillset.save'),
    id: id.optional(),
    name: z.string().trim().min(1).max(80),
    group: z.string().trim().max(80),
  }),
  z.object({ type: z.literal('pooling.skillset.delete'), id }),
  z.object({
    type: z.literal('pooling.warning.save'),
    id: id.optional(),
    artist: z.string().trim().min(1).max(200),
    severity: z.enum(['WARN', 'BANNED']),
    reason: z.string().trim().min(1).max(2000),
    source: z
      .string()
      .max(2048)
      .refine((value) => !value || /^https?:\/\//.test(value), 'Use an HTTP(S) link.'),
  }),
  z.object({ type: z.literal('pooling.warning.delete'), id }),
] as const;
export const poolingActionSchema = z.discriminatedUnion('type', poolingActionOptions);
export type PoolingAction = z.infer<typeof poolingActionSchema>;
export type PoolPlanInput = z.infer<typeof poolPlanSchema>;
