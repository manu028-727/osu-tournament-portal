import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { db } from '../../src/lib/db';
import { createSession } from '../../src/lib/auth';

assert.equal(new URL(process.env.DATABASE_URL!).pathname, '/platform_visual_test');
assert.equal(process.env.ALLOW_ISOLATED_CONTAINER_TESTS, 'yes');
const origin = process.env.APP_URL!;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const before = process.argv.includes('--before');
const output = `.data/visual/pilot-${before ? 'before' : 'after'}`;
const root = '/t/visual-review';
const admin = root + '/admin';
const browser = await chromium.launch();
try {
  const user = await db.user.findUniqueOrThrow({ where: { osuId: 990200011 } });
  const session = await createSession(user.id);
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.addCookies([
    {
      name: 'tournament_session',
      value: session.raw,
      url: origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await mkdir(output, { recursive: true });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.url().includes('/api/admin/') && response.status() >= 400)
      errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  const report = [];
  for (const [name, route] of [
    ['home', root],
    ['workspace', admin],
    ['editor', admin + '/homepage'],
  ]) {
    for (const width of before ? [1366, 390] : [320, 375, 390, 768, 1366, 1920]) {
      await page.setViewportSize({ width, height: width >= 1366 ? 900 : 844 });
      const response = await page.goto(origin + route, { waitUntil: 'networkidle' });
      await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      report.push({ name, width, status: response?.status(), overflow });
      assert.equal(response?.status(), 200);
      assert.equal(overflow, false, `${name} overflows at ${width}`);
    }
  }
  if (!before) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin + admin, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'More', exact: true }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Rules', exact: true })).toBeVisible();
    const menuBox = await menu.boundingBox();
    assert.ok(menuBox && menuBox.x >= 0 && menuBox.x + menuBox.width <= 390);
    await page.screenshot({ path: `${output}/navigation-390.png` });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'More', exact: true })).toBeFocused();
    await page
      .getByRole('navigation', { name: 'Administration', exact: true })
      .getByRole('link', { name: 'Homepage', exact: true })
      .click();
    await expect(page).toHaveURL(origin + admin + '/homepage');
    const field = page.getByLabel('Page title', { exact: true });
    const original = (await field.inputValue()).replace(/(?: draft check(?: \d+)?)+$/, '');
    const endpoint = origin + '/api/admin/data?section=homepage&tournament=visual-review';
    const initial = await (await context.request.get(endpoint)).json();
    await field.fill(original + ` draft check ${Date.now()}`);
    const saveResponse = page.waitForResponse(
      (r) => r.url().includes('/api/admin/action') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    assert.equal((await saveResponse).status(), 200);
    await expect(page.getByRole('status')).toContainText('Draft saved.');
    const saved = await (await context.request.get(endpoint)).json();
    assert.notEqual(saved.draftRevisionId, initial.draftRevisionId);
    assert.equal(saved.publishedRevisionId, initial.publishedRevisionId);
    await page.getByRole('button', { name: 'Preview draft', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.screenshot({ path: `${output}/draft-preview-390.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await field.fill(original);
    const restored = page.waitForResponse(
      (r) => r.url().includes('/api/admin/action') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    assert.equal((await restored).status(), 200);
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByLabel('Page title', { exact: true })).toHaveValue(original);
    await page.getByRole('button', { name: 'Page options', exact: true }).click();
    await page.getByRole('button', { name: 'Revision history', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Revision history', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    const guest = await browser.newContext();
    assert.equal((await guest.request.get(endpoint)).status(), 401);
    const publicHtml = await (await guest.request.get(origin + root)).text();
    assert.ok(!publicHtml.includes('draft check'));
    await page.goto(origin + root, { waitUntil: 'networkidle' });
    const navigation = page.getByRole('button', { name: 'Open navigation', exact: true });
    await navigation.click();
    await page
      .getByRole('navigation', { name: 'Mobile navigation', exact: true })
      .getByRole('link', { name: 'Mappools', exact: true })
      .click();
    await expect(page).toHaveURL(origin + root + '/mappools');
    await expect(
      page.getByRole('link', { name: 'Visual Test Tournament home', exact: true }),
    ).toContainText('Visual Test Tournament');
    await page.getByRole('link', { name: 'Visual Test Tournament home', exact: true }).click();
    await expect(
      page.getByRole('link', { name: 'Visual Test Tournament home', exact: true }),
    ).not.toContainText('Visual Test Tournament');
    await page.goto(origin + admin, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Unpublish', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Unpublished', exact: true })).toBeVisible();
    assert.equal((await guest.request.get(origin + root)).status(), 404);
    await page.getByRole('link', { name: 'Edit homepage', exact: true }).click();
    await expect(page.getByLabel('Page title', { exact: true })).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Administration' })
      .getByRole('link', { name: 'Overview', exact: true })
      .click();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Published', exact: true })).toBeVisible();
    assert.equal((await guest.request.get(origin + root)).status(), 200);
    await guest.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ report, errors }, null, 2));
  console.log(JSON.stringify({ checks: report.length, errors }));
} finally {
  await browser.close();
  await db.$disconnect();
}
