import { test, expect } from '@playwright/test';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertTestDatabase } from '../../src/lib/instance';

assertTestDatabase(process.env.TEST_DATABASE_URL);
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
const id = randomUUID(),
  slug = `pagination-${id}`,
  userId = randomUUID(),
  raw = randomBytes(32).toString('base64url');
const assets = Array.from({ length: 201 }, (_, index) => ({
  id: randomUUID(),
  key: `${randomUUID()}.webp`,
  name: `Synthetic image ${index}`,
}));
const uploadRoot = path.resolve('.data/test-uploads');
test.beforeAll(async () => {
  await db.user.create({
    data: {
      id: userId,
      osuId: randomInt(1_900_000_000, 2_000_000_000),
      username: slug,
      avatarUrl: '',
      profileUrl: '',
      platformAdmin: true,
      sessions: {
        create: {
          id: createHash('sha256').update(raw).digest('hex'),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      },
    },
  });
  await db.tournament.create({
    data: {
      id,
      slug,
      name: 'Pagination QA',
      acronym: 'QA',
      description: '',
      published: true,
      settings: {
        create: {
          gameplayScoring: 'SCORE_V2',
          banner: '',
          registrationUrl: '',
          socialLinks: [],
          importantDates: [],
          navigation: [],
          footer: '',
        },
      },
    },
  });
  await db.team.createMany({
    data: Array.from({ length: 101 }, (_, index) => ({
      tournamentId: id,
      name: `Entrant ${String(index).padStart(3, '0')}`,
      slug: `entrant-${index}`,
      status: 'APPROVED',
      published: true,
    })),
  });
  const stage = await db.tournamentStage.create({
    data: { tournamentId: id, name: 'Fixtures', slug: 'fixtures' },
  });
  const side = (name: string) => ({
    id: null,
    name,
    slug: '',
    format: 'TEAM',
    logoImageId: null,
    members: [],
  });
  await db.match.createMany({
    data: Array.from({ length: 101 }, (_, index) => ({
      tournamentId: id,
      stageId: stage.id,
      code: `fixture-${String(index).padStart(3, '0')}`,
      rules: {},
      participants: { A: side(`Red ${index}`), B: side(`Blue ${index}`) },
      published: true,
    })),
  });
  const image = await readFile('public/test-image.webp');
  await mkdir(uploadRoot, { recursive: true });
  await Promise.all(
    assets.map((asset) => writeFile(path.join(uploadRoot, asset.key), image, { flag: 'wx' })),
  );
  await db.mediaAsset.createMany({
    data: assets.map((asset) => ({
      ...asset,
      tournamentId: id,
      mimeType: 'image/webp',
      size: image.length,
      width: 1,
      height: 1,
    })),
  });
});
test.afterAll(async () => {
  await db.match.deleteMany({ where: { tournamentId: id } });
  await db.team.deleteMany({ where: { tournamentId: id } });
  await db.mediaAsset.deleteMany({ where: { tournamentId: id } });
  await db.auditLog.deleteMany({ where: { tournamentId: id } });
  await db.tournament.deleteMany({ where: { id } });
  await db.user.deleteMany({ where: { id: userId } });
  await Promise.all(
    assets.map((asset) =>
      unlink(path.join(uploadRoot, asset.key)).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      }),
    ),
  );
  await db.$disconnect();
});

test('lists expose continuation, global team search, complete exports and responsive controls', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await context.addCookies([
    { name: 'tournament_session', value: raw, url: 'http://localhost:3001' },
  ]);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const root = `/t/${slug}`;
  await page.goto(`${root}/teams`);
  await page
    .getByRole('navigation', { name: 'Pagination' })
    .first()
    .getByRole('link', { name: 'Next', exact: true })
    .click();
  await expect(page).toHaveURL(`http://localhost:3001${root}/teams?page=2`);
  await expect(page.getByRole('heading', { name: 'Entrant 050', exact: true })).toBeVisible();
  const api = await context.request.get(`/api/public/teams?tournament=${slug}&paged=1&page=3`);
  expect(await api.json()).toMatchObject({ total: 101, page: 3, items: [{ name: 'Entrant 100' }] });
  await page.goto(`${root}/admin/teams`);
  await page
    .getByRole('navigation', { name: 'Pagination' })
    .getByRole('button', { name: 'Next', exact: true })
    .click();
  await expect(page.getByRole('cell', { name: 'Entrant 100', exact: false }).first()).toBeVisible();
  await page.getByLabel('Search teams or players').fill('Entrant 100');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Pagination' })).toHaveCount(0);
  const csv = await context.request.get(`/api/admin/teams/export?tournament=${slug}`);
  expect(csv.status()).toBe(200);
  expect((await csv.text()).trimEnd().split('\r\n')).toHaveLength(102);
  await page.goto(`${root}/admin/website?view=media`);
  const navigation = page.getByRole('navigation', { name: 'Pagination' });
  await navigation.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(navigation).toContainText('Page 2 of 3');
  await navigation.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(navigation).toContainText('Page 3 of 3');
  await expect(page.getByRole('img', { name: /Synthetic image/ })).toHaveCount(1);
  for (const appearance of ['light', 'dark']) {
    await context.addCookies([
      { name: 'portal_appearance', value: appearance, url: 'http://localhost:3001' },
    ]);
    for (const [name, route] of [
      ['teams', '/teams'],
      ['matches', '/matches'],
      ['admin-teams', '/admin/teams'],
      ['media', '/admin/website?view=media'],
    ]) {
      await page.goto(root + route);
      const pagination = page.getByRole('navigation', { name: 'Pagination' }).first();
      await expect(pagination).toBeVisible();
      for (const width of [1920, 1366, 1024, 768, 390, 375, 320, 844, 683]) {
        await page.setViewportSize({
          width,
          height: width === 844 ? 390 : width === 683 ? 450 : 900,
        });
        await pagination.scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: `.data/cleanup-20261024/pagination/${name}-${appearance}-${width}.png`,
        });
      }
    }
  }
  expect(errors).toEqual([]);
});
