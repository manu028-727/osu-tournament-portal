import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import path from 'node:path';
import { db } from '../src/lib/db';
import { loginUser, actorForTournament } from '../src/lib/auth';
import { hash } from '../src/lib/security';
import { tournamentAction } from '../src/lib/tournaments-service';
import { POST as upload } from '../src/app/api/platform/media/route';
import { GET as media, DELETE as remove } from '../src/app/api/platform/media/[id]/route';
let cookie = '';
vi.mock('next/headers.js', () => ({
  cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined) }),
  headers: async () => new Headers(),
}));
let original: Awaited<ReturnType<typeof db.platformSettings.findUniqueOrThrow>>;
const ids: number[] = [990000001, 990000002];
let assetId = '',
  ownerId = '';
const load = async (id: string) =>
  actorForTournament(
    await db.user.findUniqueOrThrow({
      where: { id },
      include: { roles: { include: { role: { include: { permissions: true } } } } },
    }),
    'main',
  );
beforeAll(async () => {
  expect(new URL(process.env.DATABASE_URL!).pathname).toBe('/tournament_platform_test');
  original = await db.platformSettings.findUniqueOrThrow({ where: { id: 'main' } });
  expect(await db.user.count({ where: { platformAdmin: true } })).toBe(0);
  await db.platformSettings.update({
    where: { id: 'main' },
    data: { bootstrapOwnerOsuId: ids[0], ownerBootstrappedAt: null },
  });
  vi.stubEnv('APP_URL', 'http://localhost:3001');
  vi.stubEnv('STORAGE_DRIVER', 'filesystem');
  vi.stubEnv('STORAGE_LOCAL_DIR', path.resolve('.data/test-platform-media'));
});
afterAll(async () => {
  cookie = '';
  await db.platformSettings.update({
    where: { id: 'main' },
    data: { ...original, socialLinks: original.socialLinks ?? [] },
  });
  if (assetId) await db.platformAsset.deleteMany({ where: { id: assetId } });
  await db.user.deleteMany({ where: { osuId: { in: ids } } });
  vi.unstubAllEnvs();
  await db.$disconnect();
});
describe.sequential('one-time installation ownership and platform media', () => {
  it('does not promote an arbitrary first login, then consumes the pinned owner identity', async () => {
    const random = await loginUser({ id: ids[1], username: 'Synthetic visitor', avatar_url: '' });
    expect((await load(random.id)).platformAdmin).toBe(false);
    const owner = await loginUser({
      id: ids[0],
      username: 'Synthetic designated owner',
      avatar_url: '',
    });
    ownerId = owner.id;
    expect((await load(owner.id)).platformAdmin).toBe(true);
    expect(await db.platformSettings.findUnique({ where: { id: 'main' } })).toMatchObject({
      bootstrapOwnerOsuId: null,
      ownerBootstrappedAt: expect.any(Date),
    });
    cookie = 'synthetic-session';
    await db.session.create({
      data: { id: hash(cookie), userId: owner.id, expiresAt: new Date(Date.now() + 600000) },
    });
  });
  it('saves platform branding without requiring a featured tournament and denies local-only access', async () => {
    const owner = await load(ownerId);
    await tournamentAction(owner, {
      type: 'platform',
      name: 'Synthetic Platform',
      rootMode: 'DIRECTORY',
      defaultTournamentId: null,
      description: '',
      timezone: 'Pacific/Auckland',
    });
    expect(await db.platformSettings.findUnique({ where: { id: 'main' } })).toMatchObject({
      name: 'Synthetic Platform',
      defaultTournamentId: null,
    });
    const visitor = await db.user.findUniqueOrThrow({ where: { osuId: ids[1] } });
    await expect(
      tournamentAction(await load(visitor.id), {
        type: 'platform',
        name: 'Denied',
        rootMode: 'DIRECTORY',
      }),
    ).rejects.toThrow('permission');
  });
  it('keeps platform uploads private until referenced and protects in-use images', async () => {
    const image = await sharp({
      create: { width: 16, height: 16, channels: 3, background: '#357c71' },
    })
      .png()
      .toBuffer();
    const f = new FormData();
    f.set('file', new File([new Uint8Array(image)], 'synthetic.png', { type: 'image/png' }));
    const response = await upload(
      new Request('http://localhost:3001/api/platform/media', {
        method: 'POST',
        headers: { origin: 'http://localhost:3001' },
        body: f,
      }),
    );
    expect(response.status).toBe(200);
    const asset = await response.json();
    assetId = asset.id;
    const session = cookie;
    cookie = '';
    const context = { params: Promise.resolve({ id: assetId }) };
    expect((await media(new Request('http://localhost:3001/'), context)).status).toBe(404);
    cookie = session;
    await tournamentAction(await load(ownerId), {
      type: 'platform',
      name: 'Synthetic Platform',
      rootMode: 'DIRECTORY',
      logo: asset.url,
    });
    cookie = '';
    expect((await media(new Request('http://localhost:3001/'), context)).status).toBe(200);
    cookie = session;
    const request = () =>
      new Request('http://localhost:3001/', {
        method: 'DELETE',
        headers: { origin: 'http://localhost:3001' },
      });
    expect((await remove(request(), context)).status).toBe(409);
    await tournamentAction(await load(ownerId), {
      type: 'platform',
      name: 'Synthetic Platform',
      rootMode: 'DIRECTORY',
      logo: '',
    });
    expect((await remove(request(), context)).status).toBe(200);
    assetId = '';
  });
  it('cannot rearm owner bootstrap by changing environment variables after consumption', async () => {
    await db.user.update({ where: { id: ownerId }, data: { platformAdmin: false } });
    vi.stubEnv('OWNER_OSU_ID', String(ids[0]));
    await loginUser({ id: ids[0], username: 'Synthetic designated owner', avatar_url: '' });
    expect((await load(ownerId)).platformAdmin).toBe(false);
  });
});
