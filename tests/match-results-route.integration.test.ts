import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
import { requireTournamentActor } from '../src/lib/auth';
import { osuGet } from '../src/lib/osu';
import { POST } from '../src/app/api/admin/match-results/route';
import { matchRulesSchema } from '../src/lib/match-rules';
import { AppError, type Actor } from '../src/lib/permissions';
import { verifyMatchResultReview } from '../src/lib/match-result-review';
import { assertTestDatabase } from '../src/lib/instance';

vi.mock('../src/lib/auth', async (original) => ({
  ...(await original<typeof import('../src/lib/auth')>()),
  requireTournamentActor: vi.fn(),
}));
vi.mock('../src/lib/osu', async (original) => ({
  ...(await original<typeof import('../src/lib/osu')>()),
  osuGet: vi.fn(),
}));
assertTestDatabase(process.env.DATABASE_URL);
const id = `result-route-${randomUUID()}`,
  osuId = randomInt(1_500_000_000, 1_600_000_000);
let actor: Actor, matchId: string, mapId: number;
beforeAll(async () => {
  vi.stubEnv('APP_URL', 'http://localhost:3001');
  vi.stubEnv('OSU_CLIENT_SECRET', 'synthetic-result-route-secret');
  const user = await db.user.create({
    data: { osuId, username: id, avatarUrl: '', profileUrl: '' },
  });
  actor = {
    id: user.id,
    osuId,
    username: id,
    avatarUrl: '',
    tournamentId: id,
    roles: [],
    permissions: ['matches.manage'],
  };
  await db.tournament.create({
    data: {
      id,
      slug: id,
      name: id,
      acronym: 'QA',
      description: 'Synthetic provider review fixture',
      settings: {
        create: {
          gameplayScoring: 'SCORE_V2',
          socialLinks: [],
          navigation: [],
          importantDates: [],
          footer: '',
        },
      },
    },
  });
  const stage = await db.tournamentStage.create({
    data: { tournamentId: id, name: 'Source capture', slug: 'source', mappool: { create: {} } },
    include: { mappool: true },
  });
  const map = await db.beatmap.findFirstOrThrow();
  mapId = map.id;
  const pool = await db.mappoolRevision.create({
    data: {
      tournamentId: id,
      mappoolId: stage.mappool!.id,
      slots: {
        create: {
          position: 0,
          name: 'NM1',
          category: 'NM',
          categoryName: 'No Mod',
          beatmapId: map.id,
          metadata: map.metadata!,
          color: '#88aabb',
        },
      },
    },
  });
  const teams: { id: string; name: string; slug: string }[] = [];
  for (const side of ['A', 'B'])
    teams.push(
      await db.team.create({
        data: { tournamentId: id, name: side, slug: side.toLowerCase(), status: 'APPROVED' },
      }),
    );
  const snapshot = (index: number) => ({
    id: teams[index].id,
    name: teams[index].name,
    slug: teams[index].slug,
    format: 'INDIVIDUAL',
    logoImageId: null,
    members: [
      {
        osuId: osuId + index + 1,
        username: `Player ${index}`,
        avatarUrl: '',
        captain: true,
        substitute: false,
      },
    ],
  });
  const match = await db.match.create({
    data: {
      tournamentId: id,
      code: '1',
      stageId: stage.id,
      teamAId: teams[0].id,
      teamBId: teams[1].id,
      poolRevisionId: pool.id,
      rules: matchRulesSchema.parse({
        gameplayScoring: 'SCORE_V2',
        teamSize: 1,
        bestOf: 3,
        freeModRequiredHD: 0,
        freeModRequiredHR: 0,
      }),
      participants: { A: snapshot(0), B: snapshot(1) },
    },
  });
  matchId = match.id;
});
beforeEach(() => {
  vi.mocked(requireTournamentActor).mockResolvedValue(actor);
  vi.mocked(osuGet).mockReset();
});
afterAll(async () => {
  await db.match.deleteMany({ where: { tournamentId: id } });
  await db.team.deleteMany({ where: { tournamentId: id } });
  await db.tournamentStage.deleteMany({ where: { tournamentId: id } });
  await db.tournament.deleteMany({ where: { id } });
  await db.user.deleteMany({ where: { id: actor.id } });
  await db.rateLimit.deleteMany({ where: { key: { startsWith: `organizer-mp:${actor.id}:` } } });
  vi.unstubAllEnvs();
  await db.$disconnect();
});
const request = (body: object, origin = 'http://localhost:3001') =>
  POST(
    new Request('http://localhost:3001/api/admin/match-results', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: matchId, baseVersion: 1, ...body }),
    }),
  );
const game = (n: number) => ({
  id: 100 + n,
  beatmap_id: mapId,
  start_time: '2026-10-01T12:00:00Z',
  end_time: '2026-10-01T12:02:00Z',
  mode: 'osu',
  scoring_type: 'scorev2',
  team_type: 'team-vs',
  mods: ['NF'],
  scores: [
    {
      user_id: osuId + 1,
      score: 200,
      max_combo: 20,
      accuracy: 0.95,
      mods: [],
      match: { team: 'red' },
    },
    {
      user_id: osuId + 2,
      score: 100,
      max_combo: 10,
      accuracy: 0.9,
      mods: [],
      match: { team: 'blue' },
    },
  ],
});
it('fetches official-shaped evidence with pinned scores and resumes signed earlier pages without changing the match', async () => {
  vi.mocked(osuGet).mockImplementation(async (path) => {
    const before = Number(new URL(path, 'https://local.invalid').searchParams.get('before') || 8),
      eventId = before - 1;
    return {
      match: {
        id: 42,
        name: 'Reviewed source lobby',
        start_time: '2026-10-01T11:00:00Z',
        end_time: null,
      },
      first_event_id: 1,
      events: [{ id: eventId, ...(eventId === 7 || eventId === 1 ? { game: game(eventId) } : {}) }],
    };
  });
  const first = await request({
    type: 'multiplayer',
    lobbyUrl: 'https://osu.ppy.sh/mp/42',
    redSide: 'A',
  });
  expect(first.status).toBe(200);
  const partial = await first.json();
  expect(partial.complete).toBe(false);
  expect(partial.games).toHaveLength(1);
  expect(() => verifyMatchResultReview(partial.token, actor, matchId, 1)).toThrow(/incomplete/);
  const next = await request({
    type: 'multiplayer',
    lobbyUrl: 'https://osu.ppy.sh/mp/42',
    redSide: 'A',
    reviewToken: partial.token,
  });
  const full = await next.json();
  expect(next.status).toBe(200);
  expect(full.complete).toBe(true);
  expect(full.games.map((row: { evidence: { eventId: number } }) => row.evidence.eventId)).toEqual([
    1, 7,
  ]);
  expect(full.games[0].proposal).toMatchObject({ winnerSide: 'A', scoreA: 200, scoreB: 100 });
  expect(vi.mocked(osuGet).mock.calls.every((call) => call[2] === '20220704')).toBe(true);
  expect(await db.match.findUniqueOrThrow({ where: { id: matchId } })).toMatchObject({
    version: 1,
    scoreA: 0,
    scoreB: 0,
    status: 'SCHEDULED',
    multiplayerId: null,
  });
  expect(await db.multiplayerGame.count({ where: { matchId } })).toBe(0);
});
it('checks origin, organizer permission, tenant ownership and reviewed version before fetching a provider', async () => {
  expect(
    (
      await request(
        { type: 'multiplayer', lobbyUrl: 'https://osu.ppy.sh/mp/42' },
        'https://untrusted.invalid',
      )
    ).status,
  ).toBe(403);
  vi.mocked(requireTournamentActor).mockResolvedValue({
    ...actor,
    permissions: ['matches.view_all', 'matches.manage_all'],
  });
  expect(
    (await request({ type: 'multiplayer', lobbyUrl: 'https://osu.ppy.sh/mp/42' })).status,
  ).toBe(403);
  vi.mocked(requireTournamentActor).mockResolvedValue({
    ...actor,
    tournamentId: 'foreign-tournament',
  });
  expect(
    (await request({ type: 'multiplayer', lobbyUrl: 'https://osu.ppy.sh/mp/42' })).status,
  ).toBe(404);
  vi.mocked(requireTournamentActor).mockResolvedValue(actor);
  expect(
    (await request({ type: 'multiplayer', baseVersion: 2, lobbyUrl: 'https://osu.ppy.sh/mp/42' }))
      .status,
  ).toBe(409);
  expect(osuGet).not.toHaveBeenCalled();
});
it('retains saved data when the provider is unavailable or returns another lobby', async () => {
  vi.mocked(osuGet).mockRejectedValueOnce(new AppError('Missing source', 404));
  expect(
    (await request({ type: 'multiplayer', lobbyUrl: 'https://osu.ppy.sh/mp/43' })).status,
  ).toBe(404);
  vi.mocked(osuGet).mockResolvedValueOnce({ match: { id: 999 }, events: [] });
  expect(
    (await request({ type: 'multiplayer', lobbyUrl: 'https://osu.ppy.sh/mp/44' })).status,
  ).toBe(502);
  expect(await db.match.findUniqueOrThrow({ where: { id: matchId } })).toMatchObject({
    version: 1,
    scoreA: 0,
    scoreB: 0,
    multiplayerId: null,
  });
});
