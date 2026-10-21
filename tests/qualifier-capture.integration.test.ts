import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
import { ALL_PERMISSIONS, type Actor } from '../src/lib/permissions';
import { inheritedRules } from '../src/lib/gameplay-scoring';
import { qualifierPolicySchema } from '../src/lib/qualifier-policy';
import { assertTestDatabase } from '../src/lib/instance';
const mocks = vi.hoisted(() => ({ actor: null as Actor | null, load: vi.fn() }));
vi.mock('../src/lib/auth', async (original) => ({
  ...(await original<typeof import('../src/lib/auth')>()),
  requireTournamentActor: async () => {
    if (!mocks.actor) throw new Error('Test actor missing');
    return mocks.actor;
  },
}));
vi.mock('../src/lib/osu', () => ({ osuGet: mocks.load }));
import { POST } from '../src/app/api/admin/qualifier-multiplayer/route';
assertTestDatabase(process.env.DATABASE_URL);
const id = `capture-${randomUUID()}`;
const osuId = randomInt(1_500_000_000, 1_600_000_000);
let userId: string, lobbyId: string, teamId: string;
let beatmapId: number;
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const request = (input: object, origin = 'http://localhost:3334') =>
  POST(
    new Request(`${origin}/api/admin/qualifier-multiplayer`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ id: lobbyId, ...input }),
    }),
  );
const version = async () =>
  (await db.qualifierLobby.findUniqueOrThrow({ where: { id: lobbyId } })).version;
beforeAll(async () => {
  vi.stubEnv('APP_URL', 'http://localhost:3334');
  const user = await db.user.create({
    data: { osuId, username: id, avatarUrl: '', profileUrl: '', platformAdmin: true },
  });
  userId = user.id;
  mocks.actor = {
    id: user.id,
    osuId,
    username: id,
    avatarUrl: '',
    platformAdmin: true,
    tournamentId: id,
    permissions: [...ALL_PERMISSIONS],
    roles: [],
  };
  await db.tournament.create({
    data: {
      id,
      slug: id,
      name: id,
      acronym: 'QA',
      description: '',
      published: false,
      settings: {
        create: {
          gameplayScoring: 'SCORE_V2',
          socialLinks: [],
          importantDates: [],
          navigation: [],
          footer: '',
        },
      },
    },
  });
  const stage = await db.tournamentStage.create({
    data: {
      tournamentId: id,
      name: 'Qualifiers',
      slug: 'qualifiers',
      kind: 'QUALIFIERS',
      qualifierPolicy: json(qualifierPolicySchema.parse({ requiredPlayers: 1, runs: 2 })),
    },
  });
  const participant = await db.participant.create({ data: { osuId, username: id, avatarUrl: '' } });
  const team = await db.team.create({
    data: {
      tournamentId: id,
      name: id,
      slug: 'entrant',
      status: 'APPROVED',
      format: 'INDIVIDUAL',
      members: { create: { osuId: participant.osuId, captain: true, position: 0 } },
    },
  });
  teamId = team.id;
  const beatmap = await db.beatmap.findFirstOrThrow();
  beatmapId = beatmap.id;
  const pool = await db.mappool.create({ data: { tournamentId: id, stageId: stage.id } });
  const revision = await db.mappoolRevision.create({
    data: { tournamentId: id, mappoolId: pool.id },
  });
  await db.mappoolSlot.create({
    data: {
      revisionId: revision.id,
      name: 'NM1',
      category: 'NM',
      categoryName: 'No Mod',
      color: '#90bdf4',
      position: 0,
      beatmapId,
      metadata: beatmap.metadata!,
    },
  });
  await db.mappool.update({
    where: { id: pool.id },
    data: { state: 'PUBLISHED', publishedRevisionId: revision.id },
  });
  const lobby = await db.qualifierLobby.create({
    data: {
      tournamentId: id,
      stageId: stage.id,
      poolRevisionId: revision.id,
      code: 'Q1',
      status: 'IN_PROGRESS',
      rules: json(
        inheritedRules(
          { teamSize: 1, teamMode: 'HEAD_TO_HEAD', multiplierMode: 'NONE' },
          'SCORE_V2',
        ),
      ),
      policy: json(qualifierPolicySchema.parse({ requiredPlayers: 1, runs: 2 })),
      gameplayScoring: 'SCORE_V2',
      participants: [
        {
          id: team.id,
          name: team.name,
          format: 'INDIVIDUAL',
          members: [{ osuId, username: id, captain: true }],
        },
      ],
      lobbyUrl: 'https://osu.ppy.sh/community/matches/12345',
    },
  });
  lobbyId = lobby.id;
  await db.qualifierEntry.create({ data: { tournamentId: id, lobbyId, teamId, position: 0 } });
  await db.qualifierEvent.create({
    data: {
      lobbyId,
      version: 1,
      actorId: userId,
      kind: 'qualifier.status',
      data: { command: 'START' },
      createdAt: new Date('2026-10-21T10:00:00Z'),
    },
  });
  mocks.load.mockImplementation(async () => ({
    match: { id: 12345 },
    first_event_id: 1,
    events: [
      {
        id: 1,
        game: {
          id: 9876,
          beatmap_id: beatmapId,
          start_time: '2026-10-21T10:01:00Z',
          end_time: '2026-10-21T10:03:00Z',
          mode: 'osu',
          scoring_type: 'scorev2',
          mods: ['NF'],
          scores: [{ user_id: osuId, score: 0, mods: [] }],
        },
      },
    ],
  }));
});
afterAll(async () => {
  await db.qualifierLobby.deleteMany({ where: { tournamentId: id } });
  await db.tournamentStage.deleteMany({ where: { tournamentId: id } });
  await db.team.deleteMany({ where: { tournamentId: id } });
  await db.auditLog.deleteMany({ where: { tournamentId: id } });
  await db.tournament.deleteMany({ where: { id } });
  await db.rateLimit.deleteMany({ where: { key: { startsWith: `qualifier-sync:${userId}:` } } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.participant.deleteMany({ where: { osuId } });
  vi.unstubAllEnvs();
  await db.$disconnect();
});
describe.sequential('reviewed qualifier API capture persistence', () => {
  it('previews genuine games without writing scores', async () => {
    const response = await request({ run: 1 });
    expect(response.status).toBe(200);
    const preview = await response.json();
    expect(preview.proposals[0].players[0].raw).toBe(0);
    expect(await db.qualifierScore.count({ where: { lobbyId } })).toBe(0);
  });
  it('persists a verified zero, provenance, events and audit records', async () => {
    const response = await request({
      run: 1,
      gameId: '9876',
      baseVersion: await version(),
      reason: 'Reviewed complete osu game',
    });
    expect(await response.json()).toMatchObject({ imported: 1, skipped: 0 });
    const score = await db.qualifierScore.findFirstOrThrow({ where: { lobbyId } });
    expect(score).toMatchObject({
      raw: 0,
      adjusted: 0,
      run: 1,
      actualScoring: 'SCORE_V2',
      source: 'OSU_API',
      gameId: '12345:9876',
      verified: true,
    });
    expect(await db.qualifierEvent.count({ where: { lobbyId, kind: 'qualifier.capture' } })).toBe(
      1,
    );
    expect(
      await db.auditLog.count({
        where: { tournamentId: id, action: 'qualifier.multiplayer.capture' },
      }),
    ).toBe(1);
  });
  it('reimport is idempotent and the same game cannot become another run', async () => {
    const again = await request({
      run: 1,
      gameId: '9876',
      baseVersion: await version(),
      reason: 'Reviewed existing capture',
    });
    expect(await again.json()).toMatchObject({ imported: 0, skipped: 1 });
    const duplicate = await request({
      run: 2,
      gameId: '9876',
      baseVersion: await version(),
      reason: 'Review second run',
    });
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error).toContain('distinct performance');
    expect(await db.qualifierScore.count({ where: { lobbyId } })).toBe(1);
  });
  it('rejects stale previews and cross-origin capture without altering stored history', async () => {
    const stale = await request({
      run: 1,
      gameId: '9876',
      baseVersion: 1,
      reason: 'Stale reviewed game',
    });
    expect(stale.status).toBe(409);
    expect((await request({ run: 1 }, 'https://evil.invalid')).status).toBe(403);
    expect(await db.qualifierScore.count({ where: { lobbyId } })).toBe(1);
  });
  it('refuses an unassigned observer and cross-tournament access', async () => {
    const owner = mocks.actor!;
    mocks.actor = {
      ...owner,
      platformAdmin: false,
      permissions: ['matches.view_all', 'matches.update_scores'],
      roles: [],
    };
    expect((await request({ run: 1 })).status).toBe(403);
    mocks.actor = { ...owner, tournamentId: 'main' };
    expect((await request({ run: 1 })).status).toBe(404);
    mocks.actor = owner;
  });
});
