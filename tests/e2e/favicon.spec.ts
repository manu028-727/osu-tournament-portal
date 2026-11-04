import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertTestDatabase } from '../../src/lib/instance';

assertTestDatabase(process.env.TEST_DATABASE_URL);
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
const evidence = '.data/favicon-20261104';
const plain = `favicon-${randomUUID()}`,
  branded = `favicon-${randomUUID()}`;
const platformIcon = '/test-image.webp?platform',
  tournamentIcon = '/test-image.webp?tournament';
const defaults = { icon: ['/favicon.ico', '/favicon.svg'], apple: ['/apple-icon.png'] };
let savedFavicon: string | null = null;

test.beforeAll(async () => {
  savedFavicon = (await db.platformSettings.findUnique({ where: { id: 'main' } }))?.favicon ?? null;
  await db.platformSettings.upsert({
    where: { id: 'main' },
    create: { id: 'main' },
    update: { favicon: '' },
  });
  for (const slug of [plain, branded])
    await db.tournament.create({
      data: {
        id: slug,
        slug,
        name: 'Favicon Cup',
        acronym: 'FC',
        description: '',
        status: 'UPCOMING',
        published: true,
        settings: {
          create: {
            favicon: slug === branded ? tournamentIcon : '',
            socialLinks: [],
            importantDates: [],
            navigation: [],
            footer: '',
          },
        },
      },
    });
});
test.afterAll(async () => {
  await db.tournament.deleteMany({ where: { id: { in: [plain, branded] } } });
  if (savedFavicon === null) await db.platformSettings.delete({ where: { id: 'main' } });
  else await db.platformSettings.update({ where: { id: 'main' }, data: { favicon: savedFavicon } });
  await db.$disconnect();
});

async function icons(page: Page, path: string) {
  await page.goto(path);
  const hrefs = (rel: string) =>
    page
      .locator(`link[rel="${rel}"]`)
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  return { icon: await hrefs('icon'), apple: await hrefs('apple-touch-icon') };
}

test('pages without a saved favicon use the default icon', async ({ page }) => {
  for (const path of [
    '/tournaments',
    '/admin',
    '/no-such-page',
    `/t/${plain}`,
    `/t/${plain}/rules`,
  ])
    expect(await icons(page, path), path).toEqual(defaults);
});

test('saved favicons replace the default, and tournaments inherit the platform one', async ({
  page,
}) => {
  expect(await icons(page, `/t/${branded}`)).toEqual({ icon: [tournamentIcon], apple: [] });
  expect(await icons(page, `/t/${plain}`)).toEqual(defaults);
  await db.platformSettings.update({ where: { id: 'main' }, data: { favicon: platformIcon } });
  const platform = { icon: [platformIcon], apple: [] };
  expect(await icons(page, '/tournaments')).toEqual(platform);
  expect(await icons(page, `/t/${plain}`)).toEqual(platform);
  expect(await icons(page, `/t/${branded}`)).toEqual({ icon: [tournamentIcon], apple: [] });
  await db.platformSettings.update({ where: { id: 'main' }, data: { favicon: '' } });
});

test('the default icon files are served and render in both appearances', async ({
  page,
  context,
  request,
}) => {
  const svg = await request.get('/favicon.svg');
  expect(svg.headers()['content-type']).toContain('image/svg+xml');
  const png = await request.get('/apple-icon.png');
  expect(png.headers()['content-type']).toContain('image/png');
  const ico = await request.get('/favicon.ico');
  expect(ico.ok()).toBe(true);
  // Bytes 4-5 of an ICO header hold its image count: 16, 32 and 48px here.
  expect((await ico.body()).readUInt16LE(4)).toBe(3);

  for (const appearance of ['light', 'dark']) {
    await context.addCookies([
      { name: 'portal_appearance', value: appearance, url: 'http://localhost:3001' },
    ]);
    await page.goto('/tournaments');
    await page.evaluate(async () => {
      const sheet = document.createElement('div');
      sheet.style.cssText =
        'position:fixed;inset:0;z-index:999;display:flex;flex-wrap:wrap;gap:24px;align-items:center;padding:24px;background:var(--page)';
      const sources: [string, number][] = [
        ['/favicon.svg', 16],
        ['/favicon.svg', 32],
        ['/favicon.svg', 180],
        ['/favicon.ico', 16],
        ['/favicon.ico', 32],
        ['/favicon.ico', 48],
        ['/apple-icon.png', 180],
      ];
      const images = sources.map(([source, size]) => {
        const image = new Image(size, size);
        image.src = source;
        return image;
      });
      sheet.append(...images);
      document.body.append(sheet);
      await Promise.all(images.map((image) => image.decode()));
    });
    await page.screenshot({ path: `${evidence}/icons-${appearance}.png` });
  }
});
