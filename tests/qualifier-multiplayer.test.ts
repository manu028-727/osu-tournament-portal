import { describe, expect, it } from 'vitest';
import { qualifierGameProposals, qualifierCapturePlan } from '../src/lib/qualifier-multiplayer';
import { qualifierProgress, qualifierCompletion } from '../src/lib/qualifier-progress';
import { qualifierDefaultMods, qualifierScoreViolation } from '../src/lib/qualifier-eligibility';
import { qualifierPolicySchema } from '../src/lib/qualifier-policy';
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
  it('validates fixed category mods and initializes manual inputs from the same rules', () => {
    expect(qualifierScoreViolation(lobby.rules, 'HD', ['NF'])).toBe(
      'Player mods differ from the configured category mods.',
    );
    expect(qualifierScoreViolation(lobby.rules, 'DT', ['NF', 'NC'])).toBeNull();
    expect(qualifierDefaultMods(lobby.rules, 'HR')).toEqual(['NF', 'HR']);
    expect(qualifierScoreViolation(lobby.rules, 'TB', ['NF'])).toBeNull();
  });
  it('retains raw scores and original unsupported mods for individual exclusion', () => {
    const result = qualifierGameProposals(
      [{ game: { ...game, scores: [{ user_id: 10, score: 42, mods: ['AP'] }] } }],
      lobby,
    );
    expect(result.proposals[0].players[0]).toMatchObject({
      raw: 42,
      originalMods: ['NF', 'AP'],
      violation: 'Unsupported mods require manual review.',
    });
  });
  it('keeps valid simultaneous players when another score is unknown, duplicated or malformed', () => {
    const result = qualifierGameProposals(
      [
        {
          game: {
            ...game,
            scores: [
              game.scores[0],
              { user_id: 999, score: 100, mods: [] },
              { user_id: 11, score: 'missing', mods: [] },
            ],
          },
        },
      ],
      lobby,
    );
    expect(result.proposals[0].players).toEqual([{ osuId: 10, raw: 0, mods: ['NF'] }]);
    expect(result.proposals[0].issues).toHaveLength(2);
    expect(result.rejected).toEqual([]);
  });
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
    { beatmap_id: 999 },
    { start_time: '2026-10-21T11:00:00Z' },
    { scores: [{ user_id: 11, score: 50, mods: [] }] },
    { scores: [game.scores[0], game.scores[0]] },
  ])('rejects incompatible or unverified game %j', (changes) => {
    const output = qualifierGameProposals([{ game: { ...game, ...changes } }], lobby);
    expect(output.proposals).toEqual([]);
    expect(output.rejected).toHaveLength(1);
  });
  it.each([{ scoring_type: 'score' }, { mode: 'mania' }])(
    'preserves an incompatible observed performance %j with an explicit violation',
    (changes) => {
      const result = qualifierGameProposals([{ game: { ...game, ...changes } }], lobby);
      expect(result.proposals[0].players[0]).toMatchObject({
        raw: 0,
        violation: 'Gameplay mode or scoring differs from the session snapshot.',
      });
      expect(result.rejected).toEqual([]);
    },
  );
  it('does not infer lazer provenance from a legacy scorev2 game', () => {
    const result = qualifierGameProposals([{ game }], {
      ...lobby,
      rules: inheritedRules({}, 'LAZER'),
    });
    expect(result.proposals).toEqual([]);
    expect(result.rejected[0].issue).toContain('lazer');
  });
  it('recognizes exact audited imported games before the website start without exempting live games', () => {
    const old = { ...game, start_time: '2026-10-21T11:00:00Z' };
    const imported = {
      ...lobby,
      policy: qualifierPolicySchema.parse({ runs: 2 }),
      events: [
        ...lobby.events,
        ...[1, 2].map((id) => ({
          kind: 'qualifier.source.imported',
          data: { multiplayerId: 20, gameId: String(id), ignored: false },
        })),
      ],
      games: [1, 2].map((id) => ({
        multiplayerId: 20,
        gameId: String(id),
        status: 'PENDING',
        run: null,
        evidence: { game: { ...old, id } },
      })),
    } as unknown as QualifierView;
    expect(qualifierCapturePlan(imported).games.map((row) => [row.run, row.issue])).toEqual([
      [1, null],
      [2, null],
    ]);
    expect(
      qualifierGameProposals([{ game: old }], imported, { multiplayerId: 20 }).proposals,
    ).toHaveLength(1);
    for (const multiplayerId of [undefined, 21]) {
      const result = qualifierGameProposals([{ game: old }], imported, { multiplayerId });
      expect(result.proposals).toEqual([]);
      expect(result.rejected[0].issue).toContain('predates');
    }
    expect(
      qualifierGameProposals([{ game: { ...old, id: 3 } }], imported, { multiplayerId: 20 })
        .rejected[0].issue,
    ).toContain('predates');
  });
  it('does not import unfinished games or missing API data as zero', () => {
    expect(
      qualifierGameProposals([{ game: { ...game, end_time: null } }], lobby).proposals,
    ).toEqual([]);
    expect(
      qualifierGameProposals([{ game: { ...game, scores: [] } }], lobby).rejected,
    ).toHaveLength(1);
  });
  it('counts the first game by default and excludes only the requested number of warmups', () => {
    expect(qualifierGameProposals([{ game }], lobby, { historical: true }).proposals).toHaveLength(
      1,
    );
    expect(
      qualifierGameProposals([{ game }], lobby, { historical: true, warmups: 1 }).proposals,
    ).toHaveLength(0);
    const scores = [...game.scores, { user_id: 99, score: 70, mods: [] }];
    expect(
      qualifierGameProposals([{ game: { ...game, scores } }], lobby, { excludePlayers: [99] })
        .proposals[0].players,
    ).toHaveLength(1);
  });
  it('tracks the whole shared pool for every team and leaves missing scores missing', () => {
    const session = {
      ...lobby,
      policy: qualifierPolicySchema.parse({ requiredPlayers: 2, runs: 2 }),
      participants: [
        { id: 'a', members: [{ osuId: 10 }, { osuId: 11 }] },
        { id: 'b', members: [{ osuId: 12 }, { osuId: 13 }] },
      ],
      scores: [
        { osuId: 10, slotName: 'NM1', run: 1, adjusted: 0 },
        { osuId: 11, slotName: 'NM1', run: 1, adjusted: 100 },
        { osuId: 12, slotName: 'NM1', run: 1, adjusted: 200 },
      ],
    } as unknown as QualifierView;
    expect(
      qualifierProgress({ ...session, participants: [] }).every((item) => !item.complete),
    ).toBe(true);
    const progress = qualifierProgress(session);
    expect(progress).toHaveLength(2);
    expect(progress[0].teams.map((team) => [team.complete, team.value])).toEqual([
      [true, 100],
      [false, null],
    ]);
    expect(progress[1].complete).toBe(false);
    expect(qualifierCompletion(session).blockers).toHaveLength(1);
  });
  it('infers complete runs across rooms while flagging retries and excess performances', () => {
    const session = {
      ...lobby,
      policy: qualifierPolicySchema.parse({ runs: 2 }),
      games: [1, 2, 3].map((id, index) => ({
        id: `row${id}`,
        multiplayerId: id === 1 ? 20 : 21,
        gameId: String(id),
        evidence: { game: { ...game, id, start_time: `2026-10-21T12:0${index + 1}:00Z` } },
        status: 'PENDING',
        run: null,
      })),
    } as unknown as QualifierView;
    const plan = qualifierCapturePlan(session);
    expect(plan.games.map((row) => row.run)).toEqual([1, 2, null]);
    expect(plan.games[2].issue).toContain('exceeds');
    const retry = qualifierCapturePlan({
      ...session,
      poolRevision: {
        ...session.poolRevision,
        slots: [
          ...session.poolRevision.slots,
          { ...session.poolRevision.slots[0], name: 'NM2', beatmapId: 124 },
        ],
      },
    });
    expect(retry.games[1].issue).toContain('retry');
  });
});
