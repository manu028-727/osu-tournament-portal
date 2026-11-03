import { z } from 'zod';
import { matchRulesSchema, type MatchRules } from './match-rules';
import { stagePoolChecks } from './stage-pool-validation';
import { normalizedSlot } from './mappool-order';

const id = z.string().min(1).max(100);
const token = z.string().regex(/^[a-f0-9]{64}$/);
const selection = z
  .array(z.object({ id, baseConfigurationToken: token }).strict())
  .min(1)
  .max(200)
  .refine(
    (rows) => new Set(rows.map((row) => row.id)).size === rows.length,
    'Select each stage only once.',
  );
export const stageRulePatchSchema = z
  .object({
    bestOf: matchRulesSchema.shape.bestOf.removeDefault().optional(),
    bansPerTeam: matchRulesSchema.shape.bansPerTeam.removeDefault().optional(),
    protectsPerTeam: matchRulesSchema.shape.protectsPerTeam.removeDefault().optional(),
    draftSequence: matchRulesSchema.shape.draftSequence.removeDefault().optional(),
    banOrder: matchRulesSchema.shape.banOrder.removeDefault().optional(),
    pickOrder: matchRulesSchema.shape.pickOrder.removeDefault().optional(),
    protectOrder: matchRulesSchema.shape.protectOrder.removeDefault().optional(),
    firstBanRule: matchRulesSchema.shape.firstBanRule.removeDefault().optional(),
    firstPickRule: matchRulesSchema.shape.firstPickRule.removeDefault().optional(),
    firstProtectRule: matchRulesSchema.shape.firstProtectRule.removeDefault().optional(),
    rollRequired: matchRulesSchema.shape.rollRequired.removeDefault().optional(),
    enableTiebreaker: matchRulesSchema.shape.enableTiebreaker.removeDefault().optional(),
    allowTiebreakerBans: matchRulesSchema.shape.allowTiebreakerBans.removeDefault().optional(),
    tiebreakerBanOrder: matchRulesSchema.shape.tiebreakerBanOrder.removeDefault().optional(),
    tiebreakerBanFirstSide: matchRulesSchema.shape.tiebreakerBanFirstSide
      .removeDefault()
      .optional(),
    winCondition: matchRulesSchema.shape.winCondition.removeDefault().optional(),
    requiredMods: matchRulesSchema.shape.requiredMods.removeDefault().optional(),
    freeModQuotas: matchRulesSchema.shape.freeModQuotas,
  })
  .strict()
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    'Choose at least one rule to change.',
  );
export type StageRulePatch = z.infer<typeof stageRulePatchSchema>;

export const stageWorkflowActionSchemas = [
  z
    .object({
      type: z.literal('stage.duplicate'),
      sourceId: id,
      baseConfigurationToken: token,
      name: z.string().trim().min(1).max(120),
      slug: z
        .string()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .max(80),
      copyRules: z.boolean(),
      copyAppearance: z.boolean(),
      poolMode: z.enum(['EMPTY', 'STRUCTURE', 'CONTENTS']),
    })
    .strict(),
  z
    .object({
      type: z.literal('stage.rules.patch'),
      stages: selection,
      defaultsToken: token,
      patch: stageRulePatchSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('stage.rules.apply'),
      stages: selection,
      defaultsToken: token,
      source: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('TOURNAMENT') }).strict(),
        z.object({ kind: z.literal('STAGE'), id, baseConfigurationToken: token }).strict(),
      ]),
    })
    .strict(),
  z.object({ type: z.literal('stage.reorder'), stages: selection }).strict(),
] as const;
export const stageWorkflowActionSchema = z.discriminatedUnion('type', stageWorkflowActionSchemas);
export type StageWorkflowAction = z.infer<typeof stageWorkflowActionSchema>;

export function stageRulesWithSequence(
  rules: MatchRules,
  sequence: MatchRules['draftSequence'],
): MatchRules {
  if (!sequence.length) return { ...rules, draftSequence: [] };
  return {
    ...rules,
    draftSequence: sequence,
    bestOf: 1 + 2 * sequence.filter((kind) => kind === 'PICK').length,
    bansPerTeam: sequence.filter((kind) => kind === 'BAN').length,
    protectsPerTeam: sequence.filter((kind) => kind === 'PROTECT').length,
    ...(sequence.includes('TB_BAN') ? { enableTiebreaker: true } : {}),
  };
}

// A sequence entry is a pair, not one team's turn. The referee engine expands it.
export function patchStageRules(base: MatchRules, patch: StageRulePatch): MatchRules {
  const next = { ...base, ...patch };
  if (patch.draftSequence?.length) {
    const configured = stageRulesWithSequence(next, patch.draftSequence);
    for (const key of ['bestOf', 'bansPerTeam', 'protectsPerTeam', 'enableTiebreaker'] as const)
      if (patch[key] !== undefined && patch[key] !== configured[key])
        throw new Error(`${key} conflicts with the selected action sequence.`);
    return matchRulesSchema.parse(configured);
  }
  if (patch.draftSequence === undefined && next.draftSequence.length) {
    const sequence = [...next.draftSequence];
    const resize = (kind: 'PICK' | 'BAN' | 'PROTECT', count: number) => {
      let current = sequence.filter((item) => item === kind).length;
      while (current > count) {
        sequence.splice(sequence.lastIndexOf(kind), 1);
        current--;
      }
      while (current < count) {
        const before = sequence.findIndex((item) =>
          kind === 'PROTECT'
            ? item !== 'PROTECT'
            : kind === 'BAN'
              ? item === 'PICK' || item === 'TB_BAN'
              : item === 'TB_BAN',
        );
        sequence.splice(before < 0 ? sequence.length : before, 0, kind);
        current++;
      }
    };
    if (patch.bestOf !== undefined) resize('PICK', (patch.bestOf - 1) / 2);
    if (patch.bansPerTeam !== undefined) resize('BAN', patch.bansPerTeam);
    if (patch.protectsPerTeam !== undefined) resize('PROTECT', patch.protectsPerTeam);
    next.draftSequence = sequence;
  }
  return matchRulesSchema.parse(next);
}

export type StagePoolIssue = { code: string; message: string };
export function stagePoolIssues(
  rules: MatchRules,
  slots: { name: string; category: string; beatmapId: number }[] | null,
): StagePoolIssue[] {
  if (!slots?.length)
    return [{ code: 'EMPTY_POOL', message: 'Add maps before using this stage for matches.' }];
  const issues: StagePoolIssue[] = stagePoolChecks('ELIMINATION', rules, slots);
  if (new Set(slots.map((slot) => normalizedSlot(slot).name)).size !== slots.length)
    issues.push({ code: 'DUPLICATE_SLOTS', message: 'Give every map a unique slot name.' });
  if (new Set(slots.map((slot) => slot.beatmapId)).size !== slots.length)
    issues.push({
      code: 'DUPLICATE_MAPS',
      message: 'A beatmap appears in multiple slots; use a different map in each slot.',
    });
  if (
    slots.some(
      (slot) =>
        !slot.category ||
        !slot.name ||
        !Number.isSafeInteger(slot.beatmapId) ||
        slot.beatmapId <= 0,
    )
  )
    issues.push({
      code: 'INVALID_SLOT',
      message: 'Every slot needs a name, mod category, and valid beatmap ID.',
    });
  return issues;
}
