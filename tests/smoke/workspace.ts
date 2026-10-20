import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect as playwrightExpect, type APIRequestContext } from '@playwright/test';
import { db } from '../../src/lib/db';
import { loginUser, createSession } from '../../src/lib/auth';

const origin = process.env.APP_URL!;
if (
  process.env.ALLOW_ISOLATED_CONTAINER_TESTS !== 'yes' ||
  !/^\/platform_workspace_(dev|prod)_test$/.test(new URL(process.env.DATABASE_URL!).pathname) ||
  !['localhost', '127.0.0.1'].includes(new URL(origin).hostname)
)
  throw new Error(
    'Only explicitly isolated empty workspace test databases and loopback servers are accepted.',
  );
assert.equal(
  await db.tournament.count(),
  0,
  'Start with a genuinely empty installation, without the main fixture.',
);
assert.equal(await db.user.count(), 0);
const expect = playwrightExpect.configure({ timeout: 30000 });
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch();
const errors: string[] = [];
try {
  const owner = await loginUser({
    id: 990200001,
    username: 'Isolated designated owner',
    avatar_url: 'https://a.ppy.sh/1',
  });
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).platformAdmin, true);
  const context = await browser.newContext();
  const visitor = await browser.newContext();
  const session = await createSession(owner.id);
  await context.addCookies([
    {
      name: 'tournament_session',
      value: session.raw,
      url: origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.url().includes('/api/admin/') && r.status() >= 400)
      errors.push(`${r.status()} ${new URL(r.url()).pathname}${new URL(r.url()).search}`);
  });
  async function post(api: APIRequestContext, path: string, data: unknown, status = 200) {
    const r = await api.post(origin + path, { headers: { Origin: origin }, data });
    const result = await r.json();
    assert.equal(r.status(), status, JSON.stringify(result));
    return result;
  }
  async function get(api: APIRequestContext, slug: string, section: string, status = 200) {
    const r = await api.get(`${origin}/api/admin/data?section=${section}&tournament=${slug}`);
    assert.equal(r.status(), status, await r.text());
    assert.match(r.headers()['cache-control'], /no-store/);
    return r.json();
  }
  async function visit(slug: string, path: string, section: string) {
    const loaded = page.waitForResponse(
      (r) => {
        const u = new URL(r.url());
        return (
          u.pathname === '/api/admin/data' &&
          u.searchParams.get('section') === section &&
          u.searchParams.get('tournament') === slug
        );
      },
      { timeout: 60000 },
    );
    await page.goto(`${origin}/t/${slug}/admin${path ? '/' + path : ''}`);
    assert.equal((await loaded).status(), 200);
    await expect(page.locator('main h1').first()).toBeVisible();
    await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
  }
  await page.goto(origin + '/admin/tournaments');
  const navigation = page.getByRole('navigation', { name: 'Administration', exact: true });
  await expect(navigation.getByRole('link')).toHaveCount(1);
  for (const section of ['settings', 'matches', 'referee', 'referees', 'stages', 'homepage']) {
    const url = `${origin}/api/admin/data?section=${section}`;
    assert.equal((await visitor.request.get(url)).status(), 401);
    const r = await context.request.get(url);
    assert.equal(r.status(), 400);
    assert.match((await r.json()).error, /Select a tournament/);
  }
  await page.goto(origin + '/admin/homepage');
  await expect(page).toHaveURL(origin + '/admin/tournaments');
  await page.getByRole('button', { name: 'Create tournament', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Fresh First Cup');
  await dialog.getByLabel('Acronym', { exact: true }).fill('FFC');
  await dialog.getByLabel('URL slug').fill('fresh-first-cup');
  await dialog.getByRole('button', { name: 'Create tournament', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Fresh First Cup', exact: true })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Homepage', exact: true })).toHaveCount(0);
  const first = await db.tournament.findUniqueOrThrow({ where: { slug: 'fresh-first-cup' } });
  assert.equal(first.published, false);
  assert.equal((await visitor.request.get(origin + '/t/fresh-first-cup')).status(), 404);
  await page.locator('a[href="/t/fresh-first-cup/admin"]').click();
  await expect(page).toHaveURL(origin + '/t/fresh-first-cup/admin');
  await expect(navigation.getByRole('link', { name: 'Homepage', exact: true })).toHaveAttribute(
    'href',
    '/t/fresh-first-cup/admin/homepage',
  );

  const sections = [
    '',
    'homepage',
    'rules',
    'settings',
    'stages',
    'mappools',
    'teams',
    'matches',
    'referee',
    'staff',
    'media',
    'users',
    'roles',
    'audit',
    'sheet-data',
  ];
  for (const path of sections) {
    const section = path || 'overview';
    await visit(first.slug, path, section);
    await get(context.request, first.slug, section);
  }
  assert.deepEqual((await get(context.request, first.slug, 'stages')).stages, []);
  assert.deepEqual((await get(context.request, first.slug, 'mappools')).stages, []);
  assert.deepEqual(await get(context.request, first.slug, 'teams'), []);
  assert.deepEqual((await get(context.request, first.slug, 'matches')).matches, []);
  assert.deepEqual((await get(context.request, first.slug, 'referee')).matches, []);
  assert.deepEqual(await get(context.request, first.slug, 'referees'), [
    { id: owner.id, osuId: owner.osuId, username: owner.username, avatarUrl: owner.avatarUrl },
  ]);
  await visit(first.slug, 'homepage', 'homepage');
  await page.getByLabel('Page title', { exact: true }).fill('First homepage draft');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved');
  const home = await get(context.request, first.slug, 'homepage');
  assert.equal(home.state, 'DRAFT');
  assert.equal(home.publishedRevisionId, null);
  assert.equal(home.draftRevision.title, 'First homepage draft');
  await post(context.request, '/api/tournaments', {
    type: 'lifecycle',
    id: first.id,
    baseVersion: first.version,
    published: true,
    archived: false,
  });
  for (const path of sections) await visit(first.slug, path, path || 'overview');
  await post(context.request, `/api/admin/action?tournament=${first.slug}`, {
    type: 'page.publish',
    slug: 'home',
    revisionId: home.draftRevisionId,
  });
  await visit(first.slug, 'settings', 'settings');
  await page.getByLabel('Tournament name', { exact: true }).fill('Fresh First Cup Updated');
  await page.getByRole('button', { name: 'Save settings', exact: true }).first().click();
  await expect(page.getByRole('status')).toContainText('Tournament settings saved');
  await visit(first.slug, 'homepage', 'homepage');
  await page.getByLabel('Page title', { exact: true }).fill('Unpublished second draft');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved');
  const after = await get(context.request, first.slug, 'homepage');
  assert.equal(after.publishedRevision.title, 'First homepage draft');
  assert.equal(after.draftRevision.title, 'Unpublished second draft');
  assert.notEqual(after.draftRevisionId, after.publishedRevisionId);

  const second = await post(context.request, '/api/tournaments', {
    type: 'create',
    name: 'Second Independent Cup',
    acronym: 'SIC',
    slug: 'fresh-second-cup',
    gameMode: 'taiko',
    format: 'SOLO',
  });
  // Simulate an existing empty CMS without a page record; GET must not write placeholders.
  await db.page.updateMany({
    where: { tournamentId: second.id, slug: 'home' },
    data: { draftRevisionId: null },
  });
  await db.page.deleteMany({ where: { tournamentId: second.id, slug: 'home' } });
  const missing = await get(context.request, 'fresh-second-cup', 'homepage');
  assert.equal(missing.id, null);
  assert.equal(await db.page.count({ where: { tournamentId: second.id, slug: 'home' } }), 0);
  await visit('fresh-second-cup', 'homepage', 'homepage');
  await expect(page.getByLabel('Page title', { exact: true })).toHaveValue(
    'Second Independent Cup',
  );
  await page.getByLabel('Page title', { exact: true }).fill('Independent homepage draft');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved');
  assert.equal(
    (await get(context.request, first.slug, 'homepage')).draftRevision.title,
    'Unpublished second draft',
  );
  assert.equal(
    (await get(context.request, 'fresh-second-cup', 'homepage')).publishedRevisionId,
    null,
  );
  assert.equal((await visitor.request.get(origin + '/t/fresh-second-cup')).status(), 404);
  await post(context.request, `/api/admin/action?tournament=${first.slug}`, {
    type: 'stage.save',
    name: 'Independent Finals',
    slug: 'finals',
    description: '',
    position: 0,
    startsAt: null,
    bannerImageId: null,
  });
  assert.equal((await get(context.request, first.slug, 'stages')).stages.length, 1);
  assert.equal((await get(context.request, 'fresh-second-cup', 'stages')).stages.length, 0);

  const adminRole = await db.role.findFirstOrThrow({
    where: { tournamentId: first.id, templateKey: 'Admin' },
  });
  const admin = await db.user.create({
    data: {
      osuId: 990200002,
      username: 'Scoped administrator',
      avatarUrl: 'https://a.ppy.sh/1',
      profileUrl: '',
      roles: { create: { roleId: adminRole.id, tournamentId: first.id } },
    },
  });
  const guest = await loginUser({
    id: 990200003,
    username: 'Unprivileged visitor',
    avatar_url: 'https://a.ppy.sh/1',
  });
  for (const [user, allowed] of [
    [admin, true],
    [guest, false],
  ] as const) {
    const c = await browser.newContext();
    const session = await createSession(user.id);
    await c.addCookies([
      {
        name: 'tournament_session',
        value: session.raw,
        url: origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    await get(c.request, first.slug, 'settings', allowed ? 200 : 403);
    await get(c.request, 'fresh-second-cup', 'settings', 403);
    await post(
      c.request,
      `/api/admin/action?tournament=fresh-second-cup`,
      {
        type: 'page.save',
        slug: 'home',
        title: 'Forbidden',
        html: '',
        blocks: [],
        baseRevisionId: null,
      },
      403,
    );
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    if (allowed) {
      const rules = await get(c.request, first.slug, 'rules');
      await post(c.request, `/api/admin/action?tournament=${first.slug}`, {
        type: 'page.save',
        slug: 'rules',
        title: 'Scoped admin draft',
        html: '',
        blocks: [],
        baseRevisionId: rules.draftRevisionId,
      });
      assert.equal(
        (await get(context.request, first.slug, 'rules')).draftRevision.title,
        'Scoped admin draft',
      );
      assert.notEqual(
        (await get(context.request, 'fresh-second-cup', 'rules')).draftRevision.title,
        'Scoped admin draft',
      );
      await p.goto(origin + `/t/${first.slug}/admin/homepage`);
      await expect(p.getByRole('heading', { name: 'Homepage editor', exact: true })).toBeVisible();
      await p.goto(origin + '/t/fresh-second-cup/admin/homepage');
      await expect(p).toHaveURL(origin + '/admin/tournaments');
    }
    await c.close();
  }
  const old = await context.request.get(origin + `/admin/t/${first.slug}/homepage?view=draft`, {
    maxRedirects: 0,
  });
  assert.equal(old.status(), 308);
  assert.equal(old.headers().location, `${origin}/t/${first.slug}/admin/homepage?view=draft`);
  await page.goto(origin + '/admin/homepage');
  await expect(page).toHaveURL(origin + '/admin/tournaments');
  await expect(navigation.getByRole('link')).toHaveCount(1);
  await visit(first.slug, 'homepage', 'homepage');
  await expect(page.getByLabel('Page title', { exact: true })).toHaveValue(
    'Unpublished second draft',
  );
  await page.screenshot({
    path: `test-results/workspace-${new URL(origin).port}-desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const box = await page.getByRole('complementary').boundingBox();
      return box ? Math.round(box.x + box.width) : 0;
    })
    .toBeLessThanOrEqual(0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({
    path: `test-results/workspace-${new URL(origin).port}-mobile.png`,
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: genuine empty installation; every section before/after publishing; absent CMS page; independent drafts/stages; owner, scoped admin and guest authorization; canonical/legacy routing; no browser errors.',
  );
} finally {
  await browser.close();
  await db.$disconnect();
}
