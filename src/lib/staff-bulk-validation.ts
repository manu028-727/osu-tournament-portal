import { z } from 'zod';

const id = z.string().min(1).max(100);
const position = z.string().trim().max(100);
export const staffAssignmentPatchSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('ADD'), categoryId: id, position: position.optional() }).strict(),
  z.object({ operation: z.literal('REMOVE'), categoryId: id }).strict(),
  z.object({ operation: z.literal('LABEL'), categoryId: id, position }).strict(),
  z
    .object({
      operation: z.literal('REASSIGN'),
      categoryId: id,
      destinationCategoryId: id,
      position: position.optional(),
    })
    .strict()
    .refine(
      (patch) => patch.categoryId !== patch.destinationCategoryId,
      'Choose a different destination category, or use Change position label.',
    ),
]);
export const staffBulkActionSchema = z
  .object({
    type: z.literal('staff.bulk'),
    baseVersions: z.record(id, z.number().int().positive()),
    memberIds: z
      .array(id)
      .min(1)
      .max(200)
      .refine((ids) => new Set(ids).size === ids.length, 'Select each staff member only once.'),
    patch: z
      .object({
        visible: z.boolean().optional(),
        assignment: staffAssignmentPatchSchema.optional(),
      })
      .strict()
      .refine(
        (patch) => patch.visible !== undefined || patch.assignment !== undefined,
        'Choose at least one staff field to change.',
      ),
  })
  .strict();

export type StaffBulkAction = z.infer<typeof staffBulkActionSchema>;
export type StaffAssignmentPatch = z.infer<typeof staffAssignmentPatchSchema>;
