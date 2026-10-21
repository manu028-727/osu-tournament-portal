import { describe, expect, it } from 'vitest';
import {
  inheritedRules,
  inferLegacyScoring,
  historicalScoring,
  assertScoreRepresentation,
} from '../src/lib/gameplay-scoring';
import { matchRulesSchema } from '../src/lib/match-rules';
import { lobbyCommands } from '../src/lib/match-engine';
describe('canonical tournament gameplay scoring', () => {
  it('configures full-pool qualifier slots without inheriting TeamVs or a fixed lobby size', () => {
    expect(
      lobbyCommands(
        inheritedRules({ teamSize: 2 }, 'SCORE_V2'),
        'TEST',
        { code: 'Q1', teamA: 'Qualifiers', teamB: 'Q1' },
        undefined,
        { qualifierPlayers: 12 },
      ).settings,
    ).toBe('!mp set 0 3 12');
    expect(() =>
      lobbyCommands(
        inheritedRules({}, 'SCORE_V1'),
        'TEST',
        { code: 'Q1', teamA: 'Q', teamB: 'Q' },
        undefined,
        { qualifierPlayers: 17 },
      ),
    ).toThrow('sixteen');
  });
  it.each(['osu', 'taiko', 'fruits', 'mania'])(
    'inherits scoring without changing %s gameplay rules',
    (mode) => {
      const source = matchRulesSchema.parse({ bestOf: 9, teamSize: 1, scoreMode: 'SCORE' });
      const rules = inheritedRules(source, 'SCORE_V2', mode);
      expect(rules).toMatchObject({
        gameMode: mode,
        gameplayScoring: 'SCORE_V2',
        scoreMode: 'SCORE_V2',
        bestOf: 9,
        teamSize: 1,
      });
      expect(source.scoreMode).toBe('SCORE');
    },
  );
  it('uses original ScoreV1 values rather than inventing a million-point normalization', () => {
    expect(() =>
      assertScoreRepresentation('SCORE_V1', 'SCORE_V1', 'LEGACY', 123456789),
    ).not.toThrow();
    const rules = inheritedRules({}, 'SCORE_V1');
    expect(lobbyCommands(rules, 'TEST', { code: '1', teamA: 'A', teamB: 'B' }).settings).toContain(
      ' 0 ',
    );
  });
  it('rejects classic-scaled lazer values and mixed scoring', () => {
    expect(() => assertScoreRepresentation('LAZER', 'LAZER', 'STANDARDIZED', 900000)).not.toThrow();
    expect(() => assertScoreRepresentation('LAZER', 'LAZER', 'CLASSIC', 123456789)).toThrow(
      'standardized',
    );
    expect(() => assertScoreRepresentation('SCORE_V2', 'SCORE_V1', 'LEGACY', 900000)).toThrow(
      'differs',
    );
    const commands = lobbyCommands(inheritedRules({}, 'LAZER'), 'TEST', {
      code: '1',
      teamA: 'A',
      teamB: 'B',
    });
    expect(commands.make).toBe('');
    expect(commands.settings).toBe('');
  });
  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER])(
    'rejects invalid recorded value %s',
    (value) => {
      expect(() => assertScoreRepresentation('SCORE_V2', 'SCORE_V2', 'LEGACY', value)).toThrow();
    },
  );
  it('keeps legacy conflicts unresolved instead of guessing', () => {
    expect(inferLegacyScoring([{ scoreMode: 'SCORE_V2' }, { scoreMode: 'SCORE_V2' }])).toBe(
      'SCORE_V2',
    );
    expect(inferLegacyScoring([{ scoreMode: 'SCORE' }])).toBe('SCORE_V1');
    expect(inferLegacyScoring([{ scoreMode: 'SCORE' }, { scoreMode: 'SCORE_V2' }])).toBeNull();
    expect(inferLegacyScoring([{ scoreMode: 'ACCURACY' }])).toBeNull();
    expect(inferLegacyScoring([{}, null])).toBeNull();
    expect(() => inheritedRules({}, null)).toThrow('review');
    expect(historicalScoring(matchRulesSchema.parse({ scoreMode: 'SCORE' }))).toBe('SCORE_V1');
  });
});
