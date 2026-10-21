import { z } from 'zod';
import { qualifierPolicySchema } from './qualifier-policy';

export const qualifierStandingsRevision = {
  stageId: z.string().min(1),
  baseVersion: z.number().int().min(0),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
};
export const qualifierStandingsActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('qualifier.policy.save'),
    ...qualifierStandingsRevision,
    policy: qualifierPolicySchema,
  }),
  z.object({ type: z.literal('qualifier.standings.calculate'), ...qualifierStandingsRevision }),
  z.object({
    type: z.literal('qualifier.standings.resolve'),
    ...qualifierStandingsRevision,
    tieOrder: z.array(z.string().min(1)),
    reason: z.string().trim().min(3).max(2000),
  }),
  z.object({
    type: z.literal('qualifier.standings.finalize'),
    ...qualifierStandingsRevision,
    tieOrder: z.array(z.string().min(1)).default([]),
    reason: z.string().trim().max(2000).default(''),
    cutoff: z.number().int().min(1).nullable().optional(),
  }),
  z.object({
    type: z.literal('qualifier.standings.publish'),
    ...qualifierStandingsRevision,
    published: z.boolean(),
  }),
  z.object({
    type: z.literal('qualifier.standings.reopen'),
    ...qualifierStandingsRevision,
    reason: z.string().trim().min(3).max(2000),
    affectedBracketIds: z.array(z.string().min(1)).max(1000),
    impactHash: z.string().regex(/^[a-f0-9]{64}$/),
    acknowledgeImpact: z.literal(true),
  }),
]);
export type QualifierStandingsAction = z.infer<typeof qualifierStandingsActionSchema>;
