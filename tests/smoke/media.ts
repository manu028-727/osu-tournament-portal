import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import sharp from 'sharp';

if (process.env.ALLOW_ISOLATED_CONTAINER_TESTS !== 'yes')
  throw new Error('This fixture is only for an explicitly isolated staging database.');
const connection = new URL(process.env.DATABASE_URL!);
if (process.env.MIGRATION_DATABASE_HOST) connection.hostname = process.env.MIGRATION_DATABASE_HOST;
if (!['/tournament_platform_test', '/platform_onboarding_test'].includes(connection.pathname))
  throw new Error('Only dedicated test databases are accepted.');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: connection.toString() }) });
const origin = process.env.APP_URL!;
const cookie = origin.startsWith('https:') ? '__Host-tournament_session' : 'tournament_session';
const prefix = `media-test-${randomUUID()}`;
const users: string[] = [];
const tournaments: string[] = [];
try {
  const tokens: string[] = [];
  const slugs: string[] = [];
  for (let i = 0; i < 2; i++) {
    const slug = `${prefix}-${i}`;
    const t = await db.tournament.create({
      data: {
        id: slug,
        slug,
        name: slug,
        acronym: 'TEST',
        description: '',
        published: i === 0,
        settings: {
          create: { banner: '', socialLinks: [], importantDates: [], navigation: [], footer: '' },
        },
      },
    });
    tournaments.push(t.id);
    slugs.push(slug);
    const user = await db.user.create({
      data: {
        osuId: 1800000000 + Math.floor(Math.random() * 10000000),
        username: slug,
        avatarUrl: '',
        profileUrl: '',
      },
    });
    users.push(user.id);
    const role = await db.role.create({
      data: {
        name: 'Media tester',
        tournamentId: t.id,
        permissions: { create: { permissionKey: 'media.upload' } },
      },
    });
    await db.userRole.create({ data: { tournamentId: t.id, userId: user.id, roleId: role.id } });
    const token = randomBytes(32).toString('base64url');
    tokens.push(token);
    await db.session.create({
      data: {
        id: createHash('sha256').update(token).digest('hex'),
        userId: user.id,
        expiresAt: new Date(Date.now() + 600000),
      },
    });
  }
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffaaaa' } })
    .png()
    .toBuffer();
  async function upload(index: number, tournamentIndex = index, type = 'image/png') {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(image)], { type }), 'banner.png');
    return fetch(`${origin}/api/media?tournament=${slugs[tournamentIndex]}`, {
      method: 'POST',
      headers: { Origin: origin, Cookie: `${cookie}=${tokens[index]}` },
      body: form,
    });
  }
  assert.equal((await upload(0, 1)).status, 403);
  assert.equal((await upload(0, 0, 'image/svg+xml')).status, 400);
  const created = await upload(0);
  assert.equal(created.status, 200);
  const asset = (await created.json()) as { id: string; url: string; size: number };
  assert.equal((await fetch(origin + asset.url)).status, 404);
  assert.equal(
    (await fetch(origin + asset.url, { headers: { Cookie: `${cookie}=${tokens[1]}` } })).status,
    404,
  );
  const privateResponse = await fetch(origin + asset.url, {
    headers: { Cookie: `${cookie}=${tokens[0]}` },
  });
  assert.equal(privateResponse.status, 200);
  assert.equal(privateResponse.headers.get('content-type'), 'image/webp');
  assert.equal((await privateResponse.arrayBuffer()).byteLength, asset.size);
  await db.tournamentSettings.update({
    where: { tournamentId: tournaments[0] },
    data: { banner: asset.url },
  });
  assert.equal((await fetch(origin + asset.url)).status, 200);
  const deletion = (index: number) =>
    fetch(`${origin}${asset.url}?tournament=${slugs[index]}`, {
      method: 'DELETE',
      headers: { Origin: origin, Cookie: `${cookie}=${tokens[index]}` },
    });
  assert.equal((await deletion(1)).status, 404);
  assert.equal((await deletion(0)).status, 409);
  await db.tournamentSettings.update({
    where: { tournamentId: tournaments[0] },
    data: { banner: '' },
  });
  assert.equal((await deletion(0)).status, 200);
  assert.equal((await fetch(origin + asset.url)).status, 404);
  console.log(
    'Container media API: image optimization, publication, ownership, cross-tournament isolation and authorized deletion passed.',
  );
} finally {
  await db.auditLog.deleteMany({ where: { tournamentId: { in: tournaments } } });
  await db.userRole.deleteMany({ where: { userId: { in: users } } });
  await db.rolePermission.deleteMany({ where: { role: { tournamentId: { in: tournaments } } } });
  await db.role.deleteMany({ where: { tournamentId: { in: tournaments } } });
  await db.tournament.deleteMany({ where: { id: { in: tournaments } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
}
