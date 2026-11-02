import { z } from 'zod';
import { MODS } from './match-rules';
const id = z.string().min(1).max(100);
const ids = z
  .array(id)
  .max(16)
  .refine((v) => new Set(v).size === v.length, 'Duplicate selection.');
const notes = z.string().max(4000).default('');
const base = z.object({ id, baseVersion: z.number().int().positive() });
const createFields = z.object({
  capacity: z.number().int().min(1).max(16).optional(),
  bookingOpen: z.boolean().optional(),
  bookingClosesAt: z.iso.datetime().nullable().optional(),
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,79}$/),
  stageId: id,
  teamIds: ids,
  refereeIds: ids,
  scheduledAt: z.iso.datetime().nullable(),
  notes,
});
const selectedLobbies = z
  .array(base)
  .min(1)
  .max(100)
  .refine(
    (rows) => new Set(rows.map((row) => row.id)).size === rows.length,
    'Select each lobby only once.',
  );
export const qualifierActionOptions = [
  z.object({
    type: z.literal('qualifier.delete'),
    lobbies: selectedLobbies,
    reason: z.string().trim().min(3).max(2000),
    confirm: z.literal(true),
  }),
  base.extend({
    type: z.literal('qualifier.edit'),
    code: createFields.shape.code,
    notes,
  }),
  base.extend({
    type: z.literal('qualifier.scores.resolve'),
    scoreIds: z.array(id).min(1).max(4096),
    eligible: z.boolean(),
    reason: z.string().trim().min(3).max(2000),
  }),
  base.extend({
    type: z.literal('qualifier.map'),
    slotName: z.string().min(1).max(20),
    run: z.number().int().min(1).max(2),
    warmup: z.boolean().default(false),
    reason: z.string().trim().max(2000).default('Referee map selection'),
  }),
  base.extend({
    type: z.literal('qualifier.scores'),
    slotName: z.string().min(1).max(20),
    run: z.number().int().min(1).max(2),
    representation: z.enum(['LEGACY', 'STANDARDIZED']).default('LEGACY'),
    scores: z
      .array(
        z.object({
          osuId: z.number().int().positive().max(2147483647),
          raw: z.number().min(0).max(1_000_000_000_000),
          passed: z.boolean().nullable().optional(),
          mods: z.array(z.enum(MODS)).max(10),
        }),
      )
      .min(1)
      .max(16)
      .refine(
        (scores) => new Set(scores.map((score) => score.osuId)).size === scores.length,
        'Duplicate player scores.',
      ),
    reason: z.string().trim().min(3).max(2000).default('Record shared qualifier map scores'),
  }),
  base.extend({
    type: z.literal('qualifier.booking'),
    capacity: z.number().int().min(1).max(16),
    bookingOpen: z.boolean(),
    bookingClosesAt: z.iso.datetime().nullable(),
  }),
  base.extend({
    type: z.literal('qualifier.participants.remove'),
    teamIds: ids.min(1),
    override: z.boolean().default(false),
    reason: z.string().trim().min(3).max(2000),
  }),
  createFields.extend({
    type: z.literal('qualifier.create'),
  }),
  z.object({
    type: z.literal('qualifier.batch.create'),
    sessions: z
      .array(createFields)
      .min(1)
      .max(50)
      .refine(
        (rows) => new Set(rows.map((row) => row.code)).size === rows.length,
        'Each new lobby needs a unique code.',
      ),
  }),
  z
    .object({
      type: z.literal('qualifier.bulk.schedule'),
      lobbies: selectedLobbies,
      scheduledAt: z.iso.datetime().nullable().optional(),
      shiftMinutes: z
        .number()
        .int()
        .min(-525600)
        .max(525600)
        .refine((v) => v !== 0)
        .optional(),
      refereeIds: ids.optional(),
      notes: z.string().max(4000).optional(),
    })
    .superRefine((action, ctx) => {
      if (action.scheduledAt !== undefined && action.shiftMinutes !== undefined)
        ctx.addIssue({ code: 'custom', message: 'Choose a start time or a time shift, not both.' });
      if (
        action.scheduledAt === undefined &&
        action.shiftMinutes === undefined &&
        action.refereeIds === undefined &&
        action.notes === undefined
      )
        ctx.addIssue({ code: 'custom', message: 'Choose at least one field to update.' });
    }),
  z
    .object({
      type: z.literal('qualifier.participants.move'),
      fromLobbyId: id.nullable(),
      sourceVersion: z.number().int().positive().optional(),
      toLobbyId: id,
      baseVersion: z.number().int().positive(),
      teamIds: ids.min(1),
      override: z.boolean().optional(),
      reason: z.string().trim().max(2000).optional(),
    })
    .superRefine((action, ctx) => {
      if (action.fromLobbyId === action.toLobbyId)
        ctx.addIssue({ code: 'custom', message: 'Choose a different destination lobby.' });
      if (action.fromLobbyId && action.sourceVersion === undefined)
        ctx.addIssue({ code: 'custom', message: 'The source lobby version is required.' });
    }),
  base.extend({
    type: z.literal('qualifier.schedule'),
    scheduledAt: z.iso.datetime().nullable(),
    refereeIds: ids,
    notes,
  }),
  base.extend({ type: z.literal('qualifier.lobby'), lobbyUrl: z.string().max(300) }),
  base.extend({
    type: z.literal('qualifier.score'),
    run: z.number().int().min(1).max(2).default(1),
    representation: z.enum(['LEGACY', 'STANDARDIZED']).default('LEGACY'),
    osuId: z.number().int().positive().max(2147483647),
    slotName: z.string().min(1).max(20),
    raw: z.number().min(0).max(1_000_000_000_000),
    passed: z.boolean().nullable().optional(),
    mods: z
      .array(z.enum(MODS))
      .max(10)
      .refine((v) => new Set(v).size === v.length, 'Duplicate mods.'),
    reason: z.string().trim().min(3).max(2000),
  }),
  base.extend({
    type: z.literal('qualifier.score.remove'),
    scoreId: id,
    reason: z.string().trim().min(3).max(2000),
  }),
  base.extend({
    type: z.literal('qualifier.status'),
    command: z.enum(['START', 'SUBMIT', 'CONFIRM', 'REOPEN', 'CANCEL']),
    reason: z.string().trim().min(3).max(2000),
  }),
] as const;
export const qualifierActionSchema = z.discriminatedUnion('type', qualifierActionOptions);
export type QualifierAction = z.infer<typeof qualifierActionSchema>;
