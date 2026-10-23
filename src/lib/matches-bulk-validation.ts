import { z } from 'zod';

const id = z.string().min(1).max(100);
const staffName = z.string().trim().max(120);
export const matchesBulkScheduleSchema = z
  .object({
    type: z.literal('matches.bulk.schedule'),
    matches: z
      .array(z.object({ id, baseVersion: z.number().int().positive() }))
      .min(1)
      .max(100)
      .refine(
        (rows) => new Set(rows.map((row) => row.id)).size === rows.length,
        'Select each match only once.',
      ),
    scheduledAt: z.iso.datetime().nullable().optional(),
    shiftMinutes: z
      .number()
      .int()
      .min(-10080)
      .max(10080)
      .refine((minutes) => minutes !== 0, 'Enter a nonzero time shift.')
      .optional(),
    refereeIds: z
      .array(id)
      .max(10)
      .refine((ids) => new Set(ids).size === ids.length, 'Select each referee only once.')
      .optional(),
    stageId: id.optional(),
    streamer: staffName.optional(),
    commentators: z
      .array(staffName.min(1))
      .max(4)
      .refine((names) => new Set(names).size === names.length, 'Enter each commentator only once.')
      .optional(),
    notes: z.string().max(4000).optional(),
    published: z.boolean().optional(),
  })
  .superRefine((action, ctx) => {
    if (action.scheduledAt !== undefined && action.shiftMinutes !== undefined)
      ctx.addIssue({ code: 'custom', message: 'Choose a start time or a time shift, not both.' });
    if (
      ![
        'scheduledAt',
        'shiftMinutes',
        'refereeIds',
        'stageId',
        'streamer',
        'commentators',
        'notes',
        'published',
      ].some((key) => action[key as keyof typeof action] !== undefined)
    )
      ctx.addIssue({ code: 'custom', message: 'Choose at least one field to update.' });
  });

export type MatchesBulkScheduleAction = z.infer<typeof matchesBulkScheduleSchema>;

const batchRow = z
  .object({
    id,
    baseVersion: z.number().int().positive(),
    scheduledAt: z.iso.datetime().nullable().optional(),
    refereeIds: z
      .array(id)
      .max(10)
      .refine((ids) => new Set(ids).size === ids.length, 'Select each referee only once.')
      .optional(),
  })
  .refine(
    (row) => row.scheduledAt !== undefined || row.refereeIds !== undefined,
    'Each row needs a time or referee change.',
  );
export const matchesBatchScheduleSchema = z.object({
  type: z.literal('matches.batch.schedule'),
  matches: z
    .array(batchRow)
    .min(1)
    .max(100)
    .refine(
      (rows) => new Set(rows.map((row) => row.id)).size === rows.length,
      'Select each match only once.',
    ),
});
export const matchesSchedulingActionOptions = [
  matchesBulkScheduleSchema,
  matchesBatchScheduleSchema,
] as const;
export const matchesSchedulingActionSchema = z.discriminatedUnion(
  'type',
  matchesSchedulingActionOptions,
);
export type MatchesBatchScheduleAction = z.infer<typeof matchesBatchScheduleSchema>;
export type MatchesSchedulingAction = z.infer<typeof matchesSchedulingActionSchema>;
