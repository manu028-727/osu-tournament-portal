import { describe, expect, it } from 'vitest';
import { inheritedRules } from '../src/lib/gameplay-scoring';
import { lobbyCommands } from '../src/lib/match-engine';
import { DEFAULT_MATCH_RULES, matchRulesSchema, type MatchRules } from '../src/lib/match-rules';
import { multiplayerProposals } from '../src/lib/multiplayer';
import { organizerMultiplayerGames } from '../src/lib/organizer-multiplayer';
import { qualifierIndividualViolation } from '../src/lib/qualifier-score';
import { qualifierTeamModViolation } from '../src/lib/qualifier-eligibility';
import {
  aggregateScores,
  convertedScore,
  effectiveWinCondition,
  formatMapValue,
  freeModQuotaMet,
  mapWinner,
  playerModViolation,
  type PlayerScore,
} from '../src/lib/score-pipeline';
import type { MatchView } from '../src/lib/matches-types';
import { stageRulePatchSchema } from '../src/lib/stage-workflows-validation';

const rules = (fields: Partial<MatchRules> = {}) =>
  matchRulesSchema.parse({ teamSize: 2, multiplierMode: 'NONE', ...fields });
const accuracyWin = {
  metric: 'ACCURACY',
  teamAggregation: 'AVERAGE',
  applyMultipliers: false,
} as const;
const roster = { A: [1, 2], B: [3, 4] };
const player = (osuId: number, fields: Partial<PlayerScore> = {}): PlayerScore => ({
  osuId,
  side: osuId < 3 ? 'A' : 'B',
  score: 500_000,
  mods: ['NF'],
  ...fields,
});

describe('win condition', () => {
  it('survives inheritance while the Bancho mode follows tournament scoring', () => {
    const inherited = inheritedRules({ winCondition: accuracyWin, teamSize: 2 }, 'SCORE_V2');
    expect(inherited.winCondition).toEqual(accuracyWin);
    expect(inherited.scoreMode).toBe('SCORE_V2');
    expect(inheritedRules(inherited, 'SCORE_V1').winCondition).toEqual(accuracyWin);
  });

  it('decides on team average accuracy, keeping every decimal', () => {
    const result = aggregateScores(
      rules({ winCondition: accuracyWin, enforceNoFail: false }),
      'NM',
      [
        player(1, { accuracy: 98.7643, mods: [] }),
        player(2, { accuracy: 91.1111, mods: [] }),
        player(3, { accuracy: 99.9999, score: 900_000, mods: [] }),
        player(4, { accuracy: 89.0, score: 900_000, mods: [] }),
      ],
      roster,
      0,
      0,
    );
    expect(result.scoreA).toBeCloseTo(94.9377, 10);
    expect(result.scoreB).toBeCloseTo(94.49995, 10);
    // Team B's scores are far higher: accuracy alone must decide.
    expect(result.winnerSide).toBe('A');
  });

  it('never multiplies or rounds accuracy, whatever the inherited multiplier settings', () => {
    const inherited = rules({
      winCondition: accuracyWin,
      multiplierMode: 'LEGACY_PRODUCT',
      modMultipliers: { EZ: 2, FL: 1.2 },
    });
    const result = aggregateScores(
      inherited,
      'NM',
      [
        player(1, { accuracy: 50.5, mods: ['NF', 'EZ'] }),
        player(2, { accuracy: 50.25, mods: ['NF', 'FL'] }),
        player(3, { accuracy: 60.25, mods: ['NF'] }),
        player(4, { accuracy: 60.5, mods: ['NF'] }),
      ],
      roster,
      0,
      0,
    );
    expect(result).toEqual({ scoreA: 50.375, scoreB: 60.375, winnerSide: 'B' });
  });

  it('accepts decimal team accuracy from aggregate entry and rejects impossible values', () => {
    const accuracy = rules({ winCondition: accuracyWin });
    expect(aggregateScores(accuracy, 'NM', [], roster, 98.76, 98.75, 'NM1').winnerSide).toBe('A');
    expect(() => aggregateScores(accuracy, 'NM', [], roster, 100.5, 90)).toThrow(
      'between 0 and 100',
    );
  });

  it('requires accuracy evidence instead of inventing it', () => {
    expect(() =>
      aggregateScores(
        rules({ winCondition: accuracyWin }),
        'NM',
        [player(1, { accuracy: 90 }), player(2), player(3, { accuracy: 90 }), player(4)],
        roster,
        0,
        0,
      ),
    ).toThrow('Enter accuracy for every player');
  });

  it('treats floating-point noise as a draw to replay', () => {
    const accuracy = rules({ winCondition: accuracyWin });
    expect(mapWinner(accuracy, 0.1 + 0.2, 0.3)).toBeNull();
    expect(mapWinner(accuracy, 95.00001, 95)).toBe('A');
    expect(() => aggregateScores(accuracy, 'NM', [], roster, 95, 95)).toThrow('replayed');
  });

  it('awards misses to the lower team and combo to the higher', () => {
    const misses = rules({
      winCondition: { metric: 'MISSES', teamAggregation: 'SUM', applyMultipliers: false },
    });
    expect(
      aggregateScores(
        misses,
        'NM',
        [
          player(1, { misses: 1 }),
          player(2, { misses: 2 }),
          player(3, { misses: 0 }),
          player(4, { misses: 4 }),
        ],
        roster,
        0,
        0,
      ),
    ).toEqual({ scoreA: 3, scoreB: 4, winnerSide: 'A' });
    const combo = rules({
      winCondition: { metric: 'COMBO', teamAggregation: 'SUM', applyMultipliers: false },
    });
    expect(
      aggregateScores(
        combo,
        'NM',
        [
          player(1, { maxCombo: 100 }),
          player(2, { maxCombo: 200 }),
          player(3, { maxCombo: 150 }),
          player(4, { maxCombo: 151 }),
        ],
        roster,
        0,
        0,
      ).winnerSide,
    ).toBe('B');
  });

  it('can average team scores with or without mod multipliers', () => {
    const scored = rules({
      multiplierMode: 'UNIVERSAL',
      modMultipliers: { EZ: 2 },
      winCondition: { metric: 'SCORE', teamAggregation: 'AVERAGE', applyMultipliers: true },
    });
    const players = [
      player(1, { score: 100, mods: ['NF', 'EZ'] }),
      player(2, { score: 100 }),
      player(3, { score: 120 }),
      player(4, { score: 120 }),
    ];
    expect(aggregateScores(scored, 'NM', players, roster, 0, 0)).toEqual({
      scoreA: 150,
      scoreB: 120,
      winnerSide: 'A',
    });
    expect(
      aggregateScores(
        rules({ winCondition: { ...scored.winCondition, applyMultipliers: false } }),
        'NM',
        players,
        roster,
        0,
        0,
      ),
    ).toEqual({ scoreA: 100, scoreB: 120, winnerSide: 'B' });
  });

  it('keeps a saved metric expressed through the legacy Bancho mode', () => {
    expect(effectiveWinCondition(rules({ scoreMode: 'ACCURACY' }))).toMatchObject({
      metric: 'ACCURACY',
      teamAggregation: 'SUM',
      legacy: true,
    });
    expect(DEFAULT_MATCH_RULES.winCondition).toEqual({
      metric: 'SCORE',
      teamAggregation: 'SUM',
      applyMultipliers: true,
    });
  });

  it('rejects nonsensical combinations only when explicitly configured', () => {
    expect(
      matchRulesSchema.safeParse({ winCondition: { ...accuracyWin, teamAggregation: 'SUM' } })
        .success,
    ).toBe(false);
    expect(
      matchRulesSchema.safeParse({ winCondition: { ...accuracyWin, applyMultipliers: true } })
        .success,
    ).toBe(false);
    // Saved snapshots must always parse, including ones a validator would now refuse.
    expect(matchRulesSchema.safeParse({ teamSize: 1, freeModRequiredHD: 1 }).success).toBe(true);
  });

  it('exposes the win condition to reviewed stage rule patches', () => {
    expect(stageRulePatchSchema.parse({ winCondition: accuracyWin })).toEqual({
      winCondition: accuracyWin,
    });
    expect(stageRulePatchSchema.safeParse({ scoreMode: 'SCORE' }).success).toBe(false);
  });

  it('shows decimals without inventing them on whole scores', () => {
    expect(formatMapValue(98.76434567, 'en-GB')).toBe('98.7643');
    expect(formatMapValue(1234567, 'en-GB')).toBe('1,234,567');
  });
});

describe('multiplayer evidence', () => {
  const game = {
    id: 9,
    beatmap_id: 1,
    start_time: '2026-10-01T10:00:00+00:00',
    end_time: '2026-10-01T10:05:00+00:00',
    mode: 'osu',
    scoring_type: 'scorev2',
    team_type: 'team-vs',
    mods: ['RX'],
    scores: [
      { user_id: 1, score: 100, max_combo: 1, accuracy: 0.9876, mods: [], match: { team: 'red' } },
      { user_id: 2, score: 100, max_combo: 1, accuracy: 0.9, mods: [], match: { team: 'red' } },
      { user_id: 3, score: 900, max_combo: 9, accuracy: 0.95, mods: [], match: { team: 'blue' } },
      { user_id: 4, score: 900, max_combo: 9, accuracy: 0.9, mods: [], match: { team: 'blue' } },
    ],
  };
  const match = (fields: Partial<MatchRules>) =>
    ({
      multiplayerId: 5,
      startedAt: '2026-01-01T00:00:00+00:00',
      rules: inheritedRules({ teamSize: 2, multiplierMode: 'NONE', ...fields }, 'SCORE_V2'),
      participants: {
        A: { members: [{ osuId: 1 }, { osuId: 2 }] },
        B: { members: [{ osuId: 3 }, { osuId: 4 }] },
      },
      poolRevision: { slots: [{ beatmapId: 1, name: 'NM1', category: 'NM' }] },
    }) as unknown as MatchView;
  const relaxAccuracy = {
    winCondition: accuracyWin,
    requiredMods: ['RX' as const],
    enforceNoFail: false,
  };

  it('derives an accuracy winner from a ScoreV2 Relax lobby', () => {
    const { proposals, rejected } = multiplayerProposals(
      { match: { id: 5 }, events: [{ game }] },
      match(relaxAccuracy),
    );
    expect(rejected).toEqual([]);
    expect(proposals[0].winnerSide).toBe('A');
    expect(proposals[0].scoreA).toBeCloseTo(94.38, 8);
    expect(proposals[0].scoreB).toBeCloseTo(92.5, 8);
    // Raw score stays evidence rather than being replaced by the metric.
    expect(proposals[0].players[0]).toMatchObject({ score: 100, mods: ['RX'] });
    expect(proposals[0].players[0].accuracy).toBeCloseTo(98.76, 8);
  });

  it('decides a reviewed import the same way as live capture', () => {
    const { games } = organizerMultiplayerGames(
      [
        {
          proposal: null,
          evidence: {
            eventId: 1,
            gameId: '9',
            beatmapId: 1,
            slotName: 'NM1',
            startTime: game.start_time,
            endTime: game.end_time,
            mode: 'osu',
            scoringType: 'scorev2',
            teamType: 'team-vs',
            mods: ['RX'],
            scores: game.scores,
            issue: null,
          },
        },
      ] as never,
      match(relaxAccuracy),
    );
    expect(games[0].proposal?.winnerSide).toBe('A');
    expect(games[0].proposal?.scoreA).toBeCloseTo(94.38, 8);
  });

  it('rejects a lobby played without a mod every player must use', () => {
    const { proposals, rejected } = multiplayerProposals(
      { match: { id: 5 }, events: [{ game: { ...game, mods: [] } }] },
      match(relaxAccuracy),
    );
    expect(proposals).toEqual([]);
    expect(rejected[0]).toContain('required mod');
  });

  it('still rejects a lobby scoring differently from the frozen Bancho mode', () => {
    const { rejected } = multiplayerProposals(
      { match: { id: 5 }, events: [{ game: { ...game, scoring_type: 'score' } }] },
      match(relaxAccuracy),
    );
    expect(rejected[0]).toContain('scoring does not match');
  });
});

describe('mods and requirements', () => {
  it('keeps the original FreeMod counting when no quotas are configured', () => {
    const legacy = rules();
    expect(freeModQuotaMet(legacy, 'FM', [['HD'], ['HR']])).toBe(true);
    expect(freeModQuotaMet(legacy, 'FM', [['EZ'], ['HD', 'HR']])).toBe(true);
    // HDHR fills only the HR requirement, and FL alone never counted.
    expect(freeModQuotaMet(legacy, 'FM', [['HD', 'HR'], ['HR']])).toBe(false);
    expect(freeModQuotaMet(legacy, 'FM', [['FL'], ['HR']])).toBe(false);
    expect(freeModQuotaMet(legacy, 'NM', [[], []])).toBe(true);
  });

  it('lets a tournament define what satisfies each requirement', () => {
    const configured = rules({
      freeModQuotas: [
        { label: 'HR', min: 1, satisfiedBy: ['HR'] },
        { label: 'HD', min: 1, satisfiedBy: ['HD', 'EZ', 'FL'] },
      ],
    });
    expect(freeModQuotaMet(configured, 'FM', [['FL'], ['HR']])).toBe(true);
    expect(freeModQuotaMet(configured, 'FM', [['HD', 'HR'], ['HR']])).toBe(false);
    expect(
      qualifierTeamModViolation(configured, 'FM', [{ mods: ['EZ', 'HD'] }, { mods: ['HD', 'HR'] }]),
    ).toBeNull();
  });

  it('rejects requirements a team could never meet', () => {
    expect(
      matchRulesSchema.safeParse({
        teamSize: 1,
        freeModQuotas: [
          { label: 'HR', min: 1, satisfiedBy: ['HR'] },
          { label: 'HD', min: 1, satisfiedBy: ['HD'] },
        ],
      }).success,
    ).toBe(false);
    expect(matchRulesSchema.safeParse({ teamSize: 1, freeModQuotas: [] }).success).toBe(true);
  });

  it('enforces mods required on every map, in matches and qualifiers alike', () => {
    const relax = rules({ requiredMods: ['RX'], enforceNoFail: false });
    expect(playerModViolation(relax, 'NM', [])).toBe('REQUIRED_MOD');
    expect(playerModViolation(relax, 'NM', ['RX'])).toBeNull();
    expect(qualifierIndividualViolation(relax, {}, 'NM', { mods: [] })).toBe(
      'A required mod is missing.',
    );
    expect(qualifierIndividualViolation(relax, {}, 'NM', { mods: ['RX'] })).toBeNull();
    expect(matchRulesSchema.safeParse({ requiredMods: ['RX'], enforceNoFail: true }).success).toBe(
      false,
    );
  });

  it('allows optional mods on one category without loosening the required ones', () => {
    const relax = rules({
      requiredMods: ['RX'],
      enforceNoFail: false,
      categoryOptionalMods: { DT: ['HD'] },
    });
    expect(qualifierIndividualViolation(relax, {}, 'DT', { mods: ['RX', 'DT', 'HD'] })).toBeNull();
    expect(qualifierIndividualViolation(relax, {}, 'DT', { mods: ['RX', 'DT'] })).toBeNull();
    expect(qualifierIndividualViolation(relax, {}, 'DT', { mods: ['RX', 'HD'] })).toContain(
      'differ from',
    );
  });

  it('restricts a category to its allowed mods', () => {
    const allowed = rules({ categoryAllowedMods: { TB: ['HD', 'HR', 'EZ', 'FL'] } });
    expect(playerModViolation(allowed, 'TB', ['NF', 'FL'])).toBeNull();
    expect(playerModViolation(allowed, 'TB', ['NF', 'DT'])).toBe('CATEGORY_MOD');
  });

  it('does not let a required mod change the multiplier lookup', () => {
    const relax = rules({
      requiredMods: ['RX'],
      enforceNoFail: false,
      multiplierMode: 'UNIVERSAL',
      modMultipliers: { EZ: 2 },
    });
    expect(convertedScore(relax, 100, ['RX', 'EZ']).multiplier).toBe(2);
  });

  it('emits Relax and optional-mod lobby commands', () => {
    const relax = rules({
      requiredMods: ['RX'],
      enforceNoFail: false,
      categoryOptionalMods: { DT: ['HD'] },
    });
    const command = (category: string) =>
      lobbyCommands(
        relax,
        'CUP',
        { code: '1', teamA: 'A', teamB: 'B' },
        {
          beatmapId: 1,
          category,
          name: `${category}1`,
        },
      ).mods;
    expect(command('NM')).toBe('!mp mods RX');
    expect(command('HD')).toBe('!mp mods RX HD');
    // With Freemod on, players pick Relax themselves and validation checks they did.
    expect(command('DT')).toBe('!mp mods DT Freemod');
    expect(command('FM')).toBe('!mp mods Freemod');
  });
});
