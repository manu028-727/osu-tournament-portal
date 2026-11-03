import { z } from 'zod';
import { matchRulesSchema, MODS, SIDES } from './match-rules';
import { organizerResultOptions } from './match-results-contract';
const id = z.string().min(1).max(100);
const version = z.number().int().positive();
const side = z.enum(SIDES);
const notes = z.string().max(4000).default('');
const reason = z.string().trim().min(3).max(2000);
const base = z.object({ id, baseVersion: version });
const refs = z
  .array(id)
  .max(10)
  .refine(
    (values) => new Set(values).size === values.length,
    'A referee can be assigned only once.',
  );
const score = z.number().min(0).max(1_000_000_000_000);
export const playerScoreSchema = z.object({
  osuId: z.number().int().positive().max(2147483647),
  side,
  score,
  accuracy: z.number().min(0).max(100).nullable().optional(),
  maxCombo: z.number().int().min(0).max(2147483647).nullable().optional(),
  misses: z.number().int().min(0).max(2147483647).nullable().optional(),
  mods: z
    .array(z.enum(MODS))
    .max(10)
    .refine((mods) => new Set(mods).size === mods.length, 'Duplicate mods.'),
});
export const matchActionOptions = [
  ...organizerResultOptions,
  z.object({
    type: z.literal('match.create'),
    bracketId: id.optional(),
    allowIneligible: z.boolean().optional(),
    overrideReason: z.string().trim().max(2000).optional(),
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,79}$/),
    stageId: id,
    teamAId: id,
    teamBId: id,
    scheduledAt: z.iso.datetime().nullable().default(null),
    refereeIds: refs,
    bestOf: z
      .number()
      .int()
      .min(1)
      .max(31)
      .refine((n) => n % 2 === 1)
      .optional(),
    notes,
    published: z.boolean().default(false),
  }),
  base.extend({
    type: z.literal('match.schedule'),
    scheduledAt: z.iso.datetime().nullable(),
    refereeIds: refs,
    notes,
    published: z.boolean().optional(),
    teamAId: id.optional(),
    teamBId: id.optional(),
    bestOf: z
      .number()
      .int()
      .min(1)
      .max(31)
      .refine((n) => n % 2 === 1)
      .optional(),
  }),
  z.object({
    type: z.literal('match.rules.save'),
    stageId: id.nullable(),
    rules: matchRulesSchema.nullable(),
    baseHash: z.string().length(64),
  }),
  base.extend({ type: z.literal('match.start') }),
  base.extend({ type: z.literal('match.resolve'), side, dependencyVersion: version, reason }),
  base.extend({ type: z.literal('match.visibility'), published: z.boolean() }),
  base.extend({
    type: z.literal('match.roll'),
    rollA: z.number().int().min(1).max(100),
    rollB: z.number().int().min(1).max(100),
    firstPickSide: side,
    firstBanSide: side,
    firstProtectSide: side.optional(),
  }),
  base.extend({
    type: z.literal('match.draft'),
    kind: z.enum(['PROTECT', 'BAN', 'PICK']),
    side,
    slotName: z.string().min(1).max(20),
  }),
  base.extend({ type: z.literal('match.undo'), reason }),
  base.extend({ type: z.literal('match.winner'), actionId: id, winnerSide: side, notes, reason }),
  base.extend({ type: z.literal('match.import'), proposalId: id, reason }),
  base.extend({
    type: z.literal('match.score'),
    representation: z.enum(['LEGACY', 'STANDARDIZED']).default('LEGACY'),
    actionId: id,
    scoreA: score,
    scoreB: score,
    players: z.array(playerScoreSchema).max(16).default([]),
    notes,
    reason,
  }),
  base.extend({
    type: z.literal('match.timer'),
    command: z.enum(['START', 'PAUSE', 'RESET']),
    kind: z.enum(['PICK', 'BAN', 'READY', 'TIMEOUT']),
  }),
  base.extend({
    type: z.literal('match.incident'),
    kind: z.enum(['TIMEOUT', 'DISCONNECT', 'DELAY', 'WARMUP']),
    side: side.nullable(),
    notes: z.string().trim().min(3).max(4000),
  }),
  base.extend({
    type: z.literal('match.lobby'),
    lobbyUrl: z.string().max(300).default(''),
    multiplayerId: z.number().int().positive().max(2147483647).nullable().default(null),
  }),
  base.extend({ type: z.literal('match.submit'), notes }),
  base.extend({ type: z.literal('match.forfeit'), winnerSide: side, reason }),
  base.extend({
    type: z.literal('match.summary'),
    scoreA: z.number().int().min(0).max(16),
    scoreB: z.number().int().min(0).max(16),
    forfeitSide: side.nullable(),
    reason,
  }),
  base.extend({ type: z.literal('match.confirm'), reason }),
  base.extend({
    type: z.literal('match.reopen'),
    reason,
    approveProgression: z.boolean().optional(),
    correctionHash: z.string().length(64).optional(),
  }),
  base.extend({
    type: z.literal('match.dispute'),
    reason,
    approveProgression: z.boolean().optional(),
    correctionHash: z.string().length(64).optional(),
  }),
  base.extend({
    type: z.literal('match.cancel'),
    reason,
    approveProgression: z.boolean().optional(),
    correctionHash: z.string().length(64).optional(),
  }),
  base.extend({
    type: z.literal('match.delete'),
    reason,
    confirmCode: z.string().min(1).max(80),
    approveProgression: z.boolean().default(false),
    correctionHash: z.string().length(64).optional(),
  }),
  base.extend({
    type: z.literal('match.detected_pick'),
    proposalId: z.string().min(1).max(100),
    reason,
  }),
  base.extend({
    type: z.literal('match.multiplayer.ignore'),
    proposalId: z.string().min(1).max(100),
    reason,
  }),
  base.extend({
    type: z.literal('match.multiplayer.associate'),
    proposalId: z.string().min(1).max(100),
    actionId: z.string().min(1).max(100),
    reason,
  }),
  base.extend({
    type: z.literal('match.correct'),
    actionId: z.string().min(1).max(100),
    slotName: z.string().regex(/^[A-Z0-9_-]{1,20}$/),
    reason,
    discardFollowing: z.boolean().default(false),
  }),
] as const;
export const matchActionSchema = z.discriminatedUnion('type', matchActionOptions);
export type MatchAction = z.infer<typeof matchActionSchema>;
