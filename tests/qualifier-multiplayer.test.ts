import { describe, expect, it } from 'vitest';
import { qualifierGameProposals } from '../src/lib/qualifier-multiplayer';
import { inheritedRules } from '../src/lib/gameplay-scoring';
import type { QualifierView } from '../src/lib/qualifiers-types';
const lobby = {
  rules: inheritedRules({ teamSize: 1 }, 'SCORE_V2'),
  participants: [{ id: 'team', members: [{ osuId: 10 }] }],
  poolRevision: { slots: [{ name: 'NM1', beatmapId: 123 }] },
  events: [
    { kind: 'qualifier.status', data: { command: 'START' }, createdAt: '2026-10-21T12:00:00Z' },
  ],
} as unknown as QualifierView;
const game = {
  id: 1,
  beatmap_id: 123,
  start_time: '2026-10-21T12:01:00Z',
  end_time: '2026-10-21T12:03:00Z',
  mode: 'osu',
  scoring_type: 'scorev2',
  mods: ['NF'],
  scores: [{ user_id: 10, score: 0, mods: [] }],
};
describe('reviewed qualifier multiplayer capture', () => {
  it('preserves real zero values, deduplicates API events and never invents participants', () => {
    const output = qualifierGameProposals([{ game }, { game }], lobby);
    expect(output.proposals).toHaveLength(1);
    expect(output.proposals[0]).toMatchObject({
      gameId: '1',
      slotName: 'NM1',
      players: [{ osuId: 10, raw: 0, mods: ['NF'] }],
    });
  });
  it.each([
    { scoring_type: 'score' },
    { mode: 'mania' },
    { beatmap_id: 999 },
    { start_time: '2026-10-21T11:00:00Z' },
    { scores: [{ user_id: 11, score: 50, mods: [] }] },
    { scores: [game.scores[0], game.scores[0]] },
  ])('rejects incompatible or unverified game %j', (changes) => {
    const output = qualifierGameProposals([{ game: { ...game, ...changes } }], lobby);
    expect(output.proposals).toEqual([]);
    expect(output.rejected).toHaveLength(1);
  });
  it('does not infer lazer provenance from a legacy scorev2 game', () => {
    const result = qualifierGameProposals([{ game }], {
      ...lobby,
      rules: inheritedRules({}, 'LAZER'),
    });
    expect(result.proposals).toEqual([]);
    expect(result.rejected[0].issue).toContain('lazer');
  });
  it('does not import unfinished games or missing API data as zero', () => {
    expect(
      qualifierGameProposals([{ game: { ...game, end_time: null } }], lobby).proposals,
    ).toEqual([]);
    expect(
      qualifierGameProposals([{ game: { ...game, scores: [] } }], lobby).rejected,
    ).toHaveLength(1);
  });
});
