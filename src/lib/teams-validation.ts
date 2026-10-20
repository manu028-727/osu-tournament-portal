import { z } from 'zod';
export const rosterSchema = z
  .array(
    z.object({
      osuId: z.number().int().positive().max(2147483647),
      captain: z.boolean(),
      substitute: z.boolean(),
      discordId: z
        .string()
        .regex(/^(?:\d{17,20})?$/, 'Use a Discord user ID, not a username.')
        .optional(),
    }),
  )
  .min(1)
  .max(32)
  .superRefine((members, ctx) => {
    if (new Set(members.map((m) => m.osuId)).size !== members.length)
      ctx.addIssue({ code: 'custom', message: 'A player can appear only once in a roster.' });
    if (members.filter((m) => m.captain).length !== 1)
      ctx.addIssue({ code: 'custom', message: 'Select exactly one captain.' });
    if (members.some((m) => m.captain && m.substitute))
      ctx.addIssue({ code: 'custom', message: 'The captain cannot be a substitute.' });
  });
export const teamFields = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80),
  description: z.string().max(4000).default(''),
  format: z.enum(['TEAM', 'INDIVIDUAL']).default('TEAM'),
  seed: z.number().int().min(1).max(100000).nullable().default(null),
  position: z.number().int().min(0).max(100000).default(0),
  logoImageId: z.string().min(1).max(100).nullable().default(null),
  members: rosterSchema,
});
export const teamSaveSchema = teamFields
  .extend({
    type: z.literal('team.save'),
    id: z.string().min(1).max(100).optional(),
    baseVersion: z.number().int().nonnegative().default(0),
  })
  .superRefine((team, ctx) => {
    if (team.format === 'INDIVIDUAL' && team.members.length !== 1)
      ctx.addIssue({
        code: 'custom',
        message: 'An individual entry must contain exactly one player.',
      });
  });
export const teamActionOptions = [
  teamSaveSchema,
  z.object({
    type: z.literal('team.status'),
    id: z.string().min(1),
    baseVersion: z.number().int(),
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
    published: z.boolean(),
  }),
  z.object({
    type: z.literal('team.delete'),
    id: z.string().min(1),
    baseVersion: z.number().int(),
  }),
  z.object({ type: z.literal('team.import.preview'), csv: z.string().min(1).max(250000) }),
  z.object({
    type: z.literal('team.import.apply'),
    csv: z.string().min(1).max(250000),
    previewHash: z.string().length(64),
  }),
] as const;
export const teamActionSchema = z.discriminatedUnion('type', teamActionOptions);
export type TeamAction = z.infer<typeof teamActionSchema>;
export type TeamFields = z.infer<typeof teamFields>;
