import { z } from 'zod';

export const registrationPolicySchema = z
  .object({
    mode: z.enum(['WEBSITE', 'EXTERNAL']).default('WEBSITE'),
    format: z.enum(['AUTO', 'TEAM', 'INDIVIDUAL']).default('AUTO'),
    opensAt: z.iso.datetime().nullable().default(null),
    closesAt: z.iso.datetime().nullable().default(null),
    rosterClosesAt: z.iso.datetime().nullable().default(null),
    rosterLocked: z.boolean().default(false),
    minPlayers: z.number().int().min(0).max(16).default(0),
    maxPlayers: z.number().int().min(1).max(32).default(8),
    maxSubstitutes: z.number().int().min(0).max(16).default(2),
    minRank: z.number().int().positive().nullable().default(null),
    maxRank: z.number().int().positive().nullable().default(null),
    countries: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .max(250)
      .default([]),
    bookingEnabled: z.boolean().default(true),
    bookingClosesAt: z.iso.datetime().nullable().default(null),
    fields: z
      .array(
        z.object({
          key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
          label: z.string().trim().min(1).max(120),
          type: z.enum(['text', 'longtext', 'number', 'choice', 'checkbox']),
          required: z.boolean(),
          options: z.array(z.string().min(1).max(120)).max(30).default([]),
        }),
      )
      .max(20)
      .default([]),
  })
  .superRefine((policy, ctx) => {
    if (policy.minPlayers > policy.maxPlayers)
      ctx.addIssue({ code: 'custom', message: 'The minimum roster cannot exceed its maximum.' });
    if (policy.minRank && policy.maxRank && policy.minRank > policy.maxRank)
      ctx.addIssue({ code: 'custom', message: 'The minimum rank cannot exceed its maximum.' });
    if (new Set(policy.fields.map((field) => field.key)).size !== policy.fields.length)
      ctx.addIssue({ code: 'custom', message: 'Each registration field needs a unique key.' });
    if (policy.fields.some((field) => field.type === 'choice' && !field.options.length))
      ctx.addIssue({ code: 'custom', message: 'Choice fields need at least one option.' });
  });
export type RegistrationPolicy = z.infer<typeof registrationPolicySchema>;
export const registrationActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('registration.save'),
    baseVersion: z.number().int().min(0),
    policyToken: z.string().regex(/^[a-f0-9]{64}$/),
    name: z.string().trim().min(1).max(120),
    format: z.enum(['TEAM', 'INDIVIDUAL']),
    members: z
      .array(
        z.object({
          osuId: z.number().int().positive().max(2147483647),
          substitute: z.boolean(),
          discordId: z
            .string()
            .regex(/^(?:\d{17,20})?$/)
            .default(''),
        }),
      )
      .min(1)
      .max(32),
    answers: z
      .record(z.string(), z.union([z.string().max(4000), z.number().finite(), z.boolean()]))
      .default({}),
  }),
  z.object({
    type: z.literal('registration.booking'),
    teamVersion: z.number().int().positive(),
    policyToken: z.string().regex(/^[a-f0-9]{64}$/),
    stageId: z.string().min(1).max(100),
    lobbyId: z.string().min(1).max(100).nullable(),
    baseVersion: z.number().int().positive().optional(),
    sourceVersion: z.number().int().positive().optional(),
  }),
]);
export type RegistrationAction = z.infer<typeof registrationActionSchema>;
