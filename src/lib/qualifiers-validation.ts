import { z } from 'zod';
import { MODS } from './match-rules';
const id = z.string().min(1).max(100);
const ids = z
  .array(id)
  .max(16)
  .refine((v) => new Set(v).size === v.length, 'Duplicate selection.');
const notes = z.string().max(4000).default('');
const base = z.object({ id, baseVersion: z.number().int().positive() });
export const qualifierActionOptions = [
  z.object({
    type: z.literal('qualifier.create'),
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,79}$/),
    stageId: id,
    teamIds: ids.min(1),
    refereeIds: ids,
    scheduledAt: z.iso.datetime().nullable(),
    notes,
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
