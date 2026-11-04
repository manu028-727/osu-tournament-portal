import { formatPlanSchema } from './format-plan';
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
import { ELIGIBILITY_EXCEPTIONS } from './eligibility';
import { registrationPolicySchema } from './registration-policy';
import { resourcePolicySchema } from './resources';
import { qualifierBookingPolicySchema } from './qualifier-booking-policy';
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
export const settingsFieldsSchema = z.object({
  registrationPolicy: registrationPolicySchema.nullable().optional(),
  qualifierBookingPolicy: qualifierBookingPolicySchema.nullable().optional(),
  resourcePolicy: resourcePolicySchema.nullable().optional(),
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
  copy: z.object(
    Object.fromEntries(
      Object.keys(DEFAULT_COPY).map((key) => [key, z.string().max(2000)]),
    ) as Record<keyof typeof DEFAULT_COPY, z.ZodString>,
  ),
  footer: z.string().max(1000),
});
// Only pure configuration can join a composite save. Pools, staff and pages need network
// calls before their transaction opens, so they keep their own actions.
export const SETUP_OPERATIONS = [
  'settings.save',
  'match.rules.save',
  'stage.save',
  'pooling.plan.save',
  'format.plan.save',
  'category.save',
] as const;
const advancementFields = {
  phaseKey: z.string().min(1).max(40),
  randomSeed: z.string().min(1).max(64).optional(),
  manual: z.record(z.string(), z.array(z.array(id).max(32)).max(32)).optional(),
  explicit: z.record(z.string(), z.array(id).max(256)).optional(),
  reviewedOrder: z.array(id).max(256).optional(),
  overrides: z.record(z.string(), id.nullable()).optional(),
  reason: z.string().trim().max(1000).optional(),
};
const formationFields = { sessionId: id, baseVersion: z.number().int().positive() };
export const actionSchema = z.discriminatedUnion('type', [
  base.extend({
    type: z.literal('format.plan.save'),
    baseToken: z.string().regex(/^[a-f0-9]{64}$/),
    plan: z.unknown(),
  }),
  base.extend({ type: z.literal('format.plan.preview'), plan: formatPlanSchema }),
  base.extend({ type: z.literal('format.lock'), baseToken: z.string().regex(/^[a-f0-9]{64}$/) }),
  base.extend({ type: z.literal('format.unlock'), baseToken: z.string().regex(/^[a-f0-9]{64}$/) }),
  base.extend({ type: z.literal('format.advance.preview'), ...advancementFields }),
  base.extend({
    type: z.literal('format.advance'),
    ...advancementFields,
    reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  base.extend({ type: z.literal('format.reseed'), phaseKey: z.string().min(1).max(40) }),
  base.extend({
    type: z.literal('formation.start'),
    phaseKey: z.string().min(1).max(40),
    captainTeamIds: z.array(id).max(128).optional(),
    randomSeed: z.string().min(1).max(64).optional(),
  }),
  base.extend({
    type: z.literal('formation.assign'),
    ...formationFields,
    lotId: id,
    formationTeamId: id,
    price: z.number().int().min(0).max(100_000_000).nullable().optional(),
    reason: z.string().trim().max(1000).optional(),
  }),
  base.extend({
    type: z.literal('formation.unassign'),
    ...formationFields,
    lotId: id,
    reason: z.string().trim().min(3).max(1000),
  }),
  base.extend({ type: z.literal('formation.reserve'), ...formationFields, lotId: id }),
  base.extend({ type: z.literal('formation.fill'), ...formationFields }),
  base.extend({
    type: z.literal('formation.paste'),
    ...formationFields,
    text: z.string().min(1).max(50_000),
    apply: z.boolean(),
  }),
  base.extend({
    type: z.literal('formation.rename'),
    ...formationFields,
    formationTeamId: id,
    name: z.string().trim().min(1).max(120),
  }),
  base.extend({
    type: z.literal('formation.confirm'),
    ...formationFields,
    incompleteReason: z.string().trim().max(1000).optional(),
  }),
  base.extend({
    type: z.literal('formation.reopen'),
    ...formationFields,
    reason: z.string().trim().min(3).max(1000),
  }),
  base.extend({
    type: z.literal('formation.restart'),
    ...formationFields,
    reason: z.string().trim().min(3).max(1000),
  }),
  base.extend({
    type: z.literal('resource.item.save'),
    id: id.optional(),
    baseVersion: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).default(''),
    price: z.number().int().min(0).max(100_000_000),
    unlockStageId: id.nullable().default(null),
    published: z.boolean().default(false),
  }),
  base.extend({
    type: z.literal('resource.item.archive'),
    id,
    baseVersion: z.number().int().positive(),
  }),
  base.extend({
    type: z.literal('resource.purchase'),
    teamId: id,
    itemId: id,
    stageId: id.nullable().default(null),
    expectedPrice: z.number().int().min(0),
    note: z.string().trim().max(1000).default(''),
  }),
  base.extend({
    type: z.literal('resource.purchase.reverse'),
    id,
    reason: z.string().trim().min(3).max(1000),
  }),
  base.extend({
    type: z.literal('resource.adjust'),
    teamId: id,
    amount: z
      .number()
      .int()
      .min(-100_000_000)
      .max(100_000_000)
      .refine((value) => value !== 0, 'Enter an amount other than zero.'),
    reason: z.string().trim().min(3).max(1000),
  }),
  base.extend({
    type: z.literal('eligibility.exception.grant'),
    osuId: z.number().int().positive().max(2147483647),
    kind: z.enum(ELIGIBILITY_EXCEPTIONS),
    reason: z.string().trim().min(3).max(1000),
  }),
  base.extend({
    type: z.literal('eligibility.exception.revoke'),
    id,
    reason: z.string().trim().min(3).max(1000),
  }),
  base.extend({
    type: z.literal('eligibility.ranks.capture'),
    osuIds: z.array(z.number().int().positive().max(2147483647)).min(1).max(25),
  }),
  base.extend({
    type: z.literal('setup.apply'),
    operations: z
      .array(
        z.looseObject({
          type: z.enum(SETUP_OPERATIONS),
          // Later operations can read a stage created earlier as `ref:<name>`.
          ref: z
            .string()
            .regex(/^[a-z0-9-]{1,60}$/)
            .optional(),
        }),
      )
      .min(1)
      .max(80),
  }),
  base.extend({
    type: z.literal('setup.state'),
    dismissed: z.array(z.string().regex(/^[a-z-]{1,40}$/)).max(40),
  }),
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
    baseVersion: z.number().int().positive().optional(),
    id: id.optional(),
    name: label,
    acronym: z.string().regex(/^[A-Z0-9]{1,10}$/),
    color,
    position: z.number().int().min(0),
  }),
  base.extend({ type: z.literal('category.delete'), id, baseVersion: z.number().int().positive() }),
  base.extend({
    type: z.literal('staff.category.save'),
    baseVersion: z.number().int().positive().optional(),
    id: id.optional(),
    name: label,
    description: z.string().max(500),
    position: z.number().int().min(0),
  }),
  base.extend({
    type: z.literal('staff.category.delete'),
    id,
    baseVersion: z.number().int().positive(),
  }),
  base.extend({
    type: z.literal('staff.save'),
    baseVersion: z.number().int().positive().optional(),
    id: id.optional(),
    osuId: z.number().int().positive(),
    bio: z.string().max(2000),
    customImage: safeUrl,
    visible: z.boolean(),
    position: z.number().int().min(0),
    assignments: z.array(z.object({ categoryId: id, position: z.string().max(120) })).max(20),
  }),
  base.extend({ type: z.literal('staff.delete'), id, baseVersion: z.number().int().positive() }),
  base.extend({
    type: z.literal('role.save'),
    baseRole: z.string().max(20000).optional(),
    id: id.optional(),
    name: label,
    description: z.string().max(500),
    permissions: z.array(z.enum(ALL_PERMISSIONS)).max(ALL_PERMISSIONS.length),
  }),
  base.extend({ type: z.literal('role.delete'), id, baseRole: z.string().max(20000).optional() }),
  base.extend({
    type: z.literal('user.roles'),
    userId: id,
    roleIds: z.array(id).max(30),
    baseRoleIds: z.array(id).max(30).optional(),
    baseRoles: z
      .array(
        z.object({ id, permissions: z.array(z.enum(ALL_PERMISSIONS)).max(ALL_PERMISSIONS.length) }),
      )
      .max(500)
      .optional(),
  }),
  base.extend({
    type: z.literal('user.roles.bulk'),
    users: z
      .array(z.object({ userId: id, baseRoleIds: z.array(id).max(30) }))
      .min(1)
      .max(100),
    roleIds: z.array(id).min(1).max(30),
    operation: z.enum(['ADD', 'REMOVE']),
    baseRoles: z
      .array(
        z.object({ id, permissions: z.array(z.enum(ALL_PERMISSIONS)).max(ALL_PERMISSIONS.length) }),
      )
      .max(500)
      .optional(),
  }),
  settingsFieldsSchema.partial().extend({
    type: z.literal('settings.save'),
    baseVersion: z.number().int().positive(),
    scoringReview: z.boolean().optional(),
  }),
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
