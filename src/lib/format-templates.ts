import { z } from 'zod';
import { FORMAT_PLAN_VERSION, formatPlanSchema, type FormatPlan } from './format-plan';

// Generic starting points, not any event's rules. Each produces real stages and a plan
// the organizer then edits; stage references resolve when the setup is applied.
export const TEMPLATE_KEYS = [
  'BRACKET',
  'QUALIFIER_BRACKET',
  'QUALIFIER_GROUPS_BRACKET',
  'DIRECT_ENTRY_GROUPS',
  'TIERED_GROUPS',
  'DRAFT',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];
export const TEMPLATE_LABELS: Record<TemplateKey, { name: string; description: string }> = {
  BRACKET: {
    name: 'Bracket only',
    description: 'Registered entrants go straight into a bracket, seeded by the organizer.',
  },
  QUALIFIER_BRACKET: {
    name: 'Qualifiers, then bracket',
    description: 'A qualifier cuts the field and seeds a bracket.',
  },
  QUALIFIER_GROUPS_BRACKET: {
    name: 'Qualifiers, groups, then bracket',
    description: 'Qualified entrants play seeded groups, and the best of each group advance.',
  },
  DIRECT_ENTRY_GROUPS: {
    name: 'Top seeds skip groups',
    description:
      'The best seeds enter the bracket directly. Others play groups, and each placement joins Winners, Losers or leaves.',
  },
  TIERED_GROUPS: {
    name: 'Tiered groups with byes',
    description:
      'Top seeds skip groups, two tiers play separate groups, and the upper tier gets the better bracket paths.',
  },
  DRAFT: {
    name: 'Individual qualifiers, then a draft',
    description: 'Players qualify alone, captains form teams, and the teams play a bracket.',
  },
};

const powerOfTwo = z
  .number()
  .int()
  .min(2)
  .max(128)
  .refine((value) => Number.isInteger(Math.log2(value)), 'Bracket sizes must be powers of two.');
export const templateChoicesSchema = z.object({
  template: z.enum(TEMPLATE_KEYS),
  teamSize: z.number().int().min(1).max(8),
  rosterSize: z.number().int().min(1).max(16),
  bracketSize: powerOfTwo,
  doubleElimination: z.boolean(),
  directSeeds: z.number().int().min(0).max(64),
  groupCount: z.number().int().min(1).max(16),
  groupSize: z.number().int().min(2).max(8),
  advancePerGroup: z.number().int().min(1).max(8),
  formation: z.enum(['AUCTION', 'SNAKE_DRAFT', 'MANUAL']),
  runs: z.union([z.literal(1), z.literal(2)]),
  seeding: z.enum(['Z_SUM', 'RAW_SCORE', 'PERCENT_MAX', 'AVERAGE_PLACEMENT']),
});
export type TemplateChoices = z.infer<typeof templateChoicesSchema>;
export const DEFAULT_TEMPLATE_CHOICES: TemplateChoices = {
  template: 'QUALIFIER_BRACKET',
  teamSize: 2,
  rosterSize: 3,
  bracketSize: 16,
  doubleElimination: true,
  directSeeds: 4,
  groupCount: 4,
  groupSize: 4,
  advancePerGroup: 2,
  formation: 'AUCTION',
  runs: 1,
  seeding: 'Z_SUM',
};

// Each template starts from numbers that seat its bracket exactly.
const TEMPLATE_DEFAULTS: Record<TemplateKey, Partial<TemplateChoices>> = {
  BRACKET: { bracketSize: 16 },
  QUALIFIER_BRACKET: { bracketSize: 16 },
  QUALIFIER_GROUPS_BRACKET: { groupCount: 4, groupSize: 4, advancePerGroup: 2 },
  DIRECT_ENTRY_GROUPS: { directSeeds: 4, groupCount: 4, groupSize: 4 },
  TIERED_GROUPS: { directSeeds: 8, groupCount: 4, groupSize: 4 },
  DRAFT: { teamSize: 3, rosterSize: 5, bracketSize: 8, seeding: 'AVERAGE_PLACEMENT' },
};
export const templateDefaults = (template: TemplateKey): TemplateChoices => ({
  ...DEFAULT_TEMPLATE_CHOICES,
  ...TEMPLATE_DEFAULTS[template],
  template,
});

export const POOL_CATEGORIES = ['NM', 'HD', 'HR', 'DT', 'FM', 'TB'] as const;
export type PoolCounts = Record<(typeof POOL_CATEGORIES)[number], number>;
export type StageDraft = {
  ref: string;
  name: string;
  kind: 'QUALIFIERS' | 'GROUPS' | 'ELIMINATION';
  bestOf: number | null;
  bansPerTeam: number | null;
  pool: PoolCounts;
  minStars: number | null;
  maxStars: number | null;
};

const QUALIFIER_POOL: PoolCounts = { NM: 4, HD: 2, HR: 2, DT: 3, FM: 0, TB: 0 };
// Larger pools for longer matches, so bans and picks never run a team out of maps.
export function poolForBestOf(bestOf: number): PoolCounts {
  if (bestOf <= 9) return { NM: 4, HD: 2, HR: 2, DT: 2, FM: 2, TB: 1 };
  if (bestOf <= 11) return { NM: 5, HD: 3, HR: 3, DT: 3, FM: 2, TB: 1 };
  return { NM: 6, HD: 3, HR: 3, DT: 4, FM: 3, TB: 1 };
}
const roundName = (entrants: number) =>
  entrants === 2
    ? 'Finals'
    : entrants === 4
      ? 'Semifinals'
      : entrants === 8
        ? 'Quarterfinals'
        : `Round of ${entrants}`;
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function stage(
  name: string,
  kind: StageDraft['kind'],
  bestOf: number | null,
  bansPerTeam: number | null = null,
): StageDraft {
  return {
    ref: slug(name),
    name,
    kind,
    bestOf,
    bansPerTeam: bestOf === null ? null : (bansPerTeam ?? (bestOf <= 9 ? 1 : 2)),
    pool: bestOf === null ? QUALIFIER_POOL : poolForBestOf(bestOf),
    minStars: null,
    maxStars: null,
  };
}

// One stage per round entrants pass through, with matches lengthening towards the final.
export function eliminationStages(winnersEntrants: number, double: boolean): StageDraft[] {
  const rounds: number[] = [];
  for (let entrants = winnersEntrants; entrants >= 2; entrants /= 2) rounds.push(entrants);
  const stages = rounds.map((entrants) =>
    stage(roundName(entrants), 'ELIMINATION', entrants <= 2 ? 13 : entrants <= 8 ? 11 : 9),
  );
  if (double) stages.push(stage('Grand Finals', 'ELIMINATION', 13));
  return stages;
}
const stageId = (draft: StageDraft) => `ref:${draft.ref}`;

export function buildTemplate(input: TemplateChoices): {
  stages: StageDraft[];
  plan: FormatPlan;
  teamMode: 'TEAM_VS' | 'HEAD_TO_HEAD';
  entrantFormat: 'TEAM' | 'INDIVIDUAL';
} {
  const choices = templateChoicesSchema.parse(input);
  const { teamSize, bracketSize, doubleElimination: double, groupCount, groupSize } = choices;
  const qualifiers = stage('Qualifiers', 'QUALIFIERS', null);
  const elimination = (
    winners: number,
    losers: number | null,
    entries: unknown[],
    extra: Record<string, unknown> = {},
  ) => {
    const stages = eliminationStages(winners, double);
    return {
      stages,
      phase: double
        ? {
            kind: 'DOUBLE_ELIMINATION',
            key: 'main',
            name: 'Main bracket',
            stageId: stageId(stages[0]),
            entries,
            winners: { size: winners, pairing: 'STANDARD' },
            losers: losers ? { size: losers, pairing: 'STANDARD' } : null,
            ...extra,
          }
        : {
            kind: 'SINGLE_ELIMINATION',
            key: 'main',
            name: 'Main bracket',
            stageId: stageId(stages[0]),
            entries: entries.map((item) => {
              const { lane, ...rest } = item as { lane?: string };
              void lane;
              return rest;
            }),
            size: winners,
            ...extra,
          },
    };
  };
  const qualifierPhase = (advance: number | null, individual = false) => ({
    kind: 'QUALIFIER',
    key: 'qualifiers',
    name: 'Qualifiers',
    stageId: stageId(qualifiers),
    advance,
    ...(individual ? { entrantUnit: 'INDIVIDUAL_PLAYER' } : {}),
  });
  const placement = (
    index: number,
    lane: 'WINNERS' | 'LOSERS',
    seedFrom: number,
    orderWithin: 'GROUP_LABEL' | 'CROSS_GROUP_RANK',
    tier?: string,
  ) => ({
    source: {
      kind: 'PLACEMENT',
      phase: 'groups',
      placement: index,
      orderWithin,
      ...(tier ? { tier } : {}),
    },
    lane,
    seedFrom,
  });
  let stages: StageDraft[];
  let phases: unknown[];
  switch (choices.template) {
    case 'BRACKET': {
      const main = elimination(bracketSize, null, [
        { source: { kind: 'REGISTRATION', count: bracketSize }, lane: 'WINNERS', seedFrom: 1 },
      ]);
      stages = main.stages;
      phases = [main.phase];
      break;
    }
    case 'QUALIFIER_BRACKET': {
      const main = elimination(bracketSize, null, [
        {
          source: { kind: 'RANK_RANGE', phase: 'qualifiers', from: 1, to: bracketSize },
          lane: 'WINNERS',
          seedFrom: 1,
        },
      ]);
      stages = [qualifiers, ...main.stages];
      phases = [qualifierPhase(bracketSize), main.phase];
      break;
    }
    case 'QUALIFIER_GROUPS_BRACKET': {
      const total = groupCount * groupSize;
      const advancing = groupCount * choices.advancePerGroup;
      const main = elimination(
        advancing,
        null,
        Array.from({ length: choices.advancePerGroup }, (_, index) =>
          placement(index + 1, 'WINNERS', index * groupCount + 1, 'CROSS_GROUP_RANK'),
        ),
      );
      const groups = stage('Group stage', 'GROUPS', 9);
      stages = [qualifiers, groups, ...main.stages];
      phases = [
        qualifierPhase(total),
        {
          kind: 'GROUPS',
          key: 'groups',
          name: 'Group stage',
          stageId: stageId(groups),
          entries: [
            {
              source: { kind: 'RANK_RANGE', phase: 'qualifiers', from: 1, to: total },
              seedFrom: 1,
            },
          ],
          tiers: [{ key: 'all', name: 'All', seedFrom: 1, seedTo: total, groupCount, groupSize }],
          draw: 'SEEDED',
        },
        main.phase,
      ];
      break;
    }
    case 'DIRECT_ENTRY_GROUPS': {
      const { directSeeds } = choices;
      const first = directSeeds + 1;
      const total = groupCount * groupSize;
      const winners = directSeeds + groupCount;
      const losers = groupCount * (groupSize - 2);
      const main = elimination(
        winners,
        losers,
        [
          {
            source: { kind: 'RANK_RANGE', phase: 'qualifiers', from: 1, to: directSeeds },
            lane: 'WINNERS',
            seedFrom: 1,
          },
          placement(1, 'WINNERS', first, 'CROSS_GROUP_RANK'),
          ...Array.from({ length: groupSize - 2 }, (_, index) =>
            placement(index + 2, 'LOSERS', winners + index * groupCount + 1, 'CROSS_GROUP_RANK'),
          ),
        ],
        { rematch: 'AVOID_SAME_GROUP' },
      );
      const groups = stage('Group stage', 'GROUPS', 9);
      stages = [qualifiers, groups, ...main.stages];
      phases = [
        qualifierPhase(directSeeds + total),
        {
          kind: 'GROUPS',
          key: 'groups',
          name: 'Group stage',
          stageId: stageId(groups),
          entries: [
            {
              source: {
                kind: 'RANK_RANGE',
                phase: 'qualifiers',
                from: first,
                to: directSeeds + total,
              },
              seedFrom: first,
            },
          ],
          tiers: [
            {
              key: 'all',
              name: 'All',
              seedFrom: first,
              seedTo: directSeeds + total,
              groupCount,
              groupSize,
            },
          ],
          draw: 'RANDOM_BY_POT',
          forfeitMapDifference: 'IGNORE',
        },
        main.phase,
      ];
      break;
    }
    case 'TIERED_GROUPS': {
      const { directSeeds } = choices;
      const perTier = groupCount * groupSize;
      const upperFrom = directSeeds + 1;
      const lowerFrom = upperFrom + perTier;
      const winners = directSeeds + groupCount * 2;
      const main = elimination(winners, winners, [
        {
          source: { kind: 'RANK_RANGE', phase: 'qualifiers', from: 1, to: directSeeds },
          lane: 'WINNERS',
          seedFrom: 1,
        },
        placement(1, 'WINNERS', upperFrom, 'GROUP_LABEL', 'upper'),
        placement(2, 'WINNERS', upperFrom + groupCount, 'GROUP_LABEL', 'upper'),
        placement(3, 'LOSERS', winners + 1, 'GROUP_LABEL', 'upper'),
        placement(4, 'LOSERS', winners + groupCount + 1, 'GROUP_LABEL', 'upper'),
        placement(1, 'LOSERS', winners + groupCount * 2 + 1, 'GROUP_LABEL', 'lower'),
        placement(2, 'LOSERS', winners + groupCount * 3 + 1, 'GROUP_LABEL', 'lower'),
      ]);
      const groups = stage('Group stage', 'GROUPS', 9);
      stages = [qualifiers, groups, ...main.stages];
      phases = [
        qualifierPhase(directSeeds + perTier * 2),
        {
          kind: 'GROUPS',
          key: 'groups',
          name: 'Group stage',
          stageId: stageId(groups),
          entries: [
            {
              source: {
                kind: 'RANK_RANGE',
                phase: 'qualifiers',
                from: upperFrom,
                to: directSeeds + perTier * 2,
              },
              seedFrom: upperFrom,
            },
          ],
          tiers: [
            {
              key: 'upper',
              name: 'Upper tier',
              seedFrom: upperFrom,
              seedTo: lowerFrom - 1,
              groupCount,
              groupSize,
            },
            {
              key: 'lower',
              name: 'Lower tier',
              seedFrom: lowerFrom,
              seedTo: lowerFrom + perTier - 1,
              groupCount,
              groupSize,
            },
          ],
          draw: 'RANDOM_BY_POT',
          labels: 'LETTERS',
          labelOrder: 'SOURCE_AGGREGATE',
        },
        main.phase,
      ];
      break;
    }
    case 'DRAFT': {
      const main = elimination(bracketSize, null, [
        {
          source: { kind: 'ALL', phase: 'formation' },
          lane: 'WINNERS',
          seedFrom: 1,
        },
      ]);
      stages = [qualifiers, ...main.stages];
      phases = [
        qualifierPhase(null, true),
        {
          kind: 'TEAM_FORMATION',
          key: 'formation',
          name: 'Team formation',
          entries: [{ source: { kind: 'ALL', phase: 'qualifiers' }, seedFrom: 1 }],
          method: choices.formation,
          teamCount: bracketSize,
          rosterSize: choices.rosterSize,
          captains: 'MANUAL',
          teamSeeding: 'AVERAGE_PLAYER_SEED',
          ...(choices.formation === 'AUCTION'
            ? {
                auction: {
                  budget: 4000,
                  minimumRaise: 100,
                  lotOrder: 'SEED',
                  reserveFillPrice: 0,
                },
              }
            : {}),
        },
        main.phase,
      ];
      break;
    }
  }
  return {
    stages,
    plan: formatPlanSchema.parse({ version: FORMAT_PLAN_VERSION, phases }),
    teamMode: teamSize === 1 ? 'HEAD_TO_HEAD' : 'TEAM_VS',
    entrantFormat: choices.template === 'DRAFT' || teamSize === 1 ? 'INDIVIDUAL' : 'TEAM',
  };
}

export function poolPlanSlots(pool: PoolCounts) {
  return POOL_CATEGORIES.flatMap((category) =>
    Array.from({ length: pool[category] }, (_, index) => ({
      name: category === 'TB' && pool.TB === 1 ? 'TB' : `${category}${index + 1}`,
      category,
    })),
  );
}
