import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomBytes } from 'node:crypto';
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
const prefix = `multie2e-${Date.now()}`;
const raw = randomBytes(32).toString('base64url');
let userId: string;
test.beforeAll(async () => {
  if (new URL(process.env.TEST_DATABASE_URL!).pathname !== '/tournament_platform_test')
    throw Error('Test DB only.');
  userId = (
    await db.user.create({
      data: {
        osuId: 989300001,
        username: prefix,
        avatarUrl: 'https://a.ppy.sh/1',
        profileUrl: '',
        platformAdmin: true,
        sessions: {
          create: {
            id: createHash('sha256').update(raw).digest('hex'),
            expiresAt: new Date(Date.now() + 3600000),
          },
        },
      },
    })
  ).id;
});
test.afterAll(async () => {
  for (const t of await db.tournament.findMany({ where: { slug: { startsWith: prefix } } })) {
    await db.page.updateMany({
      where: { tournamentId: t.id },
      data: { draftRevisionId: null, publishedRevisionId: null },
    });
    await db.auditLog.deleteMany({ where: { tournamentId: t.id } });
    await db.role.deleteMany({ where: { tournamentId: t.id } });
    await db.tournament.delete({ where: { id: t.id } });
  }
  await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
});
test('directory OAuth links use document navigation instead of a client-router fetch', async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route('**/api/auth/login?**', async (route) => {
    requests.push(route.request().resourceType());
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<title>OAuth navigation check</title>',
    });
  });
  await page.goto('/tournaments');
  await page.getByRole('link', { name: 'Login with osu!', exact: true }).click();
  await expect(page).toHaveTitle('OAuth navigation check');
  expect(requests).toEqual(['document']);
});
test('the platform chooser hides tournament navigation and unscoped editor URLs return safely', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  const adminRequests: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (r.url().includes('/api/admin/')) adminRequests.push(r.url());
  });
  await context.addCookies([
    {
      name: 'tournament_session',
      value: raw,
      url: 'http://localhost:3001',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto('/admin/tournaments');
  await expect(
    page.getByRole('navigation', { name: 'Administration' }).getByRole('link'),
  ).toHaveCount(1);
  await page.goto('/admin/homepage');
  await expect(page).toHaveURL('http://localhost:3001/admin/tournaments');
  await page.goto('/admin/settings');
  await expect(page).toHaveURL('http://localhost:3001/admin/tournaments');
  expect(errors).toEqual([]);
  expect(adminRequests).toEqual([]);
});
test('creates private tournaments, switches scoped CMS contexts and publishes independent websites', async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await context.addCookies([
    {
      name: 'tournament_session',
      value: raw,
      url: 'http://localhost:3001',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto('/admin/tournaments');
  for (const suffix of ['a', 'b']) {
    await page.getByRole('button', { name: 'Create tournament', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill(`${prefix}-${suffix}`);
    await dialog.getByLabel('Acronym').fill(suffix.toUpperCase());
    await dialog.getByLabel('URL slug').fill(`${prefix}-${suffix}`);
    await dialog.getByRole('button', { name: 'Create tournament', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: `${prefix}-${suffix}`, exact: true }),
    ).toBeVisible();
  }
  const visitor = await browser.newContext();
  try {
    expect((await visitor.request.get(`/t/${prefix}-b`)).status()).toBe(404);
    for (const suffix of ['a', 'b']) {
      await page.goto('/admin/tournaments');
      await page.locator(`a[href="/t/${prefix}-${suffix}/admin"]`).click();
      await page.getByRole('link', { name: 'Website', exact: true }).click();
      await page
        .getByRole('navigation', { name: 'Website sections' })
        .getByRole('link', { name: 'Rules', exact: true })
        .click();
      await expect(page).toHaveURL(
        `http://localhost:3001/t/${prefix}-${suffix}/admin/website?view=rules`,
      );
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Rules editor');
      const url = `/api/admin/data?section=rules&tournament=${prefix}-${suffix}`;
      const before = await (await context.request.get(url)).json();
      const saved = await context.request.post(`/api/admin/action?tournament=${prefix}-${suffix}`, {
        headers: { Origin: 'http://localhost:3001' },
        data: {
          type: 'page.save',
          slug: 'rules',
          title: `${suffix} rules only`,
          html: `<h2>${suffix} private draft</h2><h2>Teams &amp; Players</h2>`,
          blocks: [],
          baseRevisionId: before.draftRevisionId,
        },
      });
      expect(saved.ok()).toBe(true);
      const draft = await (await context.request.get(url)).json();
      expect(
        (
          await context.request.post(`/api/admin/action?tournament=${prefix}-${suffix}`, {
            headers: { Origin: 'http://localhost:3001' },
            data: { type: 'page.publish', slug: 'rules', revisionId: draft.draftRevisionId },
          })
        ).ok(),
      ).toBe(true);
      const t = await db.tournament.findUniqueOrThrow({ where: { slug: `${prefix}-${suffix}` } });
      expect(
        (
          await context.request.post('/api/tournaments', {
            headers: { Origin: 'http://localhost:3001' },
            data: {
              type: 'lifecycle',
              id: t.id,
              baseVersion: t.version,
              published: true,
              archived: false,
            },
          })
        ).ok(),
      ).toBe(true);
      const emptyHome = await visitor.newPage();
      await emptyHome.goto(`/t/${prefix}-${suffix}`);
      await expect(
        emptyHome.getByRole('heading', { level: 1, name: `${prefix}-${suffix}`, exact: true }),
      ).toBeVisible();
      expect(await emptyHome.locator('body').innerText()).not.toContain(
        'Gli organizzatori stanno preparando',
      );
      await emptyHome.close();
      await page.goto(`/t/${prefix}-${suffix}/admin/stages`);
      await expect(
        page.getByRole('heading', { name: 'Tournament stages', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'New stage', exact: true }).click();
      await page.getByRole('dialog').getByLabel('Stage name', { exact: true }).fill('Finals');
      await page.getByRole('dialog').getByLabel('URL slug').fill('finals');
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Save stage', exact: true })
        .click();
      await expect(page.getByRole('cell', { name: /Finals/ }).first()).toBeVisible();
    }
    const publicPage = await visitor.newPage();
    await publicPage.goto(`/t/${prefix}-a/rules`);
    await expect(publicPage.getByRole('heading', { level: 1 })).toContainText('a rules only');
    await expect(
      publicPage
        .getByRole('navigation', { name: 'Tournament navigation', exact: true })
        .getByRole('link', { name: 'Teams', exact: true }),
    ).toHaveAttribute('href', `/t/${prefix}-a/teams`);
    await publicPage.goto(`/t/${prefix}-b/rules`);
    await expect(publicPage.getByRole('heading', { level: 1 })).toContainText('b rules only');
    await expect(publicPage.getByRole('navigation', { name: 'Rules sections' })).toContainText(
      'Teams & Players',
    );
    expect(await publicPage.content()).not.toContain('a private draft');
    expect(await publicPage.locator('body').innerText()).not.toMatch(
      /Imported instance branding|16 team|Example legacy copy/,
    );
    await publicPage.goto(`/t/${prefix}-b/mappools`);
    await expect(
      publicPage.getByRole('heading', { name: 'Nessun mappool pubblicato', exact: true }),
    ).toBeVisible();
    await publicPage.screenshot({ path: 'test-results/neutral-copy-desktop.png', fullPage: true });
    await publicPage.setViewportSize({ width: 390, height: 844 });
    await expect(
      publicPage.getByRole('heading', { name: 'Nessun mappool pubblicato', exact: true }),
    ).toBeVisible();
    expect(
      await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await publicPage.screenshot({ path: 'test-results/neutral-copy-mobile.png', fullPage: true });
    await page.screenshot({ path: 'test-results/tournament-stages-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('navigation', { name: 'Administration' })).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Administration' })
        .getByRole('link', { name: 'Website', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: /^Switch tournament:/ }).click();
    const moreMenu = page.getByRole('menu');
    await expect(
      moreMenu.getByRole('menuitem', { name: 'Switch tournament', exact: true }),
    ).toBeVisible();
    const menuBox = await moreMenu.boundingBox();
    expect(menuBox && menuBox.x >= 0 && menuBox.x + menuBox.width <= 390).toBeTruthy();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /^Switch tournament:/ })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'test-results/tournament-stages-mobile.png', fullPage: true });
    await publicPage.goto('/tournaments');
    await expect(
      publicPage.getByRole('heading', { name: `${prefix}-a`, exact: true }),
    ).toBeVisible();
    expect((await visitor.request.get('/t/no-such-event')).status()).toBe(404);
    expect(errors).toEqual([]);
  } finally {
    await visitor.close();
  }
});

test('public tournament profile stays mounted across tabs without duplicate navigation', async ({
  browser,
  context,
}) => {
  test.setTimeout(240000);
  await context.addCookies([
    { name: 'tournament_session', value: raw, url: 'http://localhost:3001' },
  ]);
  const slug = `${prefix}-layout`;
  const headers = { Origin: 'http://localhost:3001' };
  const created = await context.request.post('/api/tournaments', {
    headers,
    data: { type: 'create', name: 'Persistent profile QA', acronym: 'QA', slug, gameMode: 'osu' },
  });
  expect(created.ok()).toBe(true);
  const tournament = await created.json();
  const home = await db.page.findFirstOrThrow({
    where: { tournamentId: tournament.id, slug: 'home' },
  });
  const revision = await db.pageRevision.create({
    data: {
      tournamentId: tournament.id,
      pageId: home.id,
      title: 'Published homepage',
      blocks: {
        create: {
          type: 'hero',
          position: 0,
          visible: true,
          content: {
            title: 'Published profile identity',
            image: '/layout-banner.png',
            text: 'Published homepage body',
          },
        },
      },
    },
  });
  await db.page.update({
    where: { id: home.id },
    data: { state: 'PUBLISHED', publishedRevisionId: revision.id },
  });
  // Leave an independent, unpublished draft to check that the shared layout never exposes it.
  await db.contentBlock.create({
    data: {
      revisionId: home.draftRevisionId!,
      type: 'hero',
      position: 0,
      visible: true,
      content: { title: 'PRIVATE HEADER DRAFT', image: '/private-banner.png' },
    },
  });
  const published = await context.request.post('/api/tournaments', {
    headers,
    data: {
      type: 'lifecycle',
      id: tournament.id,
      baseVersion: 1,
      published: true,
      archived: false,
    },
  });
  expect(published.ok()).toBe(true);
  for (const mode of ['dark', 'light'] as const) {
    for (const width of [1920, 1366, 768, 390, 320]) {
      const visitor = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: mode,
        hasTouch: width <= 768,
      });
      try {
        await visitor.addCookies([
          { name: 'portal_appearance', value: mode, url: 'http://localhost:3001' },
        ]);
        const page = await visitor.newPage();
        const errors: string[] = [],
          documents: string[] = [],
          images: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('request', (request) => {
          if (request.resourceType() === 'document') documents.push(request.url());
          if (request.url().endsWith('/layout-banner.png')) images.push(request.url());
        });
        await page.route('**/layout-banner.png', (route) =>
          route.fulfill({
            contentType: 'image/png',
            body: Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=',
              'base64',
            ),
            headers: { 'Cache-Control': 'no-store' },
          }),
        );
        await page.goto(`/t/${slug}`);
        const profile = page.getByRole('banner', { name: 'Tournament profile', exact: true });
        const banner = profile.getByRole('img', { name: 'Persistent profile QA banner' });
        await expect(banner).toBeVisible();
        await expect(profile).toContainText('Published profile identity');
        const profileNode = await profile.elementHandle(),
          bannerNode = await banner.elementHandle();
        const initialHeight = (await profile.boundingBox())!.height;
        const tabs = page.getByRole('navigation', { name: 'Tournament navigation', exact: true });
        for (const [label, path] of [
          ['Mappools', '/mappools'],
          ['Matches', '/matches'],
          ['Teams', '/teams'],
          ['Staff', '/staff'],
          ['Rules', '/rules'],
          ['Home', ''],
        ]) {
          const link = tabs.getByRole('link', { name: label, exact: true });
          await link.click();
          await expect(page).toHaveURL(`http://localhost:3001/t/${slug}${path}`);
          await expect(link).toHaveAttribute('aria-current', 'page');
          await expect(tabs).toHaveCount(1);
          await expect(
            page.getByRole('banner', { name: 'Platform controls' }).getByRole('link'),
          ).toHaveCount(2);
          expect(await profile.evaluate((node, original) => node === original, profileNode)).toBe(
            true,
          );
          expect(await banner.evaluate((node, original) => node === original, bannerNode)).toBe(
            true,
          );
          expect((await profile.boundingBox())!.height).toBe(initialHeight);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          await expect(page.locator('html')).toHaveAttribute('data-appearance', mode);
          await expect(page.getByText('PRIVATE HEADER DRAFT')).toHaveCount(0);
          await expect(page.locator('img[src="/private-banner.png"]')).toHaveCount(0);
        }
        expect(documents).toHaveLength(1);
        expect(images).toHaveLength(1);
        expect(errors).toEqual([]);
        await page.screenshot({
          path: `test-results/persistent-profile-${mode}-${width}.png`,
          fullPage: true,
        });
      } finally {
        await visitor.close();
      }
    }
  }
});
