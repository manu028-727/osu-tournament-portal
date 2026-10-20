import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { executeGateway } from '../src/lib/irc-service';
import { hash } from '../src/lib/security';
import { matchRulesSchema } from '../src/lib/match-rules';
import { rpcHeaders } from '../src/lib/irc-security';
import { POST as rpc } from '../src/app/api/internal/irc/route';

const prefix = `irc-${randomUUID()}`;
const ids: string[] = [],
  sessionIds: string[] = [];
let stageId = '',
  matchId = '',
  requestId = '';
const identity = (index = 0) => ({
  userId: ids[index],
  sessionHash: sessionIds[index],
  tournamentId: 'main',
  matchId,
});
beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== '/tournament_platform_test')
    throw new Error('Test database only.');
  vi.stubEnv('IRC_ENABLED', 'true');
  vi.stubEnv('IRC_GATEWAY_SECRET', 'b'.repeat(64));
  const role = await db.role.findUniqueOrThrow({ where: { systemKey: 'Referee' } });
  for (let i = 0; i < 2; i++) {
    const user = await db.user.create({
      data: {
        osuId: 984000001 + i,
        username: `${prefix}-${i}`,
        avatarUrl: '',
        profileUrl: '',
        roles: { create: { roleId: role.id, tournamentId: 'main' } },
      },
    });
    ids.push(user.id);
    const session = hash(`${prefix}-${i}`);
    sessionIds.push(session);
    await db.session.create({
      data: { id: session, userId: user.id, expiresAt: new Date(Date.now() + 600000) },
    });
  }
  const stage = await db.tournamentStage.create({ data: { name: prefix, slug: prefix } });
  stageId = stage.id;
  const match = await db.match.create({
    data: {
      code: prefix,
      stageId,
      participants: {},
      rules: matchRulesSchema.parse({}),
      assignments: { create: { userId: ids[0] } },
    },
  });
  matchId = match.id;
});
afterAll(async () => {
  await db.auditLog.deleteMany({ where: { entityId: matchId } });
  await db.match.deleteMany({ where: { id: matchId } });
  await db.tournamentStage.deleteMany({ where: { id: stageId } });
  await db.userRole.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  vi.unstubAllEnvs();
  await db.$disconnect();
});
describe.sequential('gateway database authorization and durable create guards', () => {
  it('separates all-match observing from assigned-match control', async () => {
    expect(await executeGateway({ identity: identity(1), operation: 'authorize' })).toMatchObject({
      operate: false,
    });
    await expect(
      executeGateway({ identity: identity(1), operation: 'control' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await executeGateway({ identity: identity(), operation: 'control' })).toMatchObject({
      version: 1,
    });
    await expect(
      executeGateway({
        identity: { ...identity(), tournamentId: 'other-event' },
        operation: 'control',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('persists creation intent, blocks duplicates across requests and preserves match state', async () => {
    const before = await db.match.findUniqueOrThrow({ where: { id: matchId } });
    const response = await executeGateway({
      identity: identity(),
      operation: 'create',
      name: 'A vs B',
      baseVersion: 1,
    });
    requestId = response.requestId!;
    expect(await db.ircLobbyRequest.findUnique({ where: { id: requestId } })).toMatchObject({
      status: 'PENDING',
      userId: ids[0],
    });
    await expect(
      executeGateway({
        identity: identity(),
        operation: 'create',
        name: 'Duplicate',
        baseVersion: 1,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await executeGateway({
      identity: identity(),
      operation: 'complete',
      requestId,
      status: 'UNKNOWN',
    });
    expect(await executeGateway({ identity: identity(), operation: 'authorize' })).toMatchObject({
      activeRequest: { status: 'UNKNOWN' },
    });
    expect(await db.match.findUniqueOrThrow({ where: { id: matchId } })).toEqual(before);
    await executeGateway({ identity: identity(), operation: 'resolve', requestId });
    await expect(
      executeGateway({ identity: identity(), operation: 'create', name: 'Stale', baseVersion: 2 }),
    ).rejects.toMatchObject({ status: 409 });
    const next = await executeGateway({
      identity: identity(),
      operation: 'create',
      name: 'Reviewed retry',
      baseVersion: 1,
    });
    await executeGateway({
      identity: identity(),
      operation: 'complete',
      requestId: next.requestId,
      status: 'CREATED',
      url: 'https://osu.ppy.sh/mp/12345',
    });
    expect(await executeGateway({ identity: identity(), operation: 'authorize' })).toMatchObject({
      createdLobby: { lobbyUrl: 'https://osu.ppy.sh/community/matches/12345' },
    });
    await expect(
      executeGateway({
        identity: identity(),
        operation: 'create',
        name: 'Unlinked duplicate',
        baseVersion: 1,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('requires HMAC and rejects an identical signed RPC replay', async () => {
    const body = JSON.stringify({ identity: identity(), operation: 'authorize' });
    expect((await rpc(new Request('http://internal', { method: 'POST', body }))).status).toBe(403);
    const headers = rpcHeaders(body, 'b'.repeat(64));
    expect(
      (await rpc(new Request('http://internal', { method: 'POST', body, headers }))).status,
    ).toBe(200);
    expect(
      (await rpc(new Request('http://internal', { method: 'POST', body, headers }))).status,
    ).toBe(403);
    await db.rateLimit.deleteMany({ where: { key: `irc-nonce:${headers['x-irc-nonce']}` } });
  });
  it('rechecks logout and revoked permissions instead of trusting ticket claims', async () => {
    await db.session.delete({ where: { id: sessionIds[0] } });
    await expect(
      executeGateway({ identity: identity(), operation: 'control' }),
    ).rejects.toMatchObject({ status: 401 });
    await db.userRole.deleteMany({ where: { userId: ids[1] } });
    await expect(
      executeGateway({ identity: identity(1), operation: 'authorize' }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
