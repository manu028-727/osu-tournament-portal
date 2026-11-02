import { z } from 'zod';
import { qualifierPolicySchema } from './qualifier-policy';
import { MODS } from './match-rules';
const id = z.string().min(1).max(100);
export const qualifierCorrectionSchema = z
  .object({
    stageId: id,
    operation: z.enum([
      'EDIT',
      'INCLUDE',
      'EXCLUDE',
      'RESTORE',
      'REVALIDATE',
      'REMAP',
      'REPROCESS',
    ]),
    lobbies: z
      .array(
        z.object({ id, baseVersion: z.number().int().positive(), scoreIds: z.array(id).max(4096) }),
      )
      .min(1)
      .max(100),
    patch: z
      .object({
        raw: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
        mods: z.array(z.enum(MODS)).max(10).optional(),
        passed: z.boolean().nullable().optional(),
      })
      .optional(),
    destination: z
      .object({
        slotName: z.string().min(1).max(20).optional(),
        run: z.number().int().min(1).max(2).optional(),
        osuId: z.number().int().positive().max(2147483647).optional(),
      })
      .optional(),
    policy: qualifierPolicySchema.optional(),
    useStageRules: z.boolean().default(false),
    reason: z.string().trim().min(3).max(2000).default('Organizer qualifier score correction'),
    apply: z.boolean().default(false),
    reviewHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.lobbies.map((l) => l.id)).size !== value.lobbies.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate session selection.' });
    if (value.operation === 'EDIT' && (!value.patch || !Object.keys(value.patch).length))
      ctx.addIssue({ code: 'custom', message: 'Choose a score field to edit.' });
    if (
      value.operation === 'REMAP' &&
      (!value.destination || !Object.keys(value.destination).length)
    )
      ctx.addIssue({ code: 'custom', message: 'Choose a map, run or player destination.' });
    if (value.operation !== 'REPROCESS' && (value.policy || value.useStageRules))
      ctx.addIssue({
        code: 'custom',
        message: 'Use reprocess to change saved scoring configuration.',
      });
  });
export type QualifierCorrectionInput = z.infer<typeof qualifierCorrectionSchema>;
export type QualifierCorrectionReview = {
  reviewHash: string;
  changed: number;
  locked: boolean;
  rows: {
    id: string;
    name: string;
    before: number | null;
    after: number | null;
    beforeSeed: number | null;
    afterSeed: number | null;
  }[];
  issues: { code: string; severity: string; message: string }[];
  affected: {
    id: string;
    osuId: number;
    slotName: string;
    run: number;
    raw: number;
    adjusted: number;
    eligible: boolean;
    eligibilityReason: string;
  }[];
  applied?: boolean;
};
