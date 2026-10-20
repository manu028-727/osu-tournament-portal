import { describe, it, expect } from 'vitest';
import cases from './fixtures/discord-results.json';
import {
  countryEmoji,
  spreadsheetDiscordResult,
  matchDiscordResult,
  matchPing,
  type SpreadsheetResult,
} from '../src/lib/discord-result';
import type { MatchView } from '../src/lib/matches-types';
import { matchRulesSchema } from '../src/lib/match-rules';
const base: SpreadsheetResult = {
  id: '28',
  stage: 'Finals',
  red: 'Red Team',
  blue: 'Blue Team',
  scoreA: 7,
  scoreB: 4,
  bestOf: 13,
  mp: 'https://osu.ppy.sh/community/matches/123',
  redEmoji: ':red_circle:',
  blueEmoji: ':blue_circle:',
  actions: [],
};
describe('Template AB3 golden output', () => {
  it('generates a confirmed manual-only result without inventing an MP link', () => {
    const m = {
      code: 'manual',
      stage: { name: 'Finals' },
      status: 'COMPLETED',
      rules: matchRulesSchema.parse({ bestOf: 1, bansPerTeam: 0 }),
      participants: { A: { name: 'Red' }, B: { name: 'Blue' } },
      scoreA: 1,
      scoreB: 0,
      forfeitSide: null,
      lobbyUrl: '',
      actions: [],
      results: [],
    } as unknown as MatchView;
    expect(matchDiscordResult(m)).toBe(
      '# __**Finals: Match**__ `manual`\r:first_place: **:red_circle: Red | 1** - 0 | Blue :blue_circle:',
    );
  });
  it('retains the distinct TB Ban wording in native action history', () => {
    const match = {
      code: base.id,
      stage: { name: base.stage },
      status: 'COMPLETED',
      rules: matchRulesSchema.parse({ bestOf: 1, bansPerTeam: 0, draftSequence: ['TB_BAN'] }),
      participants: { A: { name: base.red }, B: { name: base.blue } },
      scoreA: 1,
      scoreB: 0,
      forfeitSide: null,
      lobbyUrl: base.mp,
      actions: [{ kind: 'BAN', side: 'A', slotName: 'TB1', category: 'TB', voided: false }],
      results: [],
    } as unknown as MatchView;
    expect(matchDiscordResult(match)).toContain(':red_circle: tb bans ``TB1``');
  });
  for (const test of cases)
    it(test.name, () => {
      const actual = spreadsheetDiscordResult({ ...base, ...test.changes } as SpreadsheetResult);
      expect(actual).toBe(test.expected);
      expect(Buffer.from(actual)).toEqual(Buffer.from(test.expected));
      expect(actual).not.toContain('\n');
    });
  it('does not announce an unconfirmed winner', () => {
    expect(
      matchDiscordResult({
        code: '1',
        status: 'AWAITING_CONFIRMATION',
        forfeitSide: null,
        lobbyUrl: base.mp,
      } as MatchView),
    ).toBe('Match in Progress');
  });
  it('uses the actual country lookup and leaves unavailable mentions blank', () => {
    expect(countryEmoji('ITALY', 'fallback')).toBe(':flag_it:');
    expect(countryEmoji('Not a country', 'fallback')).toBe('fallback');
    expect(matchPing('Finals', '28', ['123456789123456789', '@not-a-discord-id'])).toBe(
      '<@123456789123456789>\rFinals - Match **28** is starting soon! Invites will be sent shortly!',
    );
  });
});
