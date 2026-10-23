import { z } from 'zod';
import { ALL_PERMISSIONS } from './permissions';
import { DEFAULT_COPY } from './copy';
import { teamActionOptions } from './teams-validation';
import { matchActionOptions } from './matches-validation';
import { qualifierActionOptions } from './qualifiers-validation';
import { matchRulesSchema } from './match-rules';
import { gameplayScoringSchema } from './gameplay-scoring';
import { qualifierPolicySchema } from './qualifier-policy';
import { competitionActionSchema } from './competition-validation';
import { qualifierStandingsActionSchema } from './qualifier-standings-validation';
import { stageReconciliationActionSchema } from './stage-reconciliation';
import { poolingActionOptions, poolPlanSchema } from './pooling-validation';
import { stageWorkflowActionSchemas } from './stage-workflows-validation';
import { matchesSchedulingActionOptions } from './matches-bulk-validation';
import { staffBulkActionSchema } from './staff-bulk-validation';
export const id = z.string().min(1).max(100);
export const label = z.string().trim().min(1).max(120);
export const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const safeUrl = z
  .string()
  .max(2048)
  .refine(
    (v) =>
      v === '' ||
      /^\/(?!\/)[^\\]*$/.test(v) ||
      (() => {
        try {
          return ['https:', 'http:'].includes(new URL(v).protocol);
        } catch {
          return false;
        }
      })(),
    'Use a relative path or an HTTP(S) URL.',
  );
export const blockSchema = z.object({
  type: z.enum(['hero', 'text', 'image', 'announcements', 'buttons', 'timeline']),
  visible: z.boolean(),
  content: z.object({
    eyebrow: z.string().max(120).optional(),
    title: z.string().max(200).optional(),
    text: z.string().max(20000).optional(),
    html: z.string().max(100000).optional(),
    image: safeUrl.optional(),
    buttons: z
      .array(z.object({ label, href: safeUrl }))
      .max(8)
      .optional(),
  }),
});
export const slotSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,20}$/),
  category: id,
  beatmapId: z.number().int().positive().max(2147483647),
});
const base = z.object({ type: z.string() });
export const actionSchema = z.discriminatedUnion('type', [
  ...poolingActionOptions,
  ...stageWorkflowActionSchemas,
  ...competitionActionSchema.options,
  ...qualifierStandingsActionSchema.options,
  stageReconciliationActionSchema,
  ...teamActionOptions,
  ...matchActionOptions,
  ...matchesSchedulingActionOptions,
  staffBulkActionSchema,
  ...qualifierActionOptions,
  base.extend({
    type: z.literal('page.save'),
    slug: z.enum(['home', 'rules']),
    title: label,
    html: z.string().max(300000),
    blocks: z.array(blockSchema).max(40),
    baseRevisionId: id.nullable(),
  }),
  base.extend({ type: z.literal('page.publish'), slug: z.enum(['home', 'rules']), revisionId: id }),
  base.extend({ type: z.literal('page.unpublish'), slug: z.enum(['home', 'rules']) }),
  base.extend({
    type: z.literal('page.restore'),
    slug: z.enum(['home', 'rules']),
    revisionId: id,
    baseRevisionId: id.nullable(),
  }),
  base.extend({
    type: z.literal('stage.save'),
    baseConfigurationToken: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    id: id.optional(),
    name: label,
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(80),
    description: z.string().max(500),
    position: z.number().int().min(0),
    startsAt: z.iso.datetime().nullable(),
    bannerImageId: id.nullable().optional(),
    kind: z.enum(['QUALIFIERS', 'ELIMINATION', 'GROUPS', 'CUSTOM']).optional(),
    qualifierPolicy: qualifierPolicySchema.nullable().optional(),
    nextStageId: id.nullable().optional(),
    archivedAt: z.iso.datetime().nullable().optional(),
    matchRules: matchRulesSchema.nullable().optional(),
  }),
  base.extend({ type: z.literal('stage.delete'), id }),
  base.extend({
    type: z.literal('pool.save'),
    id,
    baseRevisionId: id.nullable(),
    notes: z.string().max(3000),
    slots: z.array(slotSchema).max(100),
    plan: poolPlanSchema.optional(),
  }),
  base.extend({ type: z.literal('pool.publish'), id, revisionId: id }),
  base.extend({ type: z.literal('pool.unpublish'), id }),
  base.extend({
    type: z.literal('category.save'),
    id: id.optional(),
    name: label,
    acronym: z.string().regex(/^[A-Z0-9]{1,10}$/),
    color,
    position: z.number().int().min(0),
  }),
  base.extend({ type: z.literal('category.delete'), id }),
  base.extend({
    type: z.literal('staff.category.save'),
    id: id.optional(),
    name: label,
    description: z.string().max(500),
    position: z.number().int().min(0),
  }),
  base.extend({ type: z.literal('staff.category.delete'), id }),
  base.extend({
    type: z.literal('staff.save'),
    id: id.optional(),
    osuId: z.number().int().positive(),
    bio: z.string().max(2000),
    customImage: safeUrl,
    visible: z.boolean(),
    position: z.number().int().min(0),
    assignments: z.array(z.object({ categoryId: id, position: z.string().max(120) })).max(20),
  }),
  base.extend({ type: z.literal('staff.delete'), id }),
  base.extend({
    type: z.literal('role.save'),
    id: id.optional(),
    name: label,
    description: z.string().max(500),
    permissions: z.array(z.enum(ALL_PERMISSIONS)).max(ALL_PERMISSIONS.length),
  }),
  base.extend({ type: z.literal('role.delete'), id }),
  base.extend({ type: z.literal('user.roles'), userId: id, roleIds: z.array(id).max(30) }),
  base.extend({
    type: z.literal('settings.save'),
    scoringReview: z.boolean().optional(),
    gameplayScoring: gameplayScoringSchema.nullable().optional(),
    name: label,
    acronym: z.string().trim().min(1).max(20),
    description: z.string().max(2000),
    status: z.enum(['DRAFT', 'UPCOMING', 'REGISTRATIONS_OPEN', 'ONGOING', 'COMPLETED']),
    timezone: z.string().max(100).optional(),
    format: z.enum(['SOLO', 'TEAMS', 'CUSTOM']).optional(),
    startsAt: z.iso.datetime().nullable().optional(),
    endsAt: z.iso.datetime().nullable().optional(),
    gameMode: z.enum(['osu', 'taiko', 'fruits', 'mania']),
    logo: safeUrl,
    favicon: safeUrl,
    banner: safeUrl,
    primaryColor: color,
    accentColor: color,
    registrationUrl: safeUrl,
    socialLinks: z.array(z.object({ label, href: safeUrl })).max(15),
    importantDates: z.array(z.object({ label, date: z.iso.date() })).max(30),
    navigation: z.array(z.object({ label, href: safeUrl })).max(15),
    copy: z
      .object(
        Object.fromEntries(
          Object.keys(DEFAULT_COPY).map((key) => [key, z.string().max(2000)]),
        ) as Record<keyof typeof DEFAULT_COPY, z.ZodString>,
      )
      .default(DEFAULT_COPY),
    footer: z.string().max(1000),
  }),
  base.extend({ type: z.literal('media.delete'), id }),
]);
export type AdminAction = z.infer<typeof actionSchema>;
export type Block = z.infer<typeof blockSchema>;
export function parseImport(
  input: string,
  defaultCategory: string,
): { name: string; category: string; beatmapId: number }[] {
  const lines = input
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length > 100) throw new Error('Import at most 100 beatmaps at once.');
  return lines.map((line, i) => {
    const split = /^https?:\/\//i.test(line)
      ? null
      : line.match(/^([A-Za-z0-9_-]+)\s*[:=,\t ]\s*(.+)$/);
    const explicitName = split?.[1];
    const value = (split?.[2] || line).trim();
    const urlId = value.match(/(?:\/beatmaps\/|\/b\/|#(?:osu|taiko|fruits|mania)\/)(\d+)/i)?.[1];
    const rawId = urlId || (/^\d+$/.test(value) ? value : null);
    if (!rawId)
      throw new Error(`Line ${i + 1}: use a beatmap ID, beatmap URL, or SLOT followed by an ID.`);
    const name = explicitName || `${defaultCategory}${i + 1}`;
    return slotSchema.parse({
      name,
      category: explicitName?.replace(/[0-9]+$/, '') || defaultCategory,
      beatmapId: Number(rawId),
    });
  });
}
