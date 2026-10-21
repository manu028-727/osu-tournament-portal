import { describe, expect, it } from 'vitest';
import { qualifierPolicySchema } from '../src/lib/qualifier-policy';
import {
  calculateQualifierStandings,
  canonicalQualifierJson,
  qualifierMapStatistics,
  qualifierSourceHash,
  resolveQualifierTies,
  type QualifierSeedingInput,
} from '../src/lib/qualifier-seeding';

function fixture(values: number[][][], policy: object = {}): QualifierSeedingInput {
  return {
    tournamentId: 'tournament',
    stageId: 'qualifiers',
    gameplayScoring: 'SCORE_V2',
    policy: qualifierPolicySchema.parse(policy),
    maps: values[0][0].map((_, i) => ({ slotName: `NM${i + 1}`, beatmapId: i + 1 })),
    participants: values.map((_, i) => ({
      id: `team-${i + 1}`,
      name: `Entrant ${i + 1}`,
      roster: [i + 1],
    })),
    scores: values.flatMap((runs, i) =>
      runs.flatMap((maps, run) =>
        maps.map((value, m) => ({
          id: `${i + 1}-${run + 1}-${m + 1}`,
          lobbyId: `room-${i + 1}`,
          participantId: `team-${i + 1}`,
          osuId: i + 1,
          slotName: `NM${m + 1}`,
          run: run + 1,
          raw: value,
          adjusted: value,
          mods: [],
          actualScoring: 'SCORE_V2',
          representation: 'LEGACY',
          source: 'MANUAL',
          gameId: null,
          verified: true,
        })),
      ),
    ),
  };
}
const row = (result: ReturnType<typeof calculateQualifierStandings>, id = 'team-1') =>
  result.rows.find((r) => r.participantId === id)!;
const hasIssue = (result: ReturnType<typeof calculateQualifierStandings>, code: string) =>
  result.issues.some((i) => i.code === code);

describe('qualifier policy', () => {
  it('defaults to raw total once without an editable gameplay scoring field', () => {
    expect(qualifierPolicySchema.parse({})).toEqual({
      method: 'RAW_SCORE',
      runs: 1,
      runSelection: 'BEST_PER_MAP',
      requiredPlayers: 1,
      teamAggregation: 'SUM',
      rawAggregation: 'TOTAL',
    });
    expect(qualifierPolicySchema.safeParse({ gameplayScoring: 'SCORE_V1' }).success).toBe(false);
  });
  it('rejects Run 2 with one playthrough and invalid required counts', () => {
    expect(qualifierPolicySchema.safeParse({ runs: 1, runSelection: 'SECOND_RUN' }).success).toBe(
      false,
    );
    expect(qualifierPolicySchema.safeParse({ requiredPlayers: 0 }).success).toBe(false);
  });
});

describe('qualifier math', () => {
  it('calculates raw totals and averages from persisted adjusted values', () => {
    const input = fixture([[[10, 20]], [[20, 30]]]);
    input.scores[0].adjusted = 15;
    expect(row(calculateQualifierStandings(input)).value).toBe(35);
    input.policy.rawAggregation = 'AVERAGE';
    expect(row(calculateQualifierStandings(input)).value).toBe(17.5);
    expect(input.scores[0].raw).toBe(10);
  });
  it('computes sample deviation and cumulative Z without a percentile transformation', () => {
    const result = calculateQualifierStandings(
      fixture([[[10, 30]], [[20, 20]], [[30, 10]]], { method: 'Z_SUM' }),
    );
    expect(result.references.map((r) => r.mean)).toEqual([20, 20]);
    expect(result.references.map((r) => r.sampleDeviation)).toEqual([10, 10]);
    expect(row(result).breakdown.map((b) => b.contribution)).toEqual([-1, 1]);
    expect(result.rows.map((r) => r.value)).toEqual([0, 0, 0]);
    expect(result.rows.every((r) => r.seed === null)).toBe(true);
  });
  it('recalculates the entire cohort after a source correction', () => {
    const input = fixture([[[10]], [[20]], [[30]]], { method: 'Z_SUM' });
    const before = calculateQualifierStandings(input);
    input.scores[0].raw = 50;
    input.scores[0].adjusted = 50;
    const after = calculateQualifierStandings(input);
    expect(row(after, 'team-2').value).not.toBe(row(before, 'team-2').value);
    expect(after.sourceHash).not.toBe(before.sourceHash);
  });
  it('gives identical map scores neutral Z contributions and flags the map', () => {
    const result = calculateQualifierStandings(
      fixture([[[10, 30]], [[10, 20]], [[10, 10]]], { method: 'Z_SUM' }),
    );
    expect(row(result).breakdown[0].contribution).toBe(0);
    expect(hasIssue(result, 'ZERO_DEVIATION')).toBe(true);
    expect(result.canFinalize).toBe(true);
  });
  it('rejects a sample Z cohort with one entrant', () => {
    const result = calculateQualifierStandings(fixture([[[10]]], { method: 'Z_SUM' }));
    expect(row(result).value).toBeNull();
    expect(hasIssue(result, 'INSUFFICIENT_COHORT')).toBe(true);
    expect(result.canFinalize).toBe(false);
  });
  it('independently matches the verified osuplus algebra for positive references', () => {
    const result = calculateQualifierStandings(
      fixture([[[100, 80]], [[50, 40]]], { method: 'MATCH_COST' }),
    );
    expect(row(result).value).toBeCloseTo((2 / (2 + 2)) * (100 / 75 + 80 / 60), 14);
    expect(result.formulaReference?.variant).toBe('OSUPLUS_QUALIFIER_COHORT_V1');
    expect(result.references[0].participantIds).toEqual(['team-1', 'team-2']);
  });
  it('uses the whole qualifier cohort across unrelated lobbies', () => {
    const result = calculateQualifierStandings(
      fixture([[[100]], [[50]]], { method: 'MATCH_COST' }),
    );
    expect(row(result).value).toBeCloseTo(8 / 9, 14);
    expect(row(result, 'team-2').value).toBeCloseTo(4 / 9, 14);
    expect(result.canFinalize).toBe(true);
  });
  it('handles one match-cost entrant without borrowing a lobby baseline', () => {
    expect(
      row(calculateQualifierStandings(fixture([[[100, 80]]], { method: 'MATCH_COST' }))).value,
    ).toBe(1);
  });
  it('keeps incomplete match-cost ratings provisional and participation-weighted', () => {
    const input = fixture([[[100, 100]], [[50, 50]]], { method: 'MATCH_COST' });
    input.scores = input.scores.filter((s) => s.id !== '1-1-2');
    const result = calculateQualifierStandings(input);
    expect(row(result).value).toBeCloseTo((2 / 3) * (100 / 50), 14);
    expect(row(result).seed).toBeNull();
    expect(result.canFinalize).toBe(false);
  });
  it('never replaces zero MC references with invented denominators', () => {
    const result = calculateQualifierStandings(fixture([[[0]], [[0]]], { method: 'MATCH_COST' }));
    expect(hasIssue(result, 'ZERO_REFERENCE')).toBe(true);
    expect(result.rows.every((r) => r.value === null)).toBe(true);
    expect(result.canFinalize).toBe(false);
  });
  it('distinguishes an actual raw zero from a missing score', () => {
    const input = fixture([[[0, 0]], [[10, 10]]]);
    expect(row(calculateQualifierStandings(input)).value).toBe(0);
    input.scores = input.scores.filter((s) => s.id !== '1-1-1');
    const result = calculateQualifierStandings(input);
    expect(row(result).value).toBeNull();
    expect(hasIssue(result, 'INCOMPLETE_POOL')).toBe(true);
  });
  it('warns about ScoreV1 raw-map range bias without converting values', () => {
    const input = fixture([[[100]], [[200]]]);
    input.gameplayScoring = 'SCORE_V1';
    input.scores.forEach((s) => {
      s.actualScoring = 'SCORE_V1';
    });
    const result = calculateQualifierStandings(input);
    expect(row(result).value).toBe(100);
    expect(hasIssue(result, 'SCORE_V1_RANGE_BIAS')).toBe(true);
  });
  it('retains unrounded sample statistics', () => {
    const reference = qualifierMapStatistics('NM1', [
      { id: 'a', score: 1 },
      { id: 'b', score: 2 },
    ]);
    expect(reference.sampleDeviation).toBe(Math.sqrt(0.5));
  });
});

describe('common one/two-run selection pipeline', () => {
  for (const method of ['RAW_SCORE', 'Z_SUM', 'TEAM_AVERAGE', 'MATCH_COST'] as const) {
    it(`${method}: supports one run and all four two-run policies`, () => {
      expect(
        row(calculateQualifierStandings(fixture([[[10, 40]], [[15, 20]], [[20, 10]]], { method })))
          .selectedRun,
      ).toBe(1);
      const input = fixture(
        [
          [
            [10, 40],
            [30, 20],
          ],
          [
            [15, 20],
            [20, 15],
          ],
          [
            [20, 10],
            [20, 10],
          ],
        ],
        { method, runs: 2 },
      );
      expect(row(calculateQualifierStandings(input)).selected.map((m) => m.score)).toEqual([
        30, 40,
      ]);
      input.policy.runSelection = 'FIRST_RUN';
      expect(row(calculateQualifierStandings(input)).selected.map((m) => m.score)).toEqual([
        10, 40,
      ]);
      input.policy.runSelection = 'SECOND_RUN';
      expect(row(calculateQualifierStandings(input)).selected.map((m) => m.score)).toEqual([
        30, 20,
      ]);
      input.policy.runSelection = 'BEST_COMPLETE_RUN';
      const result = calculateQualifierStandings(input);
      expect(new Set(row(result).selected.map((m) => m.run)).size).toBe(1);
      expect(result.frozenRunReferences).toHaveLength(2);
    });
  }
  for (const method of ['Z_SUM', 'MATCH_COST'] as const)
    it(`${method}: freezes equal-weight entrant references before comparing full runs`, () => {
      const input = fixture(
        [
          [
            [1000, 10],
            [950, 30],
          ],
          [
            [100, 20],
            [100, 20],
          ],
          [
            [200, 25],
            [200, 25],
          ],
        ],
        { method, runs: 2, runSelection: 'BEST_COMPLETE_RUN' },
      );
      const result = calculateQualifierStandings(input);
      expect(result.frozenRunReferences[0].mean).toBe(425);
      expect(result.frozenRunReferences[1].mean).toBeCloseTo(65 / 3);
      expect(row(result).selectedRun).toBe(2);
      expect(row(result).selected.map((m) => m.score)).toEqual([950, 30]);
      expect(result.references[0].mean).toBeCloseTo(1250 / 3);
    });
  it('chooses the first complete run deterministically when comparison values tie', () => {
    const result = calculateQualifierStandings(
      fixture(
        [
          [
            [10, 20],
            [20, 10],
          ],
          [
            [30, 30],
            [30, 30],
          ],
        ],
        { runs: 2, runSelection: 'BEST_COMPLETE_RUN' },
      ),
    );
    expect(row(result).selectedRun).toBe(1);
  });
  it('never fills missing Run 2 scores with Run 1', () => {
    const input = fixture(
      [
        [
          [10, 20],
          [30, 40],
        ],
        [
          [20, 30],
          [40, 50],
        ],
      ],
      { runs: 2, runSelection: 'SECOND_RUN' },
    );
    input.scores = input.scores.filter((s) => s.id !== '1-2-1');
    const result = calculateQualifierStandings(input);
    expect(row(result).selected.map((s) => s.slotName)).toEqual(['NM2']);
    expect(row(result).value).toBeNull();
    expect(result.canFinalize).toBe(false);
  });
});

describe('team aggregation and source safety', () => {
  function teamInput(aggregation: 'SUM' | 'AVERAGE' | 'TOP_N') {
    const input = fixture([[[10, 20]]], {
      method: 'TEAM_AVERAGE',
      requiredPlayers: 2,
      teamAggregation: aggregation,
    });
    input.participants[0].roster = [1, 2, 3];
    input.scores.push(
      ...input.scores.map((s) => ({
        ...s,
        id: `${s.id}-sub`,
        osuId: s.slotName === 'NM1' ? 2 : 3,
        raw: s.raw + 10,
        adjusted: s.raw + 10,
      })),
    );
    return input;
  }
  it('sums required players per map then averages maps, allowing substitutions', () => {
    const result = calculateQualifierStandings(teamInput('SUM'));
    expect(row(result).value).toBe(40);
    expect(row(result).selected.map((m) => m.players.map((p) => p.osuId))).toEqual([
      [2, 1],
      [3, 1],
    ]);
    expect(result.canFinalize).toBe(true);
  });
  it('averages required players before averaging across maps', () => {
    expect(row(calculateQualifierStandings(teamInput('AVERAGE'))).value).toBe(20);
  });
  it('TOP_N sums exactly the top requiredPlayers, preserving all source scores', () => {
    const input = teamInput('TOP_N');
    input.scores.push({
      ...input.scores[0],
      id: 'third-player',
      osuId: 3,
      raw: 100,
      adjusted: 100,
    });
    const result = calculateQualifierStandings(input);
    expect(row(result).selected[0].score).toBe(120);
    expect(result.source.scores).toHaveLength(5);
    expect(row(result).value).toBe(85);
  });
  it('requires the exact player count for SUM and AVERAGE', () => {
    const input = teamInput('SUM');
    input.scores.push({ ...input.scores[0], id: 'third-player', osuId: 3 });
    const result = calculateQualifierStandings(input);
    expect(hasIssue(result, 'INCOMPLETE_RUN')).toBe(true);
    expect(result.canFinalize).toBe(false);
  });
  for (const [code, mutate] of [
    [
      'SCORING_MISMATCH',
      (i: QualifierSeedingInput) => {
        i.scores[0].actualScoring = 'SCORE_V1';
      },
    ],
    [
      'SCORING_MISMATCH',
      (i: QualifierSeedingInput) => {
        i.scores[0].representation = 'STANDARDIZED';
      },
    ],
    [
      'SCORING_MISMATCH',
      (i: QualifierSeedingInput) => {
        i.scores[0].adjusted = NaN;
      },
    ],
    [
      'UNVERIFIED_SCORE',
      (i: QualifierSeedingInput) => {
        i.scores[0].verified = false;
      },
    ],
    [
      'ROSTER_MISMATCH',
      (i: QualifierSeedingInput) => {
        i.scores[0].osuId = 99;
      },
    ],
    [
      'INVALID_RUN',
      (i: QualifierSeedingInput) => {
        i.scores[0].run = 3;
      },
    ],
    [
      'UNKNOWN_MAP',
      (i: QualifierSeedingInput) => {
        i.scores[0].slotName = 'warmup';
      },
    ],
    [
      'DUPLICATE_PLAY',
      (i: QualifierSeedingInput) => {
        i.scores.push({ ...i.scores[0], id: 'duplicate', lobbyId: 'different-room' });
      },
    ],
    [
      'DUPLICATE_GAME',
      (i: QualifierSeedingInput) => {
        i.policy.runs = 2;
        i.scores[0].gameId = 'same-game';
        i.scores.push({ ...i.scores[0], id: 'replayed-event', run: 2 });
      },
    ],
    [
      'DUPLICATE_ROSTER',
      (i: QualifierSeedingInput) => {
        i.participants[1].roster = [1];
      },
    ],
  ] as const)
    it(`blocks finalization for ${code}`, () => {
      const input = fixture([[[10]], [[20]]]);
      mutate(input);
      if (Number.isNaN(input.scores[0].adjusted)) {
        expect(() => calculateQualifierStandings(input)).toThrow('Non-finite');
        return;
      }
      const result = calculateQualifierStandings(input);
      expect(hasIssue(result, code)).toBe(true);
      expect(result.canFinalize).toBe(false);
    });
  it('accepts actual standardized lazer scores and rejects classic display values', () => {
    const input = fixture([[[100]], [[200]]]);
    input.gameplayScoring = 'LAZER';
    input.scores.forEach((s) => {
      s.actualScoring = 'LAZER';
      s.representation = 'STANDARDIZED';
    });
    expect(calculateQualifierStandings(input).canFinalize).toBe(true);
    input.scores[0].representation = 'CLASSIC';
    expect(calculateQualifierStandings(input).canFinalize).toBe(false);
  });
  it('excludes withdrawn entrants from statistical references without deleting their source', () => {
    const input = fixture([[[10]], [[20]], [[1000]]], { method: 'Z_SUM' });
    input.participants[2].eligible = false;
    const result = calculateQualifierStandings(input);
    expect(result.references[0].mean).toBe(15);
    expect(row(result, 'team-3').seed).toBeNull();
    expect(result.source.scores).toHaveLength(3);
  });
});

describe('deterministic snapshots and explicit ties', () => {
  it('has no invented ordering for equal results', () => {
    const result = calculateQualifierStandings(fixture([[[10]], [[10]], [[5]]]));
    expect(row(result).rank).toBe(1);
    expect(row(result).seed).toBeNull();
    expect(row(result, 'team-3').seed).toBe(3);
    expect(result.canFinalize).toBe(false);
    const resolved = resolveQualifierTies(result, ['team-2', 'team-1']);
    expect(resolved.rows.map((r) => r.participantId)).toEqual(['team-2', 'team-1', 'team-3']);
    expect(resolved.rows.map((r) => r.seed)).toEqual([1, 2, 3]);
    expect(resolved.canFinalize).toBe(true);
    expect(() => resolveQualifierTies(result, ['team-1', 'team-1'])).toThrow();
    expect(() => resolveQualifierTies(result, ['team-1'])).toThrow();
  });
  it('is stable across source ordering and property order, and preserves ignored-run provenance', () => {
    const input = fixture(
      [
        [
          [10, 20],
          [20, 30],
        ],
        [
          [30, 40],
          [40, 50],
        ],
      ],
      { runs: 2, runSelection: 'FIRST_RUN' },
    );
    const before = calculateQualifierStandings(input);
    input.participants.reverse();
    input.scores.reverse();
    input.maps.reverse();
    expect(calculateQualifierStandings(input)).toEqual(before);
    const unused = input.scores.find((s) => s.run === 2)!;
    unused.source = 'OSU_API';
    const after = calculateQualifierStandings(input);
    expect(after.sourceHash).not.toBe(before.sourceHash);
    expect(after.rows).toEqual(before.rows);
    expect(qualifierSourceHash({ b: 2, a: 1 })).toBe(qualifierSourceHash({ a: 1, b: 2 }));
    expect(canonicalQualifierJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });
});
