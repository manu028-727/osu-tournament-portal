import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, expect, type Page, type BrowserContext } from '@playwright/test';
import { db } from '../../src/lib/db';
import { createSession } from '../../src/lib/auth';
import { themeStyle, contrast } from '../../src/lib/theme';

assert.equal(new URL(process.env.DATABASE_URL!).pathname, '/platform_visual_test');
assert.equal(process.env.ALLOW_ISOLATED_CONTAINER_TESTS, 'yes');
const origin = process.env.APP_URL!;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const root = '/t/visual-review',
  admin = root + '/admin';
const before = process.argv.includes('--before');
const output = process.env.PROFILE_OUTPUT || `.data/visual/profile-${before ? 'before' : 'after'}`;
const browser = await chromium.launch();
const user = await db.user.findUniqueOrThrow({ where: { osuId: 990200011 } });
const session = await createSession(user.id);
async function authenticated(context: BrowserContext) {
  await context.addCookies([
    {
      name: 'tournament_session',
      value: session.raw,
      url: origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}
async function checked(context: BrowserContext, path: string, body?: unknown) {
  const response = body
    ? await context.request.post(origin + path, { headers: { Origin: origin }, data: body })
    : await context.request.get(origin + path);
  assert.equal(response.status(), 200, `${path}: ${await response.text()}`);
  return response.json();
}
async function settings(context: BrowserContext, changes: Record<string, unknown>) {
  const t = await checked(context, '/api/admin/data?section=settings&tournament=visual-review');
  await checked(context, '/api/admin/action?tournament=visual-review', {
    ...t,
    ...t.settings,
    ...changes,
    type: 'settings.save',
    baseVersion: t.version,
  });
}
async function setAppearance(page: Page, value: 'Light' | 'Dark' | 'System') {
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('menuitemradio', { name: value, exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', value.toLowerCase());
}
try {
  await mkdir(output, { recursive: true });
  const setup = await browser.newContext();
  await authenticated(setup);
  if (process.argv.includes('--prepare')) {
    assert.ok(process.env.PROFILE_BANNER_FILE, 'Set PROFILE_BANNER_FILE to your local QA artwork.');
    const image = await readFile(process.env.PROFILE_BANNER_FILE);
    const uploaded = await setup.request.post(origin + '/api/media?tournament=visual-review', {
      headers: { Origin: origin },
      multipart: {
        file: { name: 'User-supplied profile QA banner.png', mimeType: 'image/png', buffer: image },
      },
    });
    assert.equal(uploaded.status(), 200, await uploaded.text());
    const asset = await uploaded.json();
    await settings(setup, { banner: asset.url });
    const p = await checked(setup, '/api/admin/data?section=homepage&tournament=visual-review');
    const revision = p.draftRevision || p.publishedRevision;
    await checked(setup, '/api/admin/action?tournament=visual-review', {
      type: 'page.save',
      slug: 'home',
      title: revision.title,
      html: revision.html,
      blocks: revision.blocks.map((block: { type: string; content: object }) =>
        block.type === 'hero'
          ? { ...block, content: { ...block.content, image: asset.url } }
          : block,
      ),
      baseRevisionId: p.draftRevisionId,
    });
    const saved = await checked(setup, '/api/admin/data?section=homepage&tournament=visual-review');
    await checked(setup, '/api/admin/action?tournament=visual-review', {
      type: 'page.publish',
      slug: 'home',
      revisionId: saved.draftRevisionId,
    });
    if (!(await db.tournament.findUnique({ where: { slug: 'profile-empty' } }))) {
      const created = await checked(setup, '/api/tournaments', {
        type: 'create',
        name: 'Unbranded QA Tournament with a deliberately long name',
        acronym: 'QA',
        slug: 'profile-empty',
        gameMode: 'osu',
        format: 'TEAMS',
        description: '',
        timezone: 'UTC',
      });
      await checked(setup, '/api/tournaments', {
        type: 'lifecycle',
        id: created.id,
        baseVersion: 1,
        published: true,
        archived: false,
      });
    }
    console.log('Real banner uploaded through CMS; isolated empty tournament prepared.');
  }
  const report: {
    name: string;
    mode: string;
    width: number;
    status?: number;
    overflow: boolean;
    geometry?: unknown;
  }[] = [];
  const errors: string[] = [];
  for (const mode of before ? ['dark'] : ['dark', 'light']) {
    const context = await browser.newContext({
      colorScheme: mode as 'dark' | 'light',
      reducedMotion: 'reduce',
    });
    await authenticated(context);
    await context.addCookies([{ name: 'portal_appearance', value: mode, url: origin }]);
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    for (const [name, route] of [
      ['home', root],
      ['workspace', admin],
      ['editor', admin + '/homepage'],
      ['mappool', root + '/mappools/quarterfinals'],
    ]) {
      for (const width of before ? [1366, 390] : [320, 375, 390, 768, 1024, 1366, 1920]) {
        await page.setViewportSize({ width, height: width >= 1024 ? 900 : 844 });
        const response = await page.goto(origin + route, { waitUntil: 'networkidle' });
        await page.screenshot({ path: `${output}/${name}-${mode}-${width}.png`, fullPage: true });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        );
        const geometry =
          name === 'mappool'
            ? await page.locator('li[data-slot]').evaluateAll((elements) =>
                elements.map((el) => {
                  const r = el.getBoundingClientRect();
                  return {
                    slot: el.getAttribute('data-slot'),
                    width: Math.round(r.width),
                    height: Math.round(r.height),
                    x: Math.round(r.x),
                  };
                }),
              )
            : undefined;
        report.push({ name, mode, width, status: response?.status(), overflow, geometry });
        assert.equal(response?.status(), 200);
        assert.equal(overflow, false, `${name} ${mode} ${width}`);
        if (!before && name === 'home') {
          await expect(
            page.getByRole('navigation', { name: 'Tournament navigation' }),
          ).toBeVisible();
          const banner = page.getByRole('img', {
            name: 'Visual Test Tournament banner',
            exact: true,
          });
          const imageBox = await banner.boundingBox(),
            headingBox = await page
              .getByRole('banner', { name: 'Tournament profile', exact: true })
              .locator('p')
              .first()
              .boundingBox();
          assert.ok(imageBox && headingBox && headingBox.y >= imageBox.y + imageBox.height);
          assert.equal(
            await banner.evaluate(
              (el: HTMLImageElement) =>
                el.naturalWidth > 0 && getComputedStyle(el).objectFit === 'contain',
            ),
            true,
          );
        }
      }
    }
    await context.close();
  }
  if (!before) {
    const baseline = JSON.parse(await readFile('.data/visual/profile-before/report.json', 'utf8'));
    for (const row of report.filter(
      (r) => r.name === 'mappool' && r.mode === 'dark' && [1366, 390].includes(r.width),
    )) {
      assert.deepEqual(
        row.geometry,
        baseline.report.find((r: typeof row) => r.name === row.name && r.width === row.width)
          .geometry,
        'Mappool geometry/order changed',
      );
    }
    const page = await setup.newPage();
    page.setDefaultTimeout(30000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(origin + root, { waitUntil: 'networkidle' });
    await setAppearance(page, 'Light');
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
    await page
      .getByRole('navigation', { name: 'Tournament navigation' })
      .getByRole('link', { name: 'Mappools', exact: true })
      .click();
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
    await page.goto(origin + root, { waitUntil: 'networkidle' });
    await setAppearance(page, 'System');
    await page.emulateMedia({ colorScheme: 'dark' });
    assert.equal(
      await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor),
      'rgb(35, 31, 35)',
    );
    await page.emulateMedia({ colorScheme: 'light' });
    assert.equal(
      await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor),
      'rgb(248, 245, 246)',
    );
    const original = await checked(
      setup,
      '/api/admin/data?section=settings&tournament=visual-review',
    );
    try {
      for (const [label, color] of Object.entries({
        pink: '#e96ca8',
        green: '#32b877',
        blue: '#18386f',
        orange: '#e77b22',
        yellow: '#fff5a6',
        purple: '#8859c5',
      })) {
        await settings(setup, { primaryColor: color, accentColor: color });
        for (const mode of ['dark', 'light'] as const) {
          await page.goto(origin + root, { waitUntil: 'networkidle' });
          await setAppearance(page, mode === 'dark' ? 'Dark' : 'Light');
          assert.equal(
            await page
              .locator('main')
              .evaluate((el) => getComputedStyle(el).getPropertyValue('--brand-original').trim()),
            color,
          );
          const palette = themeStyle(color);
          assert.ok(
            contrast(
              palette[mode === 'dark' ? '--brand-dark' : '--brand-light'],
              mode === 'dark' ? '#302b30' : '#ffffff',
            ) >= 4.5,
          );
          await page.screenshot({ path: `${output}/accent-${label}-${mode}.png`, fullPage: true });
        }
      }
      for (const mode of ['dark', 'light'] as const) {
        await setAppearance(page, mode === 'dark' ? 'Dark' : 'Light');
        for (const width of [320, 1366]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(origin + '/t/profile-empty', { waitUntil: 'networkidle' });
          assert.equal(await page.getByRole('img', { name: /banner$/ }).count(), 0);
          assert.equal(await page.getByRole('heading', { level: 1 }).count(), 1);
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
          );
          assert.notEqual(
            await page
              .locator('main')
              .evaluate((el) => getComputedStyle(el).getPropertyValue('--brand-original').trim()),
            '#8859c5',
          );
          await page.screenshot({
            path: `${output}/missing-banner-${mode}-${width}.png`,
            fullPage: true,
          });
        }
      }
    } finally {
      await settings(setup, {
        primaryColor: original.settings.primaryColor,
        accentColor: original.settings.accentColor,
      });
    }
    await page.goto(origin + admin + '/homepage', { waitUntil: 'networkidle' });
    const field = page.getByLabel('Page title', { exact: true }),
      title = await field.inputValue();
    const old = await checked(setup, '/api/admin/data?section=homepage&tournament=visual-review');
    await field.fill(title + ' QA draft');
    const response = page.waitForResponse(
      (r) => r.url().includes('/api/admin/action') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    assert.equal((await response).status(), 200);
    await expect(page.getByRole('button', { name: 'Preview draft', exact: true })).toBeEnabled();
    const saved = await checked(setup, '/api/admin/data?section=homepage&tournament=visual-review');
    assert.equal(saved.publishedRevisionId, old.publishedRevisionId);
    await page.getByRole('button', { name: 'Preview draft', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await field.fill(title);
    const restore = page.waitForResponse(
      (r) => r.url().includes('/api/admin/action') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    assert.equal((await restore).status(), 200);
    const guest = await browser.newContext();
    assert.equal(
      (
        await guest.request.get(
          origin + '/api/admin/data?section=homepage&tournament=visual-review',
        )
      ).status(),
      401,
    );
    await guest.close();
  }
  await writeFile(`${output}/report.json`, JSON.stringify({ report, errors }, null, 2));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks: report.length, errors }));
} finally {
  await browser.close();
  await db.$disconnect();
}
