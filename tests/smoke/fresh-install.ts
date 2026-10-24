import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { chromium, expect, type APIRequestContext } from '@playwright/test';
import { db } from '../../src/lib/db';
import { loginUser, createSession } from '../../src/lib/auth';
import { matchRulesSchema } from '../../src/lib/match-rules';
if (
  process.env.ALLOW_ISOLATED_CONTAINER_TESTS !== 'yes' ||
  new URL(process.env.DATABASE_URL!).pathname !== '/platform_onboarding_test'
)
  throw new Error('Only the explicitly isolated empty onboarding-test database is accepted.');
const origin = process.env.APP_URL!;
const rules = matchRulesSchema.parse({
  gameMode: 'mania',
  bestOf: 1,
  teamSize: 1,
  teamMode: 'HEAD_TO_HEAD',
  bansPerTeam: 0,
  protectsPerTeam: 0,
  rollRequired: false,
  firstBanRule: 'RED',
  firstPickRule: 'RED',
  firstProtectRule: 'RED',
});
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
  throw new Error('Use an isolated loopback web container.');
assert.equal(await db.tournament.count(), 0);
assert.equal(await db.user.count(), 0);
await mkdir('.data/qa', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext(),
    guest = await browser.newContext(),
    page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin);
  await expect(page.getByText('No tournaments published yet.', { exact: true })).toBeVisible();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: `.data/qa/fresh-empty-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + '/setup');
  await expect(page.getByRole('heading', { name: 'Setup', exact: true })).toBeVisible();
  // A test-only fixture substitutes the external OAuth provider, not a web login bypass.
  const owner = await loginUser({
    id: 990200001,
    username: 'Synthetic Owner',
    avatar_url: '/test-image.webp',
  });
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).platformAdmin, true);
  const initialized = await db.platformSettings.findUniqueOrThrow({ where: { id: 'main' } });
  assert.ok(initialized.ownerBootstrappedAt);
  assert.equal(initialized.bootstrapOwnerOsuId, null);
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
  async function post(api: APIRequestContext, url: string, data: unknown) {
    const r = await api.post(origin + url, { headers: { Origin: origin }, data });
    const result = await r.json();
    assert.equal(r.ok(), true, JSON.stringify(result));
    return result;
  }
  await page.goto(origin + '/admin/tournaments');
  await page.getByLabel('Platform name', { exact: true }).fill('Synthetic Community');
  await page.getByLabel('Default timezone', { exact: true }).fill('Pacific/Auckland');
  const image = await sharp({
    create: { width: 240, height: 80, channels: 3, background: '#3c8279' },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel('Upload logo', { exact: true })
    .setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByLabel('Site logo', { exact: true })).toHaveValue(
    /\/api\/platform\/media\//,
  );
  const logo = await page.getByLabel('Site logo', { exact: true }).inputValue();
  assert.equal((await guest.request.get(origin + logo)).status(), 404);
  await page.getByRole('button', { name: 'Save platform settings', exact: true }).click();
  await expect
    .poll(async () => (await db.platformSettings.findUniqueOrThrow({ where: { id: 'main' } })).name)
    .toBe('Synthetic Community');
  assert.equal((await guest.request.get(origin + logo)).status(), 200);
  await page.getByRole('button', { name: 'Create tournament', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Synthetic First Cup');
  await dialog.getByLabel('Acronym', { exact: true }).fill('SFC');
  await dialog.getByLabel('URL slug', { exact: true }).fill('first-test-cup');
  await dialog.getByLabel('Game mode', { exact: true }).selectOption('mania');
  await dialog.getByLabel('Format', { exact: true }).selectOption('SOLO');
  await dialog.getByRole('button', { name: 'Create tournament', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Synthetic First Cup', exact: true }),
  ).toBeVisible();
  const t = await db.tournament.findUniqueOrThrow({
    where: { slug: 'first-test-cup' },
    include: { settings: true },
  });
  assert.equal(t.timezone, 'Pacific/Auckland');
  const endpoint = `/api/admin/action?tournament=${t.slug}`;
  const upload = await context.request.post(origin + `/api/media?tournament=${t.slug}`, {
    headers: { Origin: origin },
    multipart: { file: { name: 'banner.png', mimeType: 'image/png', buffer: image } },
  });
  assert.ok(upload.ok());
  const asset = await upload.json();
  assert.equal((await guest.request.get(origin + asset.url)).status(), 404);
  await post(context.request, endpoint, {
    type: 'settings.save',
    baseVersion: t.version,
    name: t.name,
    acronym: t.acronym,
    description: '',
    status: 'UPCOMING',
    gameMode: 'mania',
    logo: asset.url,
    favicon: asset.url,
    banner: asset.url,
    primaryColor: '#e89caa',
    accentColor: '#80c8b0',
    registrationUrl: '',
    socialLinks: [],
    importantDates: [],
    navigation: t.settings!.navigation,
    footer: '',
  });
  for (const slug of ['home', 'rules']) {
    const p = await db.page.findUniqueOrThrow({
      where: { tournamentId_slug: { tournamentId: t.id, slug } },
    });
    const r = await post(context.request, endpoint, {
      type: 'page.save',
      slug,
      title: slug === 'home' ? t.name : 'Rules',
      html:
        slug === 'home'
          ? '<h1>Synthetic First Cup</h1>'
          : '<h2>General rules</h2><p>Synthetic test rules.</p>',
      blocks: [],
      baseRevisionId: p.draftRevisionId,
    });
    await post(context.request, endpoint, { type: 'page.publish', slug, revisionId: r.revisionId });
  }
  const stage = await post(context.request, endpoint, {
    type: 'stage.save',
    name: 'Test Stage',
    slug: 'test-stage',
    description: '',
    position: 0,
    startsAt: null,
    matchRules: rules,
    bannerImageId: asset.id,
  });
  const metadata = {
    id: 990500001,
    mode: 'mania',
    title: 'Synthetic track',
    artist: 'Synthetic artist',
    mapper: 'Synthetic mapper',
    difficulty: 'Test',
    stars: 2,
    bpm: 100,
    length: 60,
    ar: 5,
    cs: 4,
    od: 5,
    hp: 5,
    cover: '/test-image.webp',
    url: 'https://osu.ppy.sh/beatmaps/990500001',
  };
  await db.beatmap.create({ data: { id: metadata.id, mode: 'mania', metadata } });
  const pool = await db.mappool.findUniqueOrThrow({ where: { stageId: stage.id } });
  const saved = await post(context.request, endpoint, {
    type: 'pool.save',
    id: pool.id,
    baseRevisionId: null,
    notes: '',
    slots: [{ name: 'NM1', category: 'NM', beatmapId: metadata.id }],
  });
  await post(context.request, endpoint, {
    type: 'pool.publish',
    id: pool.id,
    revisionId: saved.revisionId,
  });
  const teams: string[] = [];
  for (let i = 0; i < 2; i++) {
    const osuId = 990200101 + i;
    await db.participant.create({
      data: { osuId, username: `Synthetic Player ${i + 1}`, avatarUrl: '/test-image.webp' },
    });
    const team = await post(context.request, endpoint, {
      type: 'team.save',
      name: `Synthetic Team ${i + 1}`,
      slug: `synthetic-team-${i + 1}`,
      format: 'INDIVIDUAL',
      members: [{ osuId, captain: true, substitute: false }],
    });
    teams.push(team.id);
    const current = await db.team.findUniqueOrThrow({ where: { id: team.id } });
    await post(context.request, endpoint, {
      type: 'team.status',
      id: team.id,
      baseVersion: current.version,
      status: 'APPROVED',
      published: true,
    });
  }
  const m = await post(context.request, endpoint, {
    type: 'match.create',
    code: 'FRESH-1',
    stageId: stage.id,
    teamAId: teams[0],
    teamBId: teams[1],
    refereeIds: [owner.id],
    published: true,
  });
  async function matchAction(type: string, fields: Record<string, unknown> = {}) {
    const current = await db.match.findUniqueOrThrow({ where: { id: m.id } });
    return post(context.request, endpoint, {
      type,
      id: m.id,
      baseVersion: current.version,
      ...fields,
    });
  }
  await matchAction('match.start');
  await matchAction('match.draft', { kind: 'PICK', side: 'A', slotName: 'NM1' });
  await page.goto(origin + `/t/${t.slug}/admin/referee/${m.id}`);
  await expect(page.getByRole('heading', { name: /now playing.*NM1/i })).toBeVisible();
  const action = await db.matchMapAction.findFirstOrThrow({
    where: { matchId: m.id, kind: 'PICK' },
  });
  await matchAction('match.winner', {
    actionId: action.id,
    winnerSide: 'A',
    reason: 'Synthetic complete test',
    notes: '',
  });
  if ((await db.match.findUniqueOrThrow({ where: { id: m.id } })).status === 'IN_PROGRESS')
    await matchAction('match.submit', { notes: '' });
  await matchAction('match.confirm', { reason: 'Reviewed synthetic test' });
  const current = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
  await post(context.request, '/api/tournaments', {
    type: 'lifecycle',
    id: t.id,
    baseVersion: current.version,
    published: true,
    archived: false,
  });
  assert.equal((await guest.request.get(origin + asset.url)).status(), 200);
  await page.goto(origin + `/t/${t.slug}/matches/FRESH-1`);
  await expect(page.locator('[data-history-sequence]')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('[data-history-sequence]')).toHaveCount(1);
  const second = await post(context.request, '/api/tournaments', {
    type: 'create',
    name: 'Synthetic Second Cup',
    acronym: 'SSC',
    slug: 'second-test-cup',
    gameMode: 'osu',
    description: '',
    timezone: 'UTC',
    format: 'TEAMS',
  });
  assert.notEqual(second.id, t.id);
  assert.equal((await guest.request.get(origin + '/t/second-test-cup')).status(), 404);
  const account = await db.user.create({
    data: {
      osuId: 990200002,
      username: 'Synthetic Local Editor',
      avatarUrl: '',
      profileUrl: '',
      roles: {
        create: {
          tournamentId: t.id,
          roleId: (
            await db.role.findFirstOrThrow({
              where: { tournamentId: t.id, templateKey: 'Content Editor' },
            })
          ).id,
        },
      },
    },
  });
  const local = await browser.newContext(),
    localSession = await createSession(account.id);
  await local.addCookies([{ name: 'tournament_session', value: localSession.raw, url: origin }]);
  assert.equal(
    (
      await local.request.get(origin + '/api/admin/data?section=rules&tournament=second-test-cup')
    ).status(),
    403,
  );
  await local.close();
  const final = await db.match.findUniqueOrThrow({
    where: { id: m.id },
    include: { actions: true, results: true },
  });
  assert.equal(final.status, 'COMPLETED');
  assert.equal(final.scoreA, 1);
  assert.equal(final.actions.length, 1);
  assert.equal(final.results.length, 1);
  assert.equal(
    (
      await db.platformSettings.findUniqueOrThrow({ where: { id: 'main' } })
    ).ownerBootstrappedAt?.getTime(),
    initialized.ownerBootstrappedAt?.getTime(),
  );
  await page.screenshot({ path: '.data/qa/fresh-completed-match.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'Fresh browser/HTTP workflow passed: empty install, pinned owner, platform/tournament uploads, CMS, mania pool, teams, completed match, reload history and two-tournament isolation. External OAuth/metadata were synthetic test fixtures.',
  );
} finally {
  await browser.close();
  await db.$disconnect();
}
