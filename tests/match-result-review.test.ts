import { afterEach, describe, expect, it, vi } from 'vitest';
import { signMatchResultReview, verifyMatchResultReview } from '../src/lib/match-result-review';
import { matchActionSchema } from '../src/lib/matches-validation';
import { multiplayerEvidence } from '../src/lib/multiplayer';
import { matchRulesSchema } from '../src/lib/match-rules';
import type { Actor } from '../src/lib/permissions';
import type { MatchView } from '../src/lib/matches-types';
import { organizerMultiplayerGames } from '../src/lib/organizer-multiplayer';
import type { MultiplayerImportGame } from '../src/lib/match-results-contract';

afterEach(() => vi.unstubAllEnvs());

function organizerFixture() {
  const match = {
    rules: matchRulesSchema.parse({ teamSize: 2, enforceNoFail: true, multiplierMode: 'NONE' }),
    participants: {
      A: {
        members: [
          { osuId: 11, username: 'Renamed A' },
          { osuId: 12 },
          { osuId: 13, substitute: true },
        ],
      },
      B: { members: [{ osuId: 21 }, { osuId: 22 }] },
    },
    poolRevision: null,
  } as unknown as MatchView;
  const game: MultiplayerImportGame = {
    proposal: null,
    evidence: {
      eventId: 1,
      gameId: '4',
      beatmapId: 99,
      slotName: '',
      startTime: '2026-10-01T12:00:00Z',
      endTime: '2026-10-01T12:03:00Z',
      mode: 'osu',
      scoringType: 'scorev2',
      teamType: 'team-vs',
      mods: [],
      issue: 'Not in the frozen pool',
      scores: [
        {
          user_id: 11,
          score: 100,
          max_combo: 50,
          accuracy: 0.9,
          mods: [],
          match: { team: 'blue' },
        },
        {
          user_id: 13,
          score: 300,
          max_combo: 100,
          accuracy: 0.95,
          mods: [],
          match: { team: 'blue' },
        },
        {
          user_id: 21,
          score: 150,
          max_combo: 60,
          accuracy: 0.91,
          mods: [],
          match: { team: 'red' },
        },
        {
          user_id: 22,
          score: 200,
          max_combo: 70,
          accuracy: 0.92,
          mods: [],
          match: { team: 'red' },
        },
      ],
    },
  };
  return { match, game };
}
describe('organizer multiplayer roster reconstruction', () => {
  it('uses osu! IDs and substitutes despite reversed colours, missing pool membership or NoFail', () => {
    const { match, game } = organizerFixture();
    const result = organizerMultiplayerGames([game], match);
    expect(result.games[0].proposal).toMatchObject({ scoreA: 400, scoreB: 350, winnerSide: 'A' });
    expect(result.games[0].proposal?.players.map((player) => [player.osuId, player.side])).toEqual([
      [11, 'A'],
      [13, 'A'],
      [21, 'B'],
      [22, 'B'],
    ]);
    expect(result.players.every((player) => !player.ambiguous)).toBe(true);
    expect(game.proposal).toBeNull();
    expect(game.evidence.issue).toBe('Not in the frozen pool');
  });
  it('requires an explicit mapping for unknown or shared identities', () => {
    const { match, game } = organizerFixture();
    (game.evidence.scores[3] as { user_id: number }).user_id = 999;
    expect(organizerMultiplayerGames([game], match).games[0].proposal).toBeNull();
    expect(
      organizerMultiplayerGames([game], match).players.find((player) => player.osuId === 999),
    ).toMatchObject({ side: null, ambiguous: true });
    expect(
      organizerMultiplayerGames([game], match, { '999': 'B' }).games[0].proposal,
    ).toMatchObject({ scoreA: 400, scoreB: 350 });
    match.participants.B.members.push({ ...match.participants.A.members[0] });
    expect(
      organizerMultiplayerGames([game], match, { '999': 'B' }).players.find(
        (player) => player.osuId === 11,
      )?.ambiguous,
    ).toBe(true);
  });
  it('rejects duplicate scores, ties and unsupported scoring rather than inventing points', () => {
    const { match, game } = organizerFixture();
    const duplicate = structuredClone(game);
    duplicate.evidence.scores.push(duplicate.evidence.scores[0]);
    expect(organizerMultiplayerGames([duplicate], match).games[0].evidence.issue).toMatch(
      /duplicated/,
    );
    const tied = structuredClone(game);
    const malformed = structuredClone(game);
    (malformed.evidence.scores[0] as { score: number }).score = 0.5;
    expect(organizerMultiplayerGames([malformed], match).games[0].proposal).toBeNull();
    (tied.evidence.scores[3] as { score: number }).score = 250;
    expect(organizerMultiplayerGames([tied], match).games[0].evidence.issue).toMatch(/Tied/);
    match.rules.gameplayScoring = 'LAZER';
    expect(organizerMultiplayerGames([game], match).games[0].proposal).toBeNull();
  });
});
const actor = { id: 'reviewer', tournamentId: 'tenant-a' } as Actor;
function token(now = 1000) {
  vi.stubEnv('OSU_CLIENT_SECRET', 'synthetic-provider-secret-for-unit-tests');
  return signMatchResultReview(
    {
      actorId: actor.id,
      tournamentId: actor.tournamentId!,
      matchId: 'match-a',
      version: 3,
      complete: true,
      metadata: { id: 123, name: 'Public lobby' },
      games: [],
    },
    now,
  );
}
describe('multiplayer result review witnesses', () => {
  it('allows signed continuation previews while refusing to apply incomplete history', () => {
    token();
    const review = signMatchResultReview(
      {
        actorId: actor.id,
        tournamentId: actor.tournamentId!,
        matchId: 'match-a',
        version: 3,
        complete: false,
        metadata: { id: 123 },
        games: [],
        checkpoint: { latest: 0, pending: { before: 2, target: 0, upper: 10 } },
      },
      1000,
    );
    expect(() => verifyMatchResultReview(review, actor, 'match-a', 3, 2000)).toThrow(/incomplete/);
    expect(
      verifyMatchResultReview(review, actor, 'match-a', 3, 2000, false).checkpoint?.pending?.before,
    ).toBe(2);
  });
  it('binds the source to the actor, tournament, match, version and expiry', () => {
    const signed = token();
    expect(verifyMatchResultReview(signed, actor, 'match-a', 3, 2000).metadata.id).toBe(123);
    for (const [who, id, version, now] of [
      [{ ...actor, id: 'other-user' }, 'match-a', 3, 2000],
      [{ ...actor, tournamentId: 'tenant-b' }, 'match-a', 3, 2000],
      [actor, 'match-b', 3, 2000],
      [actor, 'match-a', 4, 2000],
      [actor, 'match-a', 3, 902000],
    ] as const)
      expect(() => verifyMatchResultReview(signed, who, id, version, now)).toThrow(
        /expired|changed/,
      );
  });
  it('rejects tampered provider evidence and rotated credentials', () => {
    const signed = token(),
      [body, signature] = signed.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    payload.metadata.id = 999;
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`;
    expect(() => verifyMatchResultReview(forged, actor, 'match-a', 3, 2000)).toThrow(/invalid/);
    vi.stubEnv('OSU_CLIENT_SECRET', 'rotated-synthetic-provider-secret');
    expect(() => verifyMatchResultReview(signed, actor, 'match-a', 3, 2000)).toThrow(/invalid/);
  });
  it('requires a review reason, bounded scores and a bounded signed payload', () => {
    expect(
      matchActionSchema.safeParse({
        type: 'match.result.set',
        id: 'm',
        baseVersion: 1,
        scoreA: 2,
        scoreB: -1,
        winnerSide: 'A',
        forfeitSide: null,
        reason: '',
      }).success,
    ).toBe(false);
    expect(
      matchActionSchema.safeParse({
        type: 'match.result.import',
        id: 'm',
        baseVersion: 1,
        token: 'x'.repeat(440001),
        decisions: [],
        reason: 'Review',
      }).success,
    ).toBe(false);
  });
});

it('accepts historical red/blue mappings only through the explicit organizer review path', () => {
  const match = {
    multiplayerId: 123,
    startedAt: null,
    rules: matchRulesSchema.parse({ teamSize: 1, freeModRequiredHD: 0, freeModRequiredHR: 0 }),
    participants: { A: { members: [{ osuId: 1 }] }, B: { members: [{ osuId: 2 }] } },
    poolRevision: { slots: [{ name: 'NM1', category: 'NM', beatmapId: 9 }] },
  } as unknown as MatchView;
  const events = [
    {
      id: 1,
      game: {
        id: 4,
        beatmap_id: 9,
        start_time: '2026-10-01T12:00:00Z',
        end_time: '2026-10-01T12:03:00Z',
        mode: 'osu',
        scoring_type: 'scorev2',
        team_type: 'team-vs',
        mods: ['NF'],
        scores: [
          {
            user_id: 1,
            score: 100,
            max_combo: 100,
            accuracy: 0.9,
            mods: [],
            match: { team: 'blue' },
          },
          {
            user_id: 2,
            score: 200,
            max_combo: 200,
            accuracy: 0.95,
            mods: [],
            match: { team: 'red' },
          },
        ],
      },
    },
  ];
  expect(multiplayerEvidence(events, match)[0].proposal).toBeNull();
  const reviewed = multiplayerEvidence(events, match, { historical: true, redSide: 'B' })[0]
    .proposal;
  expect(reviewed).toMatchObject({ scoreA: 100, scoreB: 200, winnerSide: 'B' });
  expect(
    multiplayerEvidence(events, match, { historical: true, redSide: 'A' })[0].proposal,
  ).toBeNull();
});
