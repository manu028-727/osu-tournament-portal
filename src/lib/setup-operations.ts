import {
  buildTemplate,
  poolForBestOf,
  poolPlanSlots,
  POOL_CATEGORIES,
  type PoolCounts,
  type StageDraft,
  type TemplateChoices,
} from './format-templates';
import { MODS, type MatchRules } from './match-rules';
import { qualifierPolicySchema } from './qualifier-policy';
import { patchStageRules } from './stage-workflows-validation';
import type { SetupWorkspaceData } from './setup-queries';

export const slugFromName = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

// Choosing rules for a stage keeps these, and every other rule follows the tournament.
const STAGE_RULE_FIELDS = [
  'bestOf',
  'bansPerTeam',
  'protectsPerTeam',
  'draftSequence',
  'banOrder',
  'pickOrder',
  'protectOrder',
  'firstBanRule',
  'firstPickRule',
  'firstProtectRule',
  'warmupsPerTeam',
] as const satisfies readonly (keyof MatchRules)[];

export function rulesFollowingDefaults(defaults: MatchRules, stage: MatchRules | null): MatchRules {
  if (!stage) return defaults;
  const kept = Object.fromEntries(STAGE_RULE_FIELDS.map((field) => [field, stage[field]]));
  return { ...defaults, ...kept };
}

export function stageRulesWith(
  rules: MatchRules,
  bestOf: number | null,
  bansPerTeam: number | null,
): MatchRules {
  // A one-ban order is only valid for one ban, so a larger count needs a longer one.
  const base: MatchRules =
    rules.banOrder === 'AB' && bansPerTeam !== null && bansPerTeam !== 1
      ? { ...rules, banOrder: 'ABBA' }
      : rules;
  return patchStageRules(base, {
    ...(bestOf !== null ? { bestOf } : {}),
    ...(bansPerTeam !== null ? { bansPerTeam } : {}),
  });
}

// One count per map type, including any type a saved plan already uses.
export function poolCounts(
  slots: readonly { category: string }[] | undefined,
  categories: readonly string[] = POOL_CATEGORIES,
): PoolCounts {
  const counts: PoolCounts = Object.fromEntries(categories.map((category) => [category, 0]));
  for (const slot of slots || []) counts[slot.category] = (counts[slot.category] ?? 0) + 1;
  return counts;
}

// A pool needs a map for every game a match can reach, plus every map that can be banned.
export const mapsNeeded = (bestOf: number | null, bansPerTeam: number | null) =>
  bestOf === null ? 0 : bestOf + 2 * (bansPerTeam ?? 0);

// A pool still on the defaults follows a new Best of. One someone changed by hand is left alone.
export function resizedPool(pool: PoolCounts, from: number | null, to: number | null): PoolCounts {
  if (from === null || to === null) return pool;
  const standard = poolForBestOf(from);
  const onDefaults = Object.entries(pool).every(
    ([category, count]) => count === (standard[category] ?? 0),
  );
  return onDefaults ? { ...pool, ...poolForBestOf(to) } : pool;
}

export type StageRow = {
  key: string;
  id: string | null;
  token: string | null;
  name: string;
  kind: 'QUALIFIERS' | 'GROUPS' | 'ELIMINATION' | 'CUSTOM';
  bestOf: number | null;
  bansPerTeam: number | null;
  pool: PoolCounts;
  minStars: number | null;
  maxStars: number | null;
  planVersion: number | null;
  poolState: string;
  poolSlots: number;
};

export function stageRows(data: SetupWorkspaceData): StageRow[] {
  return data.stages.map((stage) => ({
    key: stage.id,
    id: stage.id,
    token: stage.configurationToken,
    name: stage.name,
    kind: stage.kind as StageRow['kind'],
    bestOf: stage.kind === 'QUALIFIERS' ? null : (stage.matchRules || data.rules).bestOf,
    bansPerTeam: stage.kind === 'QUALIFIERS' ? null : (stage.matchRules || data.rules).bansPerTeam,
    pool: poolCounts(stage.poolPlan?.slots, data.categories),
    minStars: stage.poolPlan?.minStars ?? null,
    maxStars: stage.poolPlan?.maxStars ?? null,
    planVersion: stage.poolPlan?.version ?? null,
    poolState: stage.poolState,
    poolSlots: stage.poolSlots,
  }));
}

const stageSave = (
  row: Pick<StageRow, 'id' | 'token' | 'name' | 'kind' | 'bestOf' | 'bansPerTeam'>,
  position: number,
  slug: string,
  saved: SetupWorkspaceData['stages'][number] | undefined,
  defaults: MatchRules,
  ref?: string,
) => ({
  type: 'stage.save',
  ...(ref ? { ref } : {}),
  ...(row.id ? { id: row.id, baseConfigurationToken: row.token } : {}),
  name: row.name,
  slug,
  description: saved?.description ?? '',
  position,
  startsAt: saved?.startsAt ?? null,
  kind: row.kind,
  ...(row.kind === 'QUALIFIERS'
    ? {
        qualifierPolicy:
          saved?.qualifierPolicy ??
          qualifierPolicySchema.parse({
            method: 'Z_SUM',
            requiredPlayers: defaults.teamSize,
          }),
      }
    : {
        matchRules: stageRulesWith(
          rulesFollowingDefaults(defaults, saved?.matchRules ?? null),
          row.bestOf,
          row.bansPerTeam,
        ),
      }),
});

// Saves the whole grid at once, leaving a row's pool plan alone unless it changed.
export function stageGridOperations(rows: readonly StageRow[], data: SetupWorkspaceData) {
  const taken = new Set(data.stages.map((stage) => stage.slug));
  return rows.flatMap((row, position) => {
    const saved = data.stages.find((stage) => stage.id === row.id);
    let slug = saved?.slug;
    if (!slug) {
      const base = slugFromName(row.name) || 'stage';
      slug = base;
      for (let suffix = 2; taken.has(slug); suffix++) slug = `${base}-${suffix}`;
      taken.add(slug);
    }
    const ref = row.id ? undefined : `new-${position}`;
    const planChanged =
      JSON.stringify(row.pool) !==
        JSON.stringify(poolCounts(saved?.poolPlan?.slots, data.categories)) ||
      row.minStars !== (saved?.poolPlan?.minStars ?? null) ||
      row.maxStars !== (saved?.poolPlan?.maxStars ?? null);
    return [
      stageSave(row, position, slug, saved, data.rules, ref),
      ...(planChanged
        ? [
            {
              type: 'pooling.plan.save',
              stageId: row.id ?? `ref:${ref}`,
              slots: poolPlanSlots(row.pool),
              minStars: row.minStars,
              maxStars: row.maxStars,
              baseVersion: row.planVersion,
            },
          ]
        : []),
    ];
  });
}

// Changing the tournament's rules carries to its stages, keeping each stage's own match length.
export function defaultRulesOperations(
  rules: MatchRules,
  data: SetupWorkspaceData,
  extra: Record<string, unknown>[] = [],
) {
  return [
    ...extra,
    { type: 'match.rules.save', stageId: null, rules, baseHash: data.defaultsHash },
    ...data.stages
      .filter((stage) => stage.kind !== 'QUALIFIERS' && stage.matchRules)
      .map((stage) => ({
        type: 'match.rules.save',
        stageId: stage.id,
        rules: rulesFollowingDefaults(rules, stage.matchRules),
        baseHash: stage.rulesHash,
      })),
  ];
}

// The saved format follows the single team size control, so qualifier imports and automatic
// registration cannot keep reading an old value. Mixed entry stays custom.
const tournamentFormat = (teamSize: number, entrants: 'AUTO' | 'TEAM' | 'INDIVIDUAL') =>
  entrants === 'INDIVIDUAL' && teamSize > 1 ? 'CUSTOM' : teamSize === 1 ? 'SOLO' : 'TEAMS';

// Team size has one control, which keeps rules, roster limits and qualifiers in agreement.
export function rosterOperations(
  roster: {
    teamSize: number;
    format: 'AUTO' | 'TEAM' | 'INDIVIDUAL';
    minPlayers: number;
    maxPlayers: number;
    maxSubstitutes: number;
  },
  data: SetupWorkspaceData,
) {
  const { teamSize, ...registration } = roster;
  const rules = { ...data.rules, teamSize };
  return [
    {
      type: 'settings.save',
      baseVersion: data.tournament.version,
      registrationPolicy: { ...data.registration, ...registration },
      format: tournamentFormat(teamSize, roster.format),
    },
    ...defaultRulesOperations(rules, data),
    ...data.stages
      .filter((stage) => stage.kind === 'QUALIFIERS')
      .map((stage) => ({
        type: 'stage.save',
        id: stage.id,
        baseConfigurationToken: stage.configurationToken,
        name: stage.name,
        slug: stage.slug,
        description: stage.description,
        position: stage.position,
        startsAt: stage.startsAt,
        kind: stage.kind,
        qualifierPolicy: qualifierPolicySchema.parse({
          ...(stage.qualifierPolicy as object),
          requiredPlayers: teamSize,
        }),
      })),
  ];
}

export function templateOperations(choices: TemplateChoices, data: SetupWorkspaceData) {
  const { stages, plan, teamMode, entrantFormat } = buildTemplate(choices);
  const rules: MatchRules = { ...data.rules, teamSize: choices.teamSize, teamMode };
  const qualifierPolicy = qualifierPolicySchema.parse({
    method: choices.seeding,
    runs: choices.runs,
    requiredPlayers: choices.template === 'DRAFT' ? 1 : choices.teamSize,
  });
  const operation = (draft: StageDraft, position: number) => ({
    type: 'stage.save',
    ref: draft.ref,
    name: draft.name,
    slug: draft.ref,
    description: '',
    position,
    startsAt: null,
    kind: draft.kind,
    ...(draft.kind === 'QUALIFIERS'
      ? { qualifierPolicy }
      : { matchRules: stageRulesWith(rules, draft.bestOf, draft.bansPerTeam) }),
  });
  return [
    {
      type: 'settings.save',
      baseVersion: data.tournament.version,
      registrationPolicy: {
        ...data.registration,
        format: entrantFormat,
        minPlayers: choices.template === 'DRAFT' ? 1 : choices.teamSize,
        maxPlayers: choices.template === 'DRAFT' ? 1 : choices.rosterSize,
      },
      format: tournamentFormat(choices.teamSize, entrantFormat),
    },
    { type: 'match.rules.save', stageId: null, rules, baseHash: data.defaultsHash },
    ...stages.flatMap((draft, position) => [
      operation(draft, position),
      {
        type: 'pooling.plan.save',
        stageId: `ref:${draft.ref}`,
        slots: poolPlanSlots(draft.pool),
        minStars: draft.minStars,
        maxStars: draft.maxStars,
        baseVersion: null,
      },
    ]),
    { type: 'format.plan.save', baseToken: data.planToken, plan },
  ];
}

// A new map type needs its category and a place in the rules, so both save together.
export function newMapTypeOperations(acronym: string, data: SetupWorkspaceData) {
  const isMod = (MODS as readonly string[]).includes(acronym);
  return [
    {
      type: 'category.save',
      name: acronym,
      acronym,
      color: '#9db4c0',
      position: data.categories.length,
    },
    ...defaultRulesOperations(
      {
        ...data.rules,
        categoryMods: { ...data.rules.categoryMods, [acronym]: isMod ? acronym : '' },
      },
      data,
    ),
  ];
}
