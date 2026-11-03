import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateCompetition, recalculateCompetition } from '../src/lib/competition-engine';
import { groupResultsHash, resolvedGroupSeeds } from '../src/lib/competition-groups';
import type { CompetitionNode, CompetitionRound } from '../src/lib/competition-types';
import { inheritedRules } from '../src/lib/gameplay-scoring';
import { aggregateScores, convertedScore, lobbyCommands } from '../src/lib/match-engine';
import { DEFAULT_MATCH_RULES, matchRulesSchema } from '../src/lib/match-rules';
import { DEFAULT_QUALIFIER_POLICY, qualifierPolicySchema } from '../src/lib/qualifier-policy';
import { qualifierEffectiveScore } from '../src/lib/qualifier-score';
import {
  calculateQualifierStandings,
  LEGACY_QUALIFIER_CALCULATION_VERSION,
  PREVIOUS_QUALIFIER_CALCULATION_VERSION,
  QUALIFIER_CALCULATION_VERSION,
  type QualifierSeedingInput,
} from '../src/lib/qualifier-seeding';

// These values were captured from `b974d8c`, before the format engine existed. Saved
// standings and group sources compare against these hashes when a bracket starts, so
// a change here can block live tournaments at deploy. Never update one to make a test
// pass: keep the old witness reproducible and add a new version beside it.
const sha = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

const qualifierInput = (
  policy: Record<string, unknown>,
  requiredPlayers = 2,
): QualifierSeedingInput => {
  const entrants = [
    { id: 'team-a', name: 'A', roster: [11, 12], base: 900_000 },
    { id: 'team-b', name: 'B', roster: [21, 22], base: 750_000 },
    { id: 'team-c', name: 'C', roster: [31, 32], base: 610_000 },
    { id: 'team-d', name: 'D', roster: [41, 42], base: 480_000 },
  ];
  const maps = [
    { slotName: 'NM1', beatmapId: 101 },
    { slotName: 'HD1', beatmapId: 102 },
    { slotName: 'FM1', beatmapId: 103 },
  ];
  return {
    tournamentId: 'witness',
    stageId: 'stage',
    gameplayScoring: 'SCORE_V2',
    policy: qualifierPolicySchema.parse({ requiredPlayers, ...policy }),
    maps,
    participants: entrants.map(({ id, name, roster }) => ({ id, name, roster })),
    scores: entrants.flatMap((entrant, e) =>
      maps.flatMap((map, m) =>
        [1, 2].flatMap((run) =>
          entrant.roster.map((osuId, p) => {
            // Deliberately interleaved so run selection and map order both matter.
            const raw = entrant.base + m * 13_337 * (e % 2 ? -1 : 1) + run * 9_001 * (m - 1) + p;
            return {
              id: `${entrant.id}-${map.slotName}-${run}-${p}`,
              lobbyId: 'lobby',
              participantId: entrant.id,
              osuId,
              slotName: map.slotName,
              run,
              raw,
              adjusted: raw,
              mods: map.slotName === 'HD1' ? ['HD', 'NF'] : ['NF'],
              actualScoring: 'SCORE_V2',
              representation: 'LEGACY',
              source: 'IMPORT',
              gameId: `game-${map.slotName}-${run}`,
              verified: true,
            };
          }),
        ),
      ),
    ),
    context: { witness: true },
    issues: [],
  };
};

describe('qualifier source hash witnesses', () => {
  const methods = ['RAW_SCORE', 'Z_SUM', 'TEAM_AVERAGE', 'MATCH_COST'] as const;
  const selections = ['BEST_PER_MAP', 'BEST_COMPLETE_RUN', 'FIRST_RUN', 'SECOND_RUN'] as const;
  const versions = [
    LEGACY_QUALIFIER_CALCULATION_VERSION,
    PREVIOUS_QUALIFIER_CALCULATION_VERSION,
    QUALIFIER_CALCULATION_VERSION,
  ];

  it('keeps every historical calculation byte-identical', () => {
    const output = Object.fromEntries(
      versions.flatMap((version) =>
        methods.flatMap((method) =>
          selections.map((runSelection) => {
            const result = calculateQualifierStandings(
              qualifierInput({ method, runs: 2, runSelection }),
              version,
            );
            return [
              `${version}|${method}|${runSelection}`,
              [
                result.sourceHash.slice(0, 16),
                sha(result.rows.map((row) => [row.participantId, row.seed, row.value])),
                result.canFinalize,
              ].join(' '),
            ];
          }),
        ),
      ),
    );
    expect(output).toMatchInlineSnapshot(`
      {
        "qualifier-seeding/1|MATCH_COST|BEST_COMPLETE_RUN": "c287cf5e78e69ef3 00e969eecfeca5f6 true",
        "qualifier-seeding/1|MATCH_COST|BEST_PER_MAP": "c9d2087c0fa3bf84 30ee41e85b39b084 true",
        "qualifier-seeding/1|MATCH_COST|FIRST_RUN": "0783c6b1410f84f5 00e969eecfeca5f6 true",
        "qualifier-seeding/1|MATCH_COST|SECOND_RUN": "6181a17f67cd4df8 d388d2cb467b25f1 true",
        "qualifier-seeding/1|RAW_SCORE|BEST_COMPLETE_RUN": "b55893fcebc8a6ef 68a34cea8bf0e876 true",
        "qualifier-seeding/1|RAW_SCORE|BEST_PER_MAP": "196b4cb8eb2bf05c b30554f01fb1f145 true",
        "qualifier-seeding/1|RAW_SCORE|FIRST_RUN": "226c8ec67817ba89 68a34cea8bf0e876 true",
        "qualifier-seeding/1|RAW_SCORE|SECOND_RUN": "1dd1f715f25f0b1d 68a34cea8bf0e876 true",
        "qualifier-seeding/1|TEAM_AVERAGE|BEST_COMPLETE_RUN": "f616c2dfcf8866cb f6887c36cdaf7472 true",
        "qualifier-seeding/1|TEAM_AVERAGE|BEST_PER_MAP": "64bc191b9854f69c f95319bebe3f7cea true",
        "qualifier-seeding/1|TEAM_AVERAGE|FIRST_RUN": "5f73747c5eed7ba6 f6887c36cdaf7472 true",
        "qualifier-seeding/1|TEAM_AVERAGE|SECOND_RUN": "f167a4d4c9dadea0 f6887c36cdaf7472 true",
        "qualifier-seeding/1|Z_SUM|BEST_COMPLETE_RUN": "0d9ec9a309e574e5 678e657d3f5d567d true",
        "qualifier-seeding/1|Z_SUM|BEST_PER_MAP": "80afad74a8d3c529 678e657d3f5d567d true",
        "qualifier-seeding/1|Z_SUM|FIRST_RUN": "26b85be8d541bc32 678e657d3f5d567d true",
        "qualifier-seeding/1|Z_SUM|SECOND_RUN": "67231368468d4673 678e657d3f5d567d true",
        "qualifier-seeding/2|MATCH_COST|BEST_COMPLETE_RUN": "5c3506eb17663ee7 00e969eecfeca5f6 true",
        "qualifier-seeding/2|MATCH_COST|BEST_PER_MAP": "62c6b54bf75ffd56 30ee41e85b39b084 true",
        "qualifier-seeding/2|MATCH_COST|FIRST_RUN": "6029d5d923f4c495 00e969eecfeca5f6 true",
        "qualifier-seeding/2|MATCH_COST|SECOND_RUN": "c9ef71bfc7ba06dc d388d2cb467b25f1 true",
        "qualifier-seeding/2|RAW_SCORE|BEST_COMPLETE_RUN": "8e6f0c22132845bd 68a34cea8bf0e876 true",
        "qualifier-seeding/2|RAW_SCORE|BEST_PER_MAP": "1a6f3c7811e76368 b30554f01fb1f145 true",
        "qualifier-seeding/2|RAW_SCORE|FIRST_RUN": "c5cbd4ee8ba6c11e 68a34cea8bf0e876 true",
        "qualifier-seeding/2|RAW_SCORE|SECOND_RUN": "a02db17692349ad2 68a34cea8bf0e876 true",
        "qualifier-seeding/2|TEAM_AVERAGE|BEST_COMPLETE_RUN": "ddd1f51b237834d6 f6887c36cdaf7472 true",
        "qualifier-seeding/2|TEAM_AVERAGE|BEST_PER_MAP": "13e5b700c5d1e9e5 f95319bebe3f7cea true",
        "qualifier-seeding/2|TEAM_AVERAGE|FIRST_RUN": "47177eb9b649243f f6887c36cdaf7472 true",
        "qualifier-seeding/2|TEAM_AVERAGE|SECOND_RUN": "41168e6a5c71c8c4 f6887c36cdaf7472 true",
        "qualifier-seeding/2|Z_SUM|BEST_COMPLETE_RUN": "96c1948019e224ea 678e657d3f5d567d true",
        "qualifier-seeding/2|Z_SUM|BEST_PER_MAP": "0ddf07a1bcaf5345 678e657d3f5d567d true",
        "qualifier-seeding/2|Z_SUM|FIRST_RUN": "a6940c8a685de47b 678e657d3f5d567d true",
        "qualifier-seeding/2|Z_SUM|SECOND_RUN": "d1106d849c5d3d9c 678e657d3f5d567d true",
        "qualifier-seeding/3|MATCH_COST|BEST_COMPLETE_RUN": "1ec4eff1c6158f97 00e969eecfeca5f6 true",
        "qualifier-seeding/3|MATCH_COST|BEST_PER_MAP": "75bfba2928ea8656 30ee41e85b39b084 true",
        "qualifier-seeding/3|MATCH_COST|FIRST_RUN": "861200a3bffec008 00e969eecfeca5f6 true",
        "qualifier-seeding/3|MATCH_COST|SECOND_RUN": "0cc5915d78c7de51 d388d2cb467b25f1 true",
        "qualifier-seeding/3|RAW_SCORE|BEST_COMPLETE_RUN": "72d9ce02c3237287 68a34cea8bf0e876 true",
        "qualifier-seeding/3|RAW_SCORE|BEST_PER_MAP": "b25750e18acc2b3d b30554f01fb1f145 true",
        "qualifier-seeding/3|RAW_SCORE|FIRST_RUN": "bfcce8920b1af946 68a34cea8bf0e876 true",
        "qualifier-seeding/3|RAW_SCORE|SECOND_RUN": "0037adbe19936e06 68a34cea8bf0e876 true",
        "qualifier-seeding/3|TEAM_AVERAGE|BEST_COMPLETE_RUN": "43af19b06c18f984 f6887c36cdaf7472 true",
        "qualifier-seeding/3|TEAM_AVERAGE|BEST_PER_MAP": "b38ebcc73345876f f95319bebe3f7cea true",
        "qualifier-seeding/3|TEAM_AVERAGE|FIRST_RUN": "65689cd807c7aa37 f6887c36cdaf7472 true",
        "qualifier-seeding/3|TEAM_AVERAGE|SECOND_RUN": "039d448ffdfc2206 f6887c36cdaf7472 true",
        "qualifier-seeding/3|Z_SUM|BEST_COMPLETE_RUN": "b33b6e975300e043 678e657d3f5d567d true",
        "qualifier-seeding/3|Z_SUM|BEST_PER_MAP": "9b4ef2c61b144fa6 678e657d3f5d567d true",
        "qualifier-seeding/3|Z_SUM|FIRST_RUN": "36b7b4b0b2595eff 678e657d3f5d567d true",
        "qualifier-seeding/3|Z_SUM|SECOND_RUN": "3d668bc2e9f1c42b 678e657d3f5d567d true",
      }
    `);
  });

  it('keeps the qualifier policy shape free of new defaults', () => {
    // A defaulted field would enter every saved source hash through the parsed policy.
    expect(DEFAULT_QUALIFIER_POLICY).toEqual({
      method: 'RAW_SCORE',
      runs: 1,
      runSelection: 'BEST_PER_MAP',
      requiredPlayers: 1,
      teamAggregation: 'SUM',
      rawAggregation: 'TOTAL',
    });
  });
});

describe('legacy score interpretation witnesses', () => {
  const legacy = inheritedRules({ teamSize: 2 }, 'SCORE_V2');
  const roster = { A: [1, 2], B: [3, 4] };
  const players = (mods: string[][], values: number[]) =>
    values.map((score, index) => ({
      osuId: index + 1,
      side: index < 2 ? ('A' as const) : ('B' as const),
      score,
      mods: mods[index],
    }));

  it('retains the historical default rule values', () => {
    expect(DEFAULT_MATCH_RULES).toMatchObject({
      scoreMode: 'SCORE_V2',
      multiplierMode: 'LEGACY_PRODUCT',
      modMultipliers: { EZ: 2, EZHD: 2, FL: 1.2 },
      freeModRequiredHD: 1,
      freeModRequiredHR: 1,
      freeModAllowed: ['HD', 'HR', 'EZ', 'FL', 'NF'],
      enforceNoFail: true,
      teamSize: 2,
      bestOf: 11,
      bansPerTeam: 2,
      banOrder: 'ABBA',
      pickOrder: 'ABBA',
    });
  });

  it('converts every multiplier mode the same way', () => {
    const cases = (['LEGACY_PRODUCT', 'UNIVERSAL', 'CUSTOM', 'NONE'] as const).flatMap((mode) =>
      [['NF'], ['EZ', 'NF'], ['EZ', 'HD', 'NF'], ['FL', 'NF'], ['HD', 'FL', 'NF']].map((mods) => {
        const rules = matchRulesSchema.parse({
          ...legacy,
          multiplierMode: mode,
          slotModMultipliers: [{ slot: 'FM1', mods: 'EZ', multiplier: 1.5 }],
        });
        return [mode, mods.join(''), convertedScore(rules, 333_333, mods, 'FM1')];
      }),
    );
    expect(sha(cases)).toMatchInlineSnapshot(`"b9b5cb422f1fd009"`);
  });

  it('aggregates team scores and FreeMod quotas the same way', () => {
    expect(
      aggregateScores(
        legacy,
        'FM',
        players(
          [
            ['HD', 'NF'],
            ['HR', 'NF'],
            ['EZ', 'NF'],
            ['HR', 'NF'],
          ],
          [500_000, 400_000, 300_000, 450_000],
        ),
        roster,
        0,
        0,
        'FM1',
      ),
    ).toEqual({ scoreA: 900_000, scoreB: 1_050_000, winnerSide: 'B' });
    expect(() =>
      aggregateScores(
        legacy,
        'FM',
        players(
          [
            ['HD', 'NF'],
            ['HD', 'NF'],
            ['HD', 'NF'],
            ['HR', 'NF'],
          ],
          [500_000, 400_000, 300_000, 450_000],
        ),
        roster,
        0,
        0,
        'FM1',
      ),
    ).toThrow('The team does not meet the configured FreeMod requirements.');
    expect(() => aggregateScores(legacy, 'NM', [], roster, 5, 5)).toThrow(
      'Tied maps must be replayed before awarding a point.',
    );
  });

  it('normalizes qualifier scores the same way', () => {
    const cases = [
      {},
      { normalization: 'BUILT_IN', multiplierPolicy: 'NONE', rounding: 'FLOOR' },
      { normalization: 'REPORTED', multiplierPolicy: 'RULES', rounding: 'ROUND' },
      { normalization: 'BUILT_IN', multiplierPolicy: 'RULES', rounding: 'NONE' },
    ].flatMap((policy) =>
      [['NF'], ['HD', 'NF'], ['HR', 'NF'], ['DT', 'NF'], ['EZ', 'NF'], ['FL', 'NF']].map((mods) =>
        qualifierEffectiveScore(legacy, qualifierPolicySchema.parse(policy), 654_321, mods, 'NM1'),
      ),
    );
    expect(sha(cases)).toMatchInlineSnapshot(`"d332089bfb5bf160"`);
  });

  it('emits the same lobby commands', () => {
    expect(
      lobbyCommands(legacy, 'CUP', { code: '7', teamA: 'Red', teamB: 'Blue' }, {
        beatmapId: 42,
        category: 'HD',
        name: 'HD1',
      } as never),
    ).toMatchObject({
      make: '!mp make CUP: (Red) vs (Blue)',
      settings: '!mp set 2 3 5',
      map: '!mp map 42 0',
      mods: '!mp mods NF HD',
      start: '!mp start 5',
      timer: '!mp timer 90',
    });
  });
});

const teamIds = (count: number) =>
  Array.from({ length: count }, (_, i) => `team-${String(i + 1).padStart(3, '0')}`);
const planInput = (
  format: 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION' | 'GROUPS',
  count: number,
  extra: { thirdPlace?: boolean; grandFinalReset?: boolean; groupCount?: number } = {},
) => ({
  format,
  teamIds: teamIds(count),
  stageId: 'stage',
  roundStages: {},
  thirdPlace: false,
  grandFinalReset: true,
  groupCount: 1,
  ...extra,
});

describe('generated bracket witnesses', () => {
  // Regenerating a retained position re-reads these plans, so old brackets must keep
  // their original seed placement even after new brackets gain a corrected bye policy.
  it('keeps every generated plan identical', async () => {
    const cases: [string, ReturnType<typeof planInput>][] = [
      ...[2, 3, 5, 8, 12, 16, 32].flatMap((count): [string, ReturnType<typeof planInput>][] => [
        [`SE-${count}`, planInput('SINGLE_ELIMINATION', count)],
        // The library cannot build a third-place match for two entrants.
        ...(count > 2
          ? ([
              [`SE-${count}-third`, planInput('SINGLE_ELIMINATION', count, { thirdPlace: true })],
            ] as [string, ReturnType<typeof planInput>][])
          : []),
        [`DE-${count}`, planInput('DOUBLE_ELIMINATION', count)],
        [`DE-${count}-noreset`, planInput('DOUBLE_ELIMINATION', count, { grandFinalReset: false })],
      ]),
      ['GROUPS-8-2', planInput('GROUPS', 8, { groupCount: 2 })],
      ['GROUPS-12-4', planInput('GROUPS', 12, { groupCount: 4 })],
      ['GROUPS-16-4', planInput('GROUPS', 16, { groupCount: 4 })],
      ['GROUPS-17-4', planInput('GROUPS', 17, { groupCount: 4 })],
    ];
    const output: Record<string, string> = {};
    for (const [name, input] of cases) output[name] = sha(await generateCompetition(input));
    expect(output).toMatchInlineSnapshot(`
      {
        "DE-12": "9c90913fe3ea52f3",
        "DE-12-noreset": "e0a0bea1524b2f98",
        "DE-16": "e30292f0b90d4f52",
        "DE-16-noreset": "b6816248afce5eb9",
        "DE-2": "0a4afc214ba5afbc",
        "DE-2-noreset": "1037ebcaddf5bd44",
        "DE-3": "1831403d34130cc4",
        "DE-3-noreset": "7f9ff4f27f5239f7",
        "DE-32": "2085afbf43898984",
        "DE-32-noreset": "f96fbc898018a881",
        "DE-5": "93b964f7092bcc8d",
        "DE-5-noreset": "b3bfc3ea20edb245",
        "DE-8": "bcba2f3bc46d9747",
        "DE-8-noreset": "1b0347f71bd3cd0b",
        "GROUPS-12-4": "e32708b658f4caf4",
        "GROUPS-16-4": "705558f632124050",
        "GROUPS-17-4": "fb54878e424be321",
        "GROUPS-8-2": "8eedb2df63680f13",
        "SE-12": "8b0304ea880dfc9d",
        "SE-12-third": "e66f0151fcc20624",
        "SE-16": "77b14e68b3db74e3",
        "SE-16-third": "d656fa212bc77c75",
        "SE-2": "e7d8258e3843774c",
        "SE-3": "b4a39ecf1b665e62",
        "SE-3-third": "dfba223960c2c89d",
        "SE-32": "36d8d0a00d60ec97",
        "SE-32-third": "bf1cfc1c7bc12235",
        "SE-5": "3210f1a66a26dcb6",
        "SE-5-third": "1854e0354efe872e",
        "SE-8": "22e0bf79e67ee507",
        "SE-8-third": "8c9a0d5adbab7b5a",
      }
    `);
  });
});

describe('group source witnesses', () => {
  it('keeps group result and source hashes identical', async () => {
    const plan = await generateCompetition(planInput('GROUPS', 8, { groupCount: 2 }));
    const rounds: CompetitionRound[] = plan.rounds.map((round) => ({ ...round, id: round.key }));
    let nodes: CompetitionNode[] = plan.nodes.map((node) => ({
      id: node.key,
      bracketId: 'bracket',
      roundId: node.roundKey,
      key: node.key,
      position: node.position,
      matchNumber: null,
      state: 'WAITING',
      matchId: null,
      match: null,
      slots: node.slots.map((slot) => ({ ...slot, sourceNodeId: null })),
    }));
    nodes = recalculateCompetition(nodes).map((node, index) => {
      const winnerSide = index % 3 === 2 ? ('B' as const) : ('A' as const);
      const [a, b] = node.slots;
      return {
        ...node,
        state: 'COMPLETED',
        match: {
          id: `match-${node.key}`,
          code: `M${index}`,
          matchNumber: index + 1,
          status: 'COMPLETED',
          teamAId: a.teamId,
          teamBId: b.teamId,
          scoreA: winnerSide === 'A' ? 5 : (index + 1) % 5,
          scoreB: winnerSide === 'B' ? 5 : index % 4,
          winnerSide,
          version: 1,
        },
      };
    });
    const entries = teamIds(8).map((teamId, index) => ({
      teamId,
      seed: index + 1,
      status: 'ACTIVE',
    }));
    const resolved = resolvedGroupSeeds(
      {
        id: 'bracket',
        format: 'GROUPS',
        config: { advancePerGroup: 2 },
        rounds,
        entries,
      },
      nodes,
    );
    expect({
      results: groupResultsHash('bracket', nodes, rounds, 2),
      source: resolved.sourceHash,
      seeds: resolved.seeds,
    }).toMatchInlineSnapshot(`
      {
        "results": "89a3845d759c915b67868b1457b4a8e739beed92b5cced2e537bd17392c6bfef",
        "seeds": [
          {
            "seed": 1,
            "teamId": "team-001",
          },
          {
            "seed": 2,
            "teamId": "team-002",
          },
          {
            "seed": 3,
            "teamId": "team-005",
          },
          {
            "seed": 4,
            "teamId": "team-006",
          },
        ],
        "source": "b1aa36ff572b303e9472d0f3b3062c47698b8bb54c2429757a77f709be7f9945",
      }
    `);
  });
});
