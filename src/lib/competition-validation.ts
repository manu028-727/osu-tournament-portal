import { z } from 'zod';

const id = z.string().min(1).max(100);
const base = { id, baseVersion: z.number().int().positive() };
const lifecycle = {
  ...base,
  reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
  approveCorrections: z.boolean().default(false),
};
export const competitionCreateFields = {
  name: z.string().trim().min(1).max(100),
  format: z.enum(['SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'GROUPS']),
  stageId: id,
  teamIds: z.array(id).min(2).max(128),
  generationKey: id,
  thirdPlace: z.boolean().default(false),
  grandFinalReset: z.boolean().default(true),
  groupCount: z.number().int().min(1).max(32).default(1),
  advancePerGroup: z.number().int().min(1).max(32).default(2),
  sourceStandingId: id.optional(),
  sourceBracketId: id.optional(),
  roundStages: z.record(z.string(), id).default({}),
  manualMatches: z.boolean().default(false),
};
export const competitionActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('competition.create'), ...competitionCreateFields }),
  z.object({ type: z.literal('competition.preview'), ...competitionCreateFields }),
  z.object({
    type: z.literal('competition.lifecycle.preview'),
    ...base,
    operation: z.enum(['delete', 'regenerate', 'missing']),
    nodeId: id.optional(),
  }),
  z.object({
    type: z.literal('competition.delete'),
    ...lifecycle,
    confirmation: z.string().max(100),
    acknowledgeHistory: z.boolean().default(false),
  }),
  z.object({ type: z.literal('competition.regenerate'), ...lifecycle, nodeId: id }),
  z.object({ type: z.literal('competition.regenerate-missing'), ...lifecycle }),
  z.object({ type: z.literal('competition.publish'), ...base, published: z.boolean() }),
  z.object({
    type: z.literal('competition.rounds.stage'),
    ...base,
    roundIds: z
      .array(id)
      .min(1)
      .max(128)
      .refine((ids) => new Set(ids).size === ids.length),
    stageId: id,
  }),
  z.object({
    type: z.literal('competition.link-match'),
    ...base,
    nodeId: id,
    matchId: id,
    matchVersion: z.number().int().positive(),
    reverseSides: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('competition.sync'),
    ...base,
    approveCorrections: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('competition.slot'),
    ...base,
    nodeId: id,
    side: z.enum(['A', 'B']),
    teamId: id.nullable(),
    mode: z.enum(['MANUAL', 'LOCKED', 'AUTO']),
    allowIneligible: z.boolean().default(false),
    reason: z.string().trim().max(1000).default(''),
  }),
  z.object({
    type: z.literal('competition.route'),
    ...base,
    nodeId: id,
    side: z.enum(['A', 'B']),
    sourceNodeId: id.nullable(),
    outcome: z.enum(['WINNER', 'LOSER']).nullable(),
  }),
  z.object({
    type: z.literal('competition.group.resolve'),
    ...base,
    tieOrder: z.array(id).min(2).max(128),
    reason: z.string().trim().min(3).max(1000),
  }),
  z.object({
    type: z.literal('competition.entry'),
    ...base,
    teamId: id,
    status: z.enum(['ACTIVE', 'WITHDRAWN', 'DISQUALIFIED']),
    reason: z.string().trim().min(3).max(1000),
  }),
]);
export type CompetitionAction = z.infer<typeof competitionActionSchema>;
export type CompetitionCreate = Extract<CompetitionAction, { type: 'competition.create' }>;
