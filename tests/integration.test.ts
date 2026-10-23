import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import { db } from '../src/lib/db';
import { executeAction } from '../src/lib/admin-service';
import { loginUser, actorForTournament } from '../src/lib/auth';
import { publicPage, publicPool, publicPools, getTournament } from '../src/lib/queries';
import { ALL_PERMISSIONS, type Actor } from '../src/lib/permissions';
import { hash, token, rateLimit, requireSameOrigin } from '../src/lib/security';
import type { BeatmapMetadata } from '../src/lib/osu';
import { NextRequest } from 'next/server';
import { actionSchema } from '../src/lib/validation';
import { siteCopy } from '../src/lib/copy';
import { GET as oauthLogin } from '../src/app/api/auth/login/route';
import { GET as oauthCallback } from '../src/app/api/auth/callback/route';
import { POST as logout } from '../src/app/api/auth/logout/route';
vi.mock('../src/lib/osu', async (original) => ({
  ...(await original<typeof import('../src/lib/osu')>()),
  osuProfile: vi.fn(async (id: number) => ({
    id,
    username: 'API Profile',
    avatar_url: 'https://a.ppy.sh/1',
    country_code: 'IT',
  })),
}));
const prefix = `integration-${Date.now()}`;
let bootstrap: { bootstrapOwnerOsuId: number | null; ownerBootstrappedAt: Date | null };
let owner: Actor,
  secondOwner: Actor,
  pooler: Actor,
  player: Actor,
  editor: Actor,
  stageId: string,
  poolId: string,
  revisionId: string;
const map: BeatmapMetadata = {
  id: 900001,
  mode: 'osu',
  title: 'Integration map',
  artist: 'Test artist',
  mapper: 'Test mapper',
  difficulty: 'Test',
  stars: 5.23,
  bpm: 180,
  length: 120,
  ar: 9,
  cs: 4,
  od: 8,
  hp: 6,
  cover: '',
  url: 'https://osu.ppy.sh/beatmaps/900001',
};
async function actor(id: string): Promise<Actor> {
  const u = await db.user.findUniqueOrThrow({
    where: { id },
    include: { roles: { include: { role: { include: { permissions: true } } } } },
  });
  return actorForTournament(u, 'main');
}
async function user(osuId: number, key: string) {
  const role = await db.role.findUniqueOrThrow({ where: { systemKey: key } });
  const u = await db.user.create({
    data: {
      osuId,
      username: `${prefix}-${key}`,
      avatarUrl: 'https://a.ppy.sh/1',
      profileUrl: `https://osu.ppy.sh/users/${osuId}`,
      roles: { create: { roleId: role.id } },
    },
  });
  return actor(u.id);
}
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
    throw new Error('Isolated test database required.');
  process.env.OWNER_OSU_ID = '900000001';
  bootstrap = await db.platformSettings.findUniqueOrThrow({
    where: { id: 'main' },
    select: { bootstrapOwnerOsuId: true, ownerBootstrappedAt: true },
  });
  await db.platformSettings.update({
    where: { id: 'main' },
    data: { bootstrapOwnerOsuId: 900000001, ownerBootstrappedAt: null },
  });
  const u = await loginUser({
    id: 900000001,
    username: `${prefix}-owner`,
    avatar_url: 'https://a.ppy.sh/1',
  });
  owner = await actor(u.id);
  secondOwner = await user(900000002, 'Owner');
  pooler = await user(900000003, 'Pooler');
  editor = await user(900000004, 'Content Editor');
  const p = await loginUser({
    id: 900000005,
    username: `${prefix}-player`,
    avatar_url: 'https://a.ppy.sh/1',
    country_code: 'IT',
  });
  player = await actor(p.id);
  await db.beatmap.upsert({
    where: { id: map.id },
    create: { id: map.id, mode: 'osu', metadata: map },
    update: { metadata: map, fetchedAt: new Date() },
  });
});
afterAll(async () => {
  if (bootstrap) await db.platformSettings.update({ where: { id: 'main' }, data: bootstrap });
  await db.tournamentStage.deleteMany({ where: { slug: { startsWith: prefix } } });
  await db.staffMember.deleteMany({ where: { osuId: 900000099 } });
  await db.staffCategory.deleteMany({ where: { name: { startsWith: prefix } } });
  await db.role.deleteMany({ where: { name: { startsWith: prefix } } });
  await db.user.deleteMany({
    where: { osuId: { in: [900000001, 900000002, 900000003, 900000004, 900000005, 900000006] } },
  });
  await db.$disconnect();
});
describe.sequential('persistent authorization and publishing workflows', () => {
  it('protects logout against CSRF and expires the secure host cookie after session revocation', async () => {
    const previousUrl = process.env.APP_URL;
    process.env.APP_URL = 'https://cup.example.com';
    const raw = token(),
      sessionId = hash(raw);
    try {
      await db.session.create({
        data: { id: sessionId, userId: owner.id, expiresAt: new Date(Date.now() + 60000) },
      });
      const request = (origin: string) =>
        new NextRequest('https://cup.example.com/api/auth/logout', {
          method: 'POST',
          headers: {
            Origin: origin,
            Accept: 'application/json',
            Cookie: `__Host-tournament_session=${raw}`,
          },
        });
      expect((await logout(request('https://attacker.example'))).status).toBe(403);
      expect(await db.session.findUnique({ where: { id: sessionId } })).not.toBeNull();
      const response = await logout(request('https://cup.example.com'));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ redirectTo: '/' });
      expect(response.headers.get('set-cookie')).toContain('__Host-tournament_session=');
      expect(response.headers.get('set-cookie')).toMatch(/Secure/i);
      expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/i);
      expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
      expect(await db.session.findUnique({ where: { id: sessionId } })).toBeNull();
    } finally {
      if (previousUrl === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = previousUrl;
      await db.session.deleteMany({ where: { id: sessionId } });
    }
  });
  it('assigns Guest to new osu! users and bootstraps the initial Owner', () => {
    expect(player.roles.map((r) => r.systemKey)).toEqual(['Guest']);
    expect(player.permissions).toEqual([]);
    expect(owner.roles.map((r) => r.systemKey)).toContain('Owner');
    expect(owner.permissions.sort()).toEqual([...ALL_PERMISSIONS].sort());
  });
  it('rejects unauthenticated and unprivileged protected mutations', async () => {
    const a = {
      type: 'stage.save',
      name: 'Restricted',
      slug: 'restricted',
      description: '',
      position: 0,
      startsAt: null,
    } as const;
    await expect(executeAction(null, a)).rejects.toThrow('Sign in');
    await expect(executeAction(player, a)).rejects.toThrow('permission');
  });
  it('lets Owner assign Pooler without granting privileges to itself', async () => {
    const role = await db.role.findUniqueOrThrow({ where: { systemKey: 'Pooler' } });
    await executeAction(owner, { type: 'user.roles', userId: player.id, roleIds: [role.id] });
    expect((await actor(player.id)).permissions).toContain('mappools.edit');
    await loginUser({ id: player.osuId, username: player.username, avatar_url: player.avatarUrl });
    expect((await actor(player.id)).roles.map((r) => r.systemKey)).toEqual(['Pooler']);
    await expect(
      executeAction(owner, { type: 'user.roles', userId: owner.id, roleIds: [] }),
    ).rejects.toThrow('own roles');
  });
  it('creates a stage, resolves cached metadata, and stores a private draft', async () => {
    const r = (await executeAction(pooler, {
      type: 'stage.save',
      name: 'Test round',
      slug: prefix,
      description: 'A test stage',
      position: 99,
      startsAt: null,
    })) as { id: string };
    stageId = r.id;
    poolId = (await db.mappool.findUniqueOrThrow({ where: { stageId } })).id;
    const draft = (await executeAction(pooler, {
      type: 'pool.save',
      id: poolId,
      baseRevisionId: null,
      notes: 'Draft note',
      slots: [{ name: 'NM1', category: 'NM', beatmapId: map.id }],
    })) as { revisionId: string };
    revisionId = draft.revisionId;
    expect(await publicPool(prefix)).toBeNull();
    expect((await publicPools()).some((s) => s.slug === prefix)).toBe(false);
  });
  it('rejects Pooler publication and publishes an exact reviewed revision for Owner', async () => {
    await expect(
      executeAction(pooler, { type: 'pool.publish', id: poolId, revisionId }),
    ).rejects.toThrow('permission');
    await executeAction(owner, { type: 'pool.publish', id: poolId, revisionId });
    const visible = await publicPool(prefix);
    expect(visible?.mappool?.publishedRevision?.notes).toBe('Draft note');
    expect(visible?.mappool?.publishedRevision?.slots[0].metadata).toMatchObject({
      title: map.title,
    });
  });
  it('keeps published data immutable while saving edits and rejects stale writes', async () => {
    const draft = (await executeAction(pooler, {
      type: 'pool.save',
      id: poolId,
      baseRevisionId: revisionId,
      notes: 'Secret new note',
      slots: [{ name: 'NM2', category: 'NM', beatmapId: map.id }],
    })) as { revisionId: string };
    expect((await publicPool(prefix))?.mappool?.publishedRevision?.notes).toBe('Draft note');
    await expect(
      executeAction(pooler, {
        type: 'pool.save',
        id: poolId,
        baseRevisionId: revisionId,
        notes: 'Stale',
        slots: [],
      }),
    ).rejects.toThrow('newer');
    await expect(
      executeAction(owner, { type: 'pool.publish', id: poolId, revisionId }),
    ).rejects.toThrow('Review');
    revisionId = draft.revisionId;
    await executeAction(owner, { type: 'pool.publish', id: poolId, revisionId });
    expect((await publicPool(prefix))?.mappool?.publishedRevision?.notes).toBe('Secret new note');
  });
  it('hides unpublished pools from queries and retains revision history', async () => {
    await executeAction(owner, { type: 'pool.unpublish', id: poolId });
    expect(await publicPool(prefix)).toBeNull();
    expect(await db.mappoolRevision.count({ where: { mappoolId: poolId } })).toBe(2);
    await expect(
      executeAction(pooler, {
        type: 'pool.save',
        id: poolId,
        baseRevisionId: revisionId,
        notes: 'bad',
        slots: [{ name: 'NM1', category: 'XX', beatmapId: map.id }],
      }),
    ).rejects.toThrow('Unknown mod');
  });
  it('persists canonical numeric slot order, rejects duplicates and isolates published revisions', async () => {
    const stage = (await executeAction(pooler, {
      type: 'stage.save',
      name: 'Ordering',
      slug: prefix + '-order',
      description: '',
      position: 100,
      startsAt: null,
    })) as { id: string };
    const pool = await db.mappool.findUniqueOrThrow({ where: { stageId: stage.id } });
    const save = async (names: string[], baseRevisionId: string | null) =>
      (await executeAction(pooler, {
        type: 'pool.save',
        id: pool.id,
        baseRevisionId,
        notes: 'Order',
        slots: names.map((name) => ({
          name,
          category: name.replace(/\d+$/, ''),
          beatmapId: map.id,
        })),
      })) as { revisionId: string };
    const original = await save(['NM1'], null);
    await executeAction(owner, {
      type: 'pool.publish',
      id: pool.id,
      revisionId: original.revisionId,
    });
    const draft = await save(
      ['TB', 'HR2', 'NM10', 'NM2', 'HD1', 'HR1', 'FM1', 'DT1'],
      original.revisionId,
    );
    const slots = await db.mappoolSlot.findMany({
      where: { revisionId: draft.revisionId },
      orderBy: { position: 'asc' },
    });
    const expected = ['NM2', 'NM10', 'HD1', 'HR1', 'HR2', 'DT1', 'FM1', 'TB'];
    expect(slots.map((s) => s.name)).toEqual(expected);
    expect(slots.map((s) => s.position)).toEqual(expected.map((_, i) => i));
    expect(
      (await publicPool(prefix + '-order'))!.mappool!.publishedRevision!.slots.map((s) => s.name),
    ).toEqual(['NM1']);
    await expect(save(['NM1', 'NM01'], draft.revisionId)).rejects.toThrow('Duplicate slot');
    expect((await db.mappool.findUniqueOrThrow({ where: { id: pool.id } })).draftRevisionId).toBe(
      draft.revisionId,
    );
    await executeAction(owner, { type: 'pool.publish', id: pool.id, revisionId: draft.revisionId });
    expect(
      (await publicPool(prefix + '-order'))!.mappool!.publishedRevision!.slots.map((s) => s.name),
    ).toEqual(expected);
    const legacy = await db.mappoolRevision.create({
      data: {
        mappoolId: pool.id,
        notes: 'Legacy physical order',
        slots: {
          create: [...slots].reverse().map((slot, position) => ({
            name: slot.name,
            category: slot.category,
            categoryName: slot.categoryName,
            categoryPriority: slot.categoryPriority,
            color: slot.color,
            position,
            beatmapId: slot.beatmapId,
            metadata: slot.metadata!,
          })),
        },
      },
    });
    await db.mappool.update({ where: { id: pool.id }, data: { publishedRevisionId: legacy.id } });
    expect(
      (await publicPool(prefix + '-order'))!.mappool!.publishedRevision!.slots.map((s) => s.name),
    ).toEqual(expected);
    expect(
      (
        await db.mappoolSlot.findMany({
          where: { revisionId: legacy.id },
          orderBy: { position: 'asc' },
        })
      ).map((s) => s.name),
    ).toEqual([...expected].reverse());
  });
  it('saves and sanitizes rules separately from the public revision', async () => {
    const page = await db.page.findFirstOrThrow({ where: { tournamentId: 'main', slug: 'rules' } });
    const before = (await publicPage('rules'))!.html;
    const r = (await executeAction(editor, {
      type: 'page.save',
      slug: 'rules',
      baseRevisionId: page.draftRevisionId,
      title: 'Test rules',
      html: '<h2>Safe rules</h2><script>bad()</script><p onclick="bad()">Test paragraph</p>',
      blocks: [],
    })) as { revisionId: string };
    expect((await publicPage('rules'))!.html).toBe(before);
    await expect(
      executeAction(editor, { type: 'page.publish', slug: 'rules', revisionId: r.revisionId }),
    ).rejects.toThrow('permission');
    await executeAction(owner, { type: 'page.publish', slug: 'rules', revisionId: r.revisionId });
    expect((await publicPage('rules'))!.html).toBe(
      '<h2 id="section-1">Safe rules</h2><p>Test paragraph</p>',
    );
    await executeAction(owner, {
      type: 'page.restore',
      slug: 'rules',
      revisionId: page.draftRevisionId!,
      baseRevisionId: r.revisionId,
    });
    const restored = await db.page.findFirstOrThrow({
      where: { tournamentId: 'main', slug: 'rules' },
    });
    await executeAction(owner, {
      type: 'page.publish',
      slug: 'rules',
      revisionId: restored.draftRevisionId!,
    });
  });
  it('creates public staff positions without granting internal permissions', async () => {
    const category = await db.staffCategory.create({ data: { name: `${prefix}-public-staff` } });
    await executeAction(owner, {
      type: 'staff.save',
      osuId: 900000099,
      bio: 'A public referee',
      customImage: '',
      visible: true,
      position: 0,
      assignments: [{ categoryId: category.id, position: 'Referee' }],
    });
    const staff = await db.staffMember.findFirstOrThrow({
      where: { osuId: 900000099 },
      include: { assignments: true },
    });
    expect(staff.username).toBe('API Profile');
    expect(staff.assignments[0].position).toBe('Referee');
    expect(await db.user.findUnique({ where: { osuId: 900000099 } })).toBeNull();
  });
  it('creates granular roles and prevents privilege escalation or own-role editing', async () => {
    await executeAction(owner, {
      type: 'role.save',
      name: `${prefix}-publisher`,
      description: 'Publisher',
      permissions: ['mappools.publish'],
    });
    const publisher = await db.role.findFirstOrThrow({
      where: { tournamentId: 'main', name: `${prefix}-publisher` },
      include: { permissions: true },
    });
    expect(publisher.permissions.map((p) => p.permissionKey)).toEqual(['mappools.publish']);
    const poolerRole = pooler.roles[0].id;
    await expect(
      executeAction(owner, {
        type: 'role.save',
        id: owner.roles.find((r) => r.systemKey === 'Owner')!.id,
        name: 'Changed',
        description: '',
        permissions: [],
      }),
    ).rejects.toThrow('protected');
    await expect(
      executeAction(
        { ...pooler, permissions: [...pooler.permissions, 'roles.manage'] },
        { type: 'role.save', name: 'Escalation', description: '', permissions: ['roles.manage'] },
      ),
    ).rejects.toThrow('permission');
    expect(poolerRole).toBeTruthy();
  });
  it('demotes another Owner while protecting the caller’s ownership', async () => {
    const playerRole = await db.role.findUniqueOrThrow({ where: { systemKey: 'Player' } });
    const role = await db.role.findUniqueOrThrow({ where: { systemKey: 'Owner' } });
    const ownersBefore = await db.userRole.count({ where: { roleId: role.id } });
    await executeAction(owner, {
      type: 'user.roles',
      userId: secondOwner.id,
      roleIds: [playerRole.id],
    });
    await expect(
      executeAction(owner, { type: 'user.roles', userId: owner.id, roleIds: [playerRole.id] }),
    ).rejects.toThrow('own roles');
    expect(await db.userRole.count({ where: { roleId: role.id } })).toBe(ownersBefore - 1);
    expect(await db.userRole.count({ where: { roleId: role.id, userId: owner.id } })).toBe(1);
  });
  it('persists settings, audits and opaque sessions in PostgreSQL', async () => {
    const raw = token();
    await db.session.create({
      data: { id: hash(raw), userId: owner.id, expiresAt: new Date(Date.now() + 60000) },
    });
    const stored = await db.session.findUniqueOrThrow({ where: { id: hash(raw) } });
    expect(stored.id).not.toBe(raw);
    expect(await db.auditLog.count({ where: { actorId: owner.id } })).toBeGreaterThan(5);
    await db.session.delete({ where: { id: hash(raw) } });
  });
  it('persists tournament branding and registration settings while rejecting unauthorized changes', async () => {
    const before = await getTournament();
    const original = actionSchema.parse({
      type: 'settings.save',
      ...before,
      ...before.settings,
      copy: siteCopy(before.settings?.copy),
    });
    const changed = actionSchema.parse({
      ...original,
      name: 'Integration branding',
      banner: '/integration-banner.svg',
      primaryColor: '#123456',
      registrationUrl: 'https://example.com/registration',
    });
    await expect(executeAction(pooler, changed)).rejects.toThrow('permission');
    try {
      await executeAction(owner, changed);
      const stored = await getTournament();
      expect(stored.name).toBe('Integration branding');
      expect(stored.settings).toMatchObject({
        banner: '/integration-banner.svg',
        primaryColor: '#123456',
        registrationUrl: 'https://example.com/registration',
      });
    } finally {
      await executeAction(owner, original);
    }
  });
  it('enforces distributed rate limits and same-origin CSRF checks', async () => {
    await rateLimit(prefix, 2);
    await rateLimit(prefix, 2);
    await expect(rateLimit(prefix, 2)).rejects.toThrow('Too many');
    expect(() =>
      requireSameOrigin(
        new Request('http://localhost/api', { headers: { origin: 'https://evil.example' } }),
      ),
    ).toThrow('origin');
  });
  it('validates OAuth state, exchanges the real authorization-code contract, and issues only an opaque session', async () => {
    const previous = {
      APP_URL: process.env.APP_URL,
      OSU_CLIENT_ID: process.env.OSU_CLIENT_ID,
      OSU_CLIENT_SECRET: process.env.OSU_CLIENT_SECRET,
      OSU_REDIRECT_URI: process.env.OSU_REDIRECT_URI,
    };
    process.env.APP_URL = 'https://tournament.example';
    process.env.OSU_CLIENT_ID = '1234';
    process.env.OSU_CLIENT_SECRET = 'test-only-secret';
    process.env.OSU_REDIRECT_URI = 'https://tournament.example/api/auth/callback';
    const calls: { url: string; body: string }[] = [];
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      calls.push({ url: String(url), body: String(options?.body || '') });
      if (String(url).endsWith('/oauth/token'))
        return Response.json({
          access_token: 'test-osu-token',
          expires_in: 3600,
          refresh_token: 'never-persist-me',
        });
      if (String(url).endsWith('/api/v2/me'))
        return Response.json({
          id: 900000006,
          username: 'OAuth integration user',
          avatar_url: 'https://a.ppy.sh/1',
          country_code: 'IT',
        });
      throw new Error('Unexpected upstream call');
    });
    try {
      const start = await oauthLogin(
        new Request('https://tournament.example/api/auth/login?returnTo=%2Fmappools%2Ffinals'),
      );
      expect(start.status).toBe(307);
      const authorization = new URL(start.headers.get('location')!);
      expect(authorization.origin).toBe('https://osu.ppy.sh');
      expect(authorization.searchParams.get('scope')).toBe('identify public');
      expect(authorization.search).not.toContain('test-only-secret');
      const state = authorization.searchParams.get('state')!;
      expect(start.headers.get('set-cookie')).toContain('HttpOnly');
      expect(start.headers.get('set-cookie')).toContain('Secure');
      const bad = await oauthCallback(
        new NextRequest(`https://tournament.example/api/auth/callback?code=code&state=${state}`, {
          headers: { cookie: '__Host-tournament_oauth=wrong' },
        }),
      );
      expect(bad.status).toBe(403);
      expect(calls).toHaveLength(0);
      const request = new NextRequest(
        `https://tournament.example/api/auth/callback?code=single-use-code&state=${state}`,
        { headers: { cookie: `__Host-tournament_oauth=${state}` } },
      );
      const response = await oauthCallback(request);
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('https://tournament.example/mappools/finals');
      expect(calls[0].url).toBe('https://osu.ppy.sh/oauth/token');
      expect(new URLSearchParams(calls[0].body).get('grant_type')).toBe('authorization_code');
      expect(new URLSearchParams(calls[0].body).get('code')).toBe('single-use-code');
      expect(response.headers.get('set-cookie')).toContain('__Host-tournament_session=');
      expect(response.headers.get('set-cookie')).not.toContain('test-osu-token');
      const user = await db.user.findUniqueOrThrow({
        where: { osuId: 900000006 },
        include: { sessions: true, roles: { include: { role: true } } },
      });
      expect(user.roles.map((r) => r.role.systemKey)).toEqual(['Guest']);
      expect(user.sessions[0].id).toMatch(/^[a-f0-9]{64}$/);
      const replay = await oauthCallback(request);
      expect(replay.status).toBe(403);
      expect(calls).toHaveLength(2);
    } finally {
      mock.mockRestore();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
