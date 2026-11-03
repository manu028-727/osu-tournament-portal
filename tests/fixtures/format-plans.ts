import type { z } from 'zod';
import { formatPlanSchema } from '../../src/lib/format-plan';

// Compatibility cases, not product presets: the application must never import these.
type PlanInput = z.input<typeof formatPlanSchema>;

const qualifier = (advance: number | null, unit?: 'INDIVIDUAL_PLAYER'): PlanInput['phases'][0] => ({
  kind: 'QUALIFIER',
  key: 'qualifiers',
  name: 'Qualifiers',
  stageId: 'stage-qualifiers',
  advance,
  ...(unit ? { entrantUnit: unit } : {}),
});
const topSeeds = (count: number) => ({
  source: { kind: 'RANK_RANGE' as const, phase: 'qualifiers', from: 1, to: count },
  lane: 'WINNERS' as const,
  seedFrom: 1,
});

export const COMPATIBILITY_PLANS = {
  // The attached rules: top 16 by Z-Sum straight into a double-elimination RO16.
  mirCupRulesDocument: {
    version: 1,
    phases: [
      qualifier(16),
      {
        kind: 'DOUBLE_ELIMINATION',
        key: 'main',
        name: 'Main bracket',
        stageId: 'stage-ro16',
        entries: [topSeeds(16)],
        winners: { size: 16, pairing: 'STANDARD' },
      },
    ],
  },
  // The brief's variant. Its routing is unstated, so top two per group advance.
  mirCupBriefVariant: {
    version: 1,
    phases: [
      qualifier(16),
      {
        kind: 'GROUPS',
        key: 'groups',
        name: 'Groups',
        stageId: 'stage-groups',
        entries: [
          { source: { kind: 'RANK_RANGE', phase: 'qualifiers', from: 1, to: 16 }, seedFrom: 1 },
        ],
        tiers: [{ key: 'all', name: 'All', seedFrom: 1, seedTo: 16, groupCount: 4, groupSize: 4 }],
        draw: 'SEEDED',
      },
      {
        kind: 'DOUBLE_ELIMINATION',
        key: 'main',
        name: 'Main bracket',
        stageId: 'stage-qf',
        entries: [
          {
            source: {
              kind: 'PLACEMENT',
              phase: 'groups',
              placement: 1,
              orderWithin: 'CROSS_GROUP_RANK',
            },
            lane: 'WINNERS',
            seedFrom: 1,
          },
          {
            source: {
              kind: 'PLACEMENT',
              phase: 'groups',
              placement: 2,
              orderWithin: 'CROSS_GROUP_RANK',
            },
            lane: 'WINNERS',
            seedFrom: 5,
          },
        ],
        winners: { size: 8, pairing: 'STANDARD' },
      },
    ],
  },
  italianCup: {
    version: 1,
    phases: [
      qualifier(20),
      {
        kind: 'GROUPS',
        key: 'groups',
        name: 'Group stage',
        stageId: 'stage-groups',
        entries: [
          { source: { kind: 'RANK_RANGE', phase: 'qualifiers', from: 5, to: 20 }, seedFrom: 5 },
        ],
        tiers: [{ key: 'all', name: 'All', seedFrom: 5, seedTo: 20, groupCount: 4, groupSize: 4 }],
        draw: 'RANDOM_BY_POT',
        forfeitMapDifference: 'IGNORE',
      },
      {
        kind: 'DOUBLE_ELIMINATION',
        key: 'main',
        name: 'Main bracket',
        stageId: 'stage-qf',
        rematch: 'AVOID_SAME_GROUP',
        entries: [
          topSeeds(4),
          {
            source: {
              kind: 'PLACEMENT',
              phase: 'groups',
              placement: 1,
              orderWithin: 'CROSS_GROUP_RANK',
            },
            lane: 'WINNERS',
            seedFrom: 5,
          },
          {
            source: {
              kind: 'PLACEMENT',
              phase: 'groups',
              placement: 2,
              orderWithin: 'CROSS_GROUP_RANK',
            },
            lane: 'LOSERS',
            seedFrom: 9,
          },
          {
            source: {
              kind: 'PLACEMENT',
              phase: 'groups',
              placement: 3,
              orderWithin: 'CROSS_GROUP_RANK',
            },
            lane: 'LOSERS',
            seedFrom: 13,
          },
        ],
        winners: { size: 8, pairing: 'STANDARD' },
        losers: { size: 8, pairing: 'STANDARD' },
      },
    ],
  },
  oidc: {
    version: 1,
    phases: [
      qualifier(16),
      {
        kind: 'DOUBLE_ELIMINATION',
        key: 'main',
        name: 'Main bracket',
        stageId: 'stage-ro16',
        entries: [topSeeds(16)],
        winners: { size: 16, pairing: 'STANDARD' },
      },
    ],
  },
  draftCup: {
    version: 1,
    phases: [
      qualifier(null, 'INDIVIDUAL_PLAYER'),
      {
        kind: 'TEAM_FORMATION',
        key: 'auction',
        name: 'Captain auction',
        entries: [{ source: { kind: 'ALL', phase: 'qualifiers' }, seedFrom: 1 }],
        method: 'AUCTION',
        teamCount: 8,
        rosterSize: 5,
        captains: 'MANUAL',
        auction: { budget: 4000, minimumRaise: 100, lotOrder: 'RANDOM', reserveFillPrice: 400 },
      },
      {
        kind: 'DOUBLE_ELIMINATION',
        key: 'main',
        name: 'Main bracket',
        stageId: 'stage-qf',
        entries: [
          {
            source: { kind: 'EXPLICIT', phase: 'auction', count: 8 },
            lane: 'WINNERS',
            seedFrom: 1,
          },
        ],
        winners: { size: 8, pairing: 'STANDARD' },
      },
    ],
  },
  owc: {
    version: 1,
    phases: [
      qualifier(40),
      {
        kind: 'GROUPS',
        key: 'groups',
        name: 'Group stage',
        stageId: 'stage-groups',
        entries: [
          { source: { kind: 'RANK_RANGE', phase: 'qualifiers', from: 9, to: 40 }, seedFrom: 9 },
        ],
        tiers: [
          {
            key: 'challengers',
            name: 'Challengers',
            seedFrom: 9,
            seedTo: 24,
            groupCount: 4,
            groupSize: 4,
          },
          {
            key: 'contenders',
            name: 'Contenders',
            seedFrom: 25,
            seedTo: 40,
            groupCount: 4,
            groupSize: 4,
          },
        ],
        draw: 'MANUAL',
        labels: 'LETTERS',
        labelOrder: 'SOURCE_AGGREGATE',
      },
      {
        kind: 'DOUBLE_ELIMINATION',
        key: 'main',
        name: 'Main bracket',
        stageId: 'stage-ro16',
        entries: [
          topSeeds(8),
          ...(
            [
              ['challengers', 1, 'WINNERS', 9],
              ['challengers', 2, 'WINNERS', 13],
              ['challengers', 3, 'LOSERS', 17],
              ['challengers', 4, 'LOSERS', 21],
              ['contenders', 1, 'LOSERS', 25],
              ['contenders', 2, 'LOSERS', 29],
            ] as const
          ).map(([tier, placement, lane, seedFrom]) => ({
            source: {
              kind: 'PLACEMENT' as const,
              phase: 'groups',
              tier,
              placement,
              orderWithin: 'GROUP_LABEL' as const,
            },
            lane,
            seedFrom,
          })),
        ],
        winners: { size: 16, pairing: 'STANDARD' },
        losers: {
          size: 16,
          pairing: [
            [22, 27],
            [19, 30],
            [23, 26],
            [18, 31],
            [21, 28],
            [20, 29],
            [24, 25],
            [17, 32],
          ],
        },
      },
    ],
  },
  // Not any real event: exercises combinations the five formats leave unused.
  novel: {
    version: 1,
    phases: [
      qualifier(null, 'INDIVIDUAL_PLAYER'),
      {
        kind: 'TEAM_FORMATION',
        key: 'draft',
        name: 'Snake draft',
        entries: [{ source: { kind: 'ALL', phase: 'qualifiers' }, seedFrom: 1 }],
        method: 'SNAKE_DRAFT',
        teamCount: 6,
        rosterSize: 4,
        captains: 'TOP_SEEDS',
      },
      {
        kind: 'GROUPS',
        key: 'league',
        name: 'League',
        stageId: 'stage-league',
        entries: [{ source: { kind: 'EXPLICIT', phase: 'draft', count: 6 }, seedFrom: 1 }],
        tiers: [{ key: 'all', name: 'All', seedFrom: 1, seedTo: 6, groupCount: 1, groupSize: 6 }],
        draw: 'SEEDED',
        tiebreakers: ['MATCH_WINS', 'HEAD_TO_HEAD', 'MAP_DIFFERENCE', 'QUALIFIER_SEED'],
      },
      {
        kind: 'SINGLE_ELIMINATION',
        key: 'playoffs',
        name: 'Playoffs',
        stageId: 'stage-playoffs',
        entries: (
          [
            [1, 1],
            [2, 2],
            [3, 3],
            [4, 4],
          ] as const
        ).map(([placement, seedFrom]) => ({
          source: {
            kind: 'PLACEMENT' as const,
            phase: 'league',
            placement,
            orderWithin: 'CROSS_GROUP_RANK' as const,
          },
          seedFrom,
        })),
        size: 4,
        thirdPlace: true,
        reseed: 'EACH_ROUND',
      },
    ],
  },
} satisfies Record<string, PlanInput>;
