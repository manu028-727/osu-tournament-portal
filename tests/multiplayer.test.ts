import { describe, expect, it } from 'vitest';
import {
  multiplayerProposals,
  collectMultiplayerPages,
  multiplayerEvidence,
} from '../src/lib/multiplayer';
import { matchRulesSchema } from '../src/lib/match-rules';
import type { MatchView } from '../src/lib/matches-types';
const match = {
  multiplayerId: 10,
  startedAt: '2026-01-01T12:00:00Z',
  rules: matchRulesSchema.parse({ teamSize: 1, freeModRequiredHD: 0, freeModRequiredHR: 0 }),
  participants: { A: { members: [{ osuId: 1 }] }, B: { members: [{ osuId: 2 }] } },
  poolRevision: { slots: [{ name: 'NM1', category: 'NM', beatmapId: 123 }] },
} as unknown as MatchView;
const game = {
  id: 99,
  beatmap_id: 123,
  mode: 'osu',
  scoring_type: 'scorev2',
  team_type: 'team-vs',
  start_time: '2026-01-01T12:05:00Z',
  end_time: '2026-01-01T12:07:00Z',
  mods: ['NF'],
  scores: [
    { user_id: 1, score: 100, max_combo: 10, accuracy: 0.9, mods: [], match: { team: 'red' } },
    { user_id: 2, score: 50, max_combo: 8, accuracy: 0.8, mods: [], match: { team: 'blue' } },
  ],
};
const response = (g: unknown) => ({ match: { id: 10 }, events: [{ game: g }] });
describe('conservative multiplayer proposals', () => {
  it('retains unmatched and incomplete games as evidence without proposing points', () => {
    const games = multiplayerEvidence(
      [
        { id: 1, game: { ...game, beatmap_id: 999 } },
        { id: 2, game: { ...game, id: 100, end_time: null } },
      ],
      match,
    );
    expect(games).toHaveLength(2);
    expect(games[0].evidence.slotName).toBe('');
    expect(games[0].proposal).toBeNull();
    expect(games[1].evidence.endTime).toBeNull();
    expect(games[1].proposal).toBeNull();
  });
  it('paginates through capped history, resumes checkpoints and deduplicates event IDs', async () => {
    const paths: string[] = [],
      load = async (path: string) => {
        paths.push(path);
        const before = Number(new URL(path, 'https://local').searchParams.get('before') || 10);
        return {
          match: { id: 10 },
          first_event_id: 1,
          events: [before - 2, before - 1].filter((id) => id > 0).map((id) => ({ id })),
        };
      };
    const first = await collectMultiplayerPages(10, load, null, 2);
    expect(first.complete).toBe(false);
    expect(first.checkpoint.pending?.before).toBe(6);
    const second = await collectMultiplayerPages(10, load, first.checkpoint, 4);
    expect(second.complete).toBe(true);
    expect(second.checkpoint.latest).toBe(9);
    expect(paths).toContain('matches/10?limit=100&before=6');
    const incremental = await collectMultiplayerPages(10, load, second.checkpoint);
    expect(incremental.complete).toBe(true);
  });
  it('proposes complete, roster-verified scores without mutating a match', () => {
    expect(multiplayerProposals(response(game), match).proposals[0]).toMatchObject({
      gameId: '99',
      slotName: 'NM1',
      scoreA: 100,
      scoreB: 50,
      winnerSide: 'A',
    });
  });
  it('ignores unfinished games', () => {
    expect(multiplayerProposals(response({ ...game, end_time: null }), match).proposals).toEqual(
      [],
    );
  });
  it('rejects warmups, wrong maps, mismatched teams and ties', () => {
    for (const fields of [
      { start_time: '2026-01-01T10:00:00Z' },
      { beatmap_id: 999 },
      { scores: [game.scores[1]] },
      { scores: [game.scores[0], { ...game.scores[1], score: 100 }] },
    ]) {
      const result = multiplayerProposals(response({ ...game, ...fields }), match);
      expect(result.proposals).toEqual([]);
      expect(result.rejected).toHaveLength(1);
    }
  });
  it('rejects mismatched modes, unsupported tag modes and incomplete payloads', () => {
    for (const fields of [{ mode: 'mania' }, { team_type: 'tag-coop' }, { scores: [{}] }])
      expect(multiplayerProposals(response({ ...game, ...fields }), match).proposals).toEqual([]);
  });
  it('uses the configured game mode and combo scoring', () => {
    const custom = {
      ...match,
      rules: { ...match.rules, gameMode: 'mania' as const, scoreMode: 'COMBO' as const },
    };
    expect(
      multiplayerProposals(response({ ...game, mode: 'mania', scoring_type: 'combo' }), custom)
        .proposals[0],
    ).toMatchObject({ scoreA: 10, scoreB: 8 });
  });
});
