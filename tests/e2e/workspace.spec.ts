import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import sharp from 'sharp';
import { unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
const prefix = `workspace-${Date.now()}`,
  base = 985000000 + randomInt(100000),
  raw = randomBytes(32).toString('base64url'),
  refRaw = randomBytes(32).toString('base64url');
let ownerId = '',
  refId = '';
test.beforeAll(async () => {
  expect(new URL(process.env.TEST_DATABASE_URL!).pathname).toBe('/tournament_platform_test');
  for (const [offset, token, admin] of [
    [0, raw, true],
    [1, refRaw, false],
  ] as const) {
    const user = await db.user.create({
      data: {
        osuId: base + offset,
        username: `${prefix}-${offset}`,
        avatarUrl: 'https://a.ppy.sh/1',
        profileUrl: '',
        platformAdmin: admin,
        sessions: {
          create: {
            id: createHash('sha256').update(token).digest('hex'),
            expiresAt: new Date(Date.now() + 3600000),
          },
        },
      },
    });
    if (admin) ownerId = user.id;
    else refId = user.id;
  }
  await db.participant.createMany({
    data: [2, 3].map((n) => ({
      osuId: base + n,
      username: `${prefix}-player-${n}`,
      avatarUrl: 'https://a.ppy.sh/1',
    })),
  });
  await db.beatmap.createMany({
    data: [10, 11, 12].map((n) => ({
      id: base + n,
      mode: 'osu',
      metadata: {
        id: base + n,
        mode: 'osu',
        title: `Synthetic UX map ${n}`,
        artist: 'QA',
        mapper: 'QA',
        difficulty: 'Test',
        stars: 4,
        bpm: 180,
        length: 120,
        ar: 9,
        cs: 4,
        od: 8,
        hp: 6,
        cover: '',
        url: `https://osu.ppy.sh/beatmaps/${base + n}`,
      },
    })),
  });
});
test.afterAll(async () => {
  for (const t of await db.tournament.findMany({ where: { slug: { startsWith: prefix } } })) {
    const media = await db.mediaAsset.findMany({ where: { tournamentId: t.id } });
    await db.page.updateMany({
      where: { tournamentId: t.id },
      data: { draftRevisionId: null, publishedRevisionId: null },
    });
    await db.mappool.updateMany({
      where: { tournamentId: t.id },
      data: { draftRevisionId: null, publishedRevisionId: null },
    });
    await db.auditLog.deleteMany({ where: { tournamentId: t.id } });
    await db.match.deleteMany({ where: { tournamentId: t.id } });
    await db.tournamentStage.deleteMany({ where: { tournamentId: t.id } });
    await db.team.deleteMany({ where: { tournamentId: t.id } });
    await db.mediaAsset.deleteMany({ where: { tournamentId: t.id } });
    await db.role.deleteMany({ where: { tournamentId: t.id } });
    await db.tournament.delete({ where: { id: t.id } });
    for (const item of media)
      await unlink(path.resolve('.data/test-uploads', item.key)).catch(() => {});
  }
  await db.user.deleteMany({ where: { id: { in: [ownerId, refId] } } });
  await db.participant.deleteMany({ where: { osuId: { in: [base + 2, base + 3] } } });
  await db.beatmap.deleteMany({ where: { id: { in: [base + 10, base + 11, base + 12] } } });
  await db.$disconnect();
});
async function choose(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: 'Website sections' })
    .getByRole('link', { name, exact: true })
    .click();
}
async function confirm(page: Page) {
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm', exact: true }).click();
}
test('a fresh organizer configures, publishes and operates one tournament through the canonical workspace', async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await context.addCookies([
    { name: 'tournament_session', value: raw, url: 'http://localhost:3001' },
  ]);
  const created = await context.request.post('/api/tournaments', {
    headers: { Origin: 'http://localhost:3001' },
    data: { type: 'create', name: prefix, slug: prefix, acronym: 'UX', gameMode: 'osu' },
  });
  expect(created.ok()).toBe(true);
  const { id } = await created.json();
  const root = `/t/${prefix}`,
    admin = root + '/admin';
  await page.goto(admin);
  await expect(page.getByRole('radiogroup', { name: 'Tournament format' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Administration' });
  await expect(nav.getByRole('link', { name: 'Referee', exact: true })).toHaveCount(0);
  await nav.getByRole('link', { name: 'Website', exact: true }).click();
  await choose(page, 'Tournament info');
  await page.getByLabel('Description', { exact: true }).fill('Saved UX tournament description');
  await page.getByRole('button', { name: 'Save changes', exact: true }).first().click();
  await expect(page.getByText('All changes saved', { exact: false }).first()).toBeVisible();
  await choose(page, 'Appearance');
  await page.getByLabel('Primary color', { exact: true }).fill('#277a63');
  await page.getByRole('button', { name: 'Choose Main banner' }).click();
  const image = await sharp({
    create: { width: 160, height: 80, channels: 3, background: '#b56a84' },
  })
    .png()
    .toBuffer();
  await page
    .getByRole('dialog')
    .locator('input[type=file]')
    .setInputFiles({ name: 'ux-banner.png', mimeType: 'image/png', buffer: image });
  await page.getByRole('button', { name: 'Select ux-banner.png', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).first().click();
  await expect(page.getByText('All changes saved', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Preview appearance', exact: true }).click();
  expect(
    (await db.tournamentSettings.findUniqueOrThrow({ where: { tournamentId: id } })).primaryColor,
  ).toBe('#277a63');
  await expect(
    page.getByRole('dialog').getByRole('img', { name: prefix + ' banner' }),
  ).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).click();
  await choose(page, 'Navigation & text');
  await page.getByLabel('Navigation label', { exact: true }).first().fill('Start');
  const preview = page.locator('section[aria-label="Navigation preview"]');
  await expect(preview).toContainText('Start');
  await page.getByText('Mappools page', { exact: true }).click();
  await page.getByLabel('Mappools Title', { exact: true }).fill('Official maps');
  await page.getByRole('button', { name: 'Save changes', exact: true }).first().click();
  await expect(page.getByText('All changes saved', { exact: false }).first()).toBeVisible();
  await choose(page, 'Homepage');
  await page.getByLabel('Page title', { exact: true }).fill('UX homepage');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Saved draft · Unpublished changes', { exact: true })).toBeVisible();
  expect((await db.tournament.findUniqueOrThrow({ where: { id } })).published).toBe(false);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await confirm(page);
  await expect(page.getByText('Published · No unpublished changes', { exact: true })).toBeVisible();
  await choose(page, 'Rules');
  await page.getByLabel('Page title', { exact: true }).fill('UX rules');
  await page.locator('.tiptap').fill('Rules saved through the actual editor');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Saved draft · Unpublished changes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await confirm(page);
  await page
    .getByRole('navigation', { name: 'Administration' })
    .getByRole('link', { name: 'Stages & mappools', exact: true })
    .click();
  await page.getByRole('link', { name: 'New stage', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Stage name', { exact: true }).fill('Finals');
  await expect(dialog.getByLabel('URL slug')).toHaveValue('finals');
  await dialog.getByText('Advanced stage settings', { exact: true }).click();
  await dialog.getByLabel('Inherit tournament match rules').uncheck();
  await dialog.getByLabel('Players per side', { exact: true }).fill('1');
  await dialog.getByLabel('Best of', { exact: true }).fill('1');
  await dialog.getByLabel('Bans per team', { exact: true }).fill('0');
  await dialog.getByLabel('Use a tiebreaker at match point', { exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Save stage', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mappool manager', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bulk import', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Beatmap IDs or slot mappings')
    .fill(`NM3: ${base + 12}\nNM1: ${base + 10}\nNM2: ${base + 11}`);
  await dialog.getByRole('button', { name: 'Import & fetch metadata' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Draft changes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await confirm(page);
  for (const n of [2, 3]) {
    await page
      .getByRole('navigation', { name: 'Administration' })
      .getByRole('link', { name: 'Teams & players', exact: true })
      .click();
    await page.getByRole('button', { name: 'New team', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Team name', { exact: true }).fill(`UX Team ${n}`);
    await dialog.getByLabel('osu! ID or username').fill(String(base + n));
    await dialog.getByRole('button', { name: 'Look up', exact: true }).click();
    await dialog.getByRole('button', { name: 'Add player', exact: true }).click();
    await dialog.getByRole('button', { name: 'Save team', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const row = page.getByRole('row').filter({ hasText: `UX Team ${n}` });
    await row.getByRole('button', { name: `Publication UX Team ${n}` }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Registration status').selectOption('APPROVED');
    await dialog.getByRole('button', { name: 'Save visibility' }).click();
    await expect(dialog).toHaveCount(0);
  }
  await page
    .getByRole('navigation', { name: 'Administration' })
    .getByRole('link', { name: 'Staff', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Staff sections' })
    .getByRole('link', { name: 'Website access', exact: true })
    .click();
  await page.getByLabel('Search users').fill(prefix + '-1');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page
    .getByRole('row')
    .filter({ hasText: prefix + '-1' })
    .getByRole('button', { name: 'Manage', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Referee/).check();
  await dialog.getByRole('button', { name: 'Save roles', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Administration' })
    .getByRole('link', { name: 'Matches', exact: true })
    .click();
  await page.getByRole('button', { name: 'New match', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Match code')).toHaveValue('1');
  await dialog.getByLabel('Team A / red').selectOption({ label: 'UX Team 2' });
  await dialog.getByLabel('Team B / blue').selectOption({ label: 'UX Team 3' });
  await dialog.getByLabel(new RegExp(prefix + '-1')).check();
  await dialog.getByRole('button', { name: 'Save match' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Import mp results for match 1', exact: true }).click();
  const source = page.getByRole('region', { name: 'Result editor for match 1', exact: true });
  await source
    .getByLabel('osu! multiplayer link', { exact: true })
    .fill('https://osu.ppy.sh/community/matches/123456');
  await source.getByRole('button', { name: 'Save multiplayer link', exact: true }).click();
  await expect(source).toHaveCount(0);
  const match = await db.match.findFirstOrThrow({ where: { tournamentId: id, code: '1' } });
  expect(match.rules).toMatchObject({ bestOf: 1, teamSize: 1, bansPerTeam: 0 });
  expect(match.lobbyUrl).toContain('/123456');
  expect(match.poolRevisionId).not.toBeNull();
  await page.getByRole('button', { name: 'New match', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Match code')).toHaveValue('2');
  await dialog.getByLabel('Team A / red').selectOption({ label: 'UX Team 2' });
  await dialog.getByLabel('Team B / blue').selectOption({ label: 'UX Team 3' });
  await dialog
    .getByLabel('Scheduled time (your timezone)')
    .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  await dialog.getByRole('button', { name: 'Save match' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Select match 1' }).check();
  await page.getByRole('checkbox', { name: 'Select match 2' }).check();
  await page.getByRole('button', { name: 'Bulk schedule / assign', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: new RegExp(prefix + '-1') }).check();
  await dialog.getByRole('button', { name: 'Apply to 2 matches', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const bulkMatches = await db.match.findMany({
    where: { tournamentId: id, code: { in: ['1', '2'] } },
    select: { id: true, version: true, matchNumber: true },
  });
  expect(bulkMatches.map((item) => item.matchNumber).sort((a, b) => a - b)).toEqual([1, 2]);
  expect(
    await db.matchAssignment.count({
      where: { matchId: { in: bulkMatches.map((item) => item.id) }, userId: refId },
    }),
  ).toBe(2);
  expect(bulkMatches.every((item) => item.version > 1)).toBe(true);
  await page
    .getByRole('navigation', { name: 'Administration' })
    .getByRole('link', { name: 'Tournament', exact: true })
    .click();
  await page.getByRole('heading', { name: 'Publication', level: 2 }).click();
  await page.getByRole('button', { name: 'Publish tournament', exact: true }).click();
  await confirm(page);
  await expect(page.getByText('Published. Everything here stays editable.')).toBeVisible();
  const guest = await browser.newContext();
  const publicPage = await guest.newPage();
  await publicPage.goto(root);
  await expect(
    publicPage
      .getByRole('navigation', { name: 'Tournament navigation' })
      .getByRole('link', { name: 'Start', exact: true }),
  ).toBeVisible();
  await publicPage.goto(root + '/mappools');
  await expect(
    publicPage.getByRole('heading', { level: 1, name: 'Official maps', exact: true }),
  ).toBeVisible();
  await guest.close();
  const referee = await browser.newContext();
  await referee.addCookies([
    { name: 'tournament_session', value: refRaw, url: 'http://localhost:3001' },
  ]);
  const ref = await referee.newPage();
  await ref.goto(admin + '/referee');
  await expect(ref).toHaveURL(new RegExp('/admin/matches$'));
  await ref.getByRole('button', { name: 'My Matches', exact: true }).click();
  await ref.getByRole('link', { name: 'Open match 1', exact: true }).click();
  await expect(ref.getByText('Editing match · Assigned referee', { exact: true })).toBeVisible();
  await ref.getByRole('link', { name: 'Back to matches', exact: true }).click();
  await expect(ref).toHaveURL(new RegExp('/admin/matches$'));
  await referee.close();
  expect(errors).toEqual([]);
});

test('Website subsection links protect unsaved edits and mobile navigation stays within the viewport', async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: 'tournament_session', value: raw, url: 'http://localhost:3001' },
  ]);
  const slug = prefix + '-unsaved';
  expect(
    (
      await context.request.post('/api/tournaments', {
        headers: { Origin: 'http://localhost:3001' },
        data: { type: 'create', name: 'Unsaved QA', slug, acronym: 'UX', gameMode: 'osu' },
      })
    ).ok(),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/t/${slug}/admin/website?view=info`);
  await page.getByLabel('Description', { exact: true }).fill('Unsaved change');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page
    .getByRole('navigation', { name: 'Website sections' })
    .getByRole('link', { name: 'Rules', exact: true })
    .click();
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Unsaved change');
  expect(new URL(page.url()).searchParams.get('view')).toBe('info');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('');
  await page
    .getByRole('navigation', { name: 'Website sections' })
    .getByRole('link', { name: 'Rules', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Rules editor' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/workspace-mobile.png', fullPage: true });
});

test('edits identities inline, batches registrations and CMS sections, and keeps contextual editors responsive', async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(15000);
  const evidence = '.data/zsum-comparison-20261102/browser';
  await mkdir(evidence, { recursive: true });
  await context.addCookies([
    { name: 'tournament_session', value: raw, url: 'http://localhost:3001' },
    { name: 'portal_language', value: 'en', url: 'http://localhost:3001' },
  ]);
  const slug = prefix + '-editing';
  const created = await context.request.post('/api/tournaments', {
    headers: { Origin: 'http://localhost:3001' },
    data: { type: 'create', name: 'Editing workflow QA', slug, acronym: 'EDIT', gameMode: 'osu' },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = await created.json(),
    root = `/t/${slug}/admin`;
  await page.goto(root + '/teams');
  await expect(page.getByText('No registered teams.', { exact: true })).toBeVisible();
  for (const [index, name] of ['Alpha', 'Beta'].entries())
    await db.team.create({
      data: {
        tournamentId: id,
        name,
        slug: name.toLowerCase(),
        status: 'APPROVED',
        published: true,
        members: { create: { osuId: base + 2 + index, captain: true, position: 0 } },
      },
    });
  await page.reload();
  const alpha = page
    .getByRole('row')
    .filter({ has: page.getByLabel('Select Alpha', { exact: true }) });
  await alpha.getByRole('button', { name: 'Edit name and seed for Alpha' }).click();
  await alpha.getByLabel('Team name', { exact: true }).fill('Alpha revised');
  await alpha.getByLabel('Seed', { exact: true }).fill('7');
  await alpha.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Edit name and seed for Alpha revised' }),
  ).toBeVisible();
  expect(
    (await db.team.findFirstOrThrow({ where: { tournamentId: id, slug: 'alpha' } })).seed,
  ).toBe(7);
  const revised = page
    .getByRole('row')
    .filter({ has: page.getByLabel('Select Alpha revised', { exact: true }) });
  await revised.getByRole('button', { name: 'Edit name and seed for Alpha revised' }).click();
  await revised.getByLabel('Team name', { exact: true }).fill('Unsaved inline identity');
  page.once('dialog', (d) => d.dismiss());
  await page.getByLabel('Search teams or players', { exact: true }).fill('Beta');
  await expect(page.getByLabel('Search teams or players', { exact: true })).toHaveValue('');
  await expect(revised.getByLabel('Team name', { exact: true })).toHaveValue(
    'Unsaved inline identity',
  );
  await page.getByLabel('Select this page of entrants').check();
  await page.getByLabel('Bulk team action').selectOption('HIDE');
  await page.getByRole('button', { name: 'Apply to selected', exact: true }).click();
  await confirm(page);
  await expect(page.getByText('Entrants updated.', { exact: true })).toBeVisible();
  expect(await db.team.count({ where: { tournamentId: id, published: false } })).toBe(2);
  await expect(revised.getByLabel('Team name', { exact: true })).toHaveValue(
    'Unsaved inline identity',
  );
  await revised.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByText('This team changed in another session. Reload before saving.', { exact: true }),
  ).toBeVisible();
  await expect(revised.getByLabel('Team name', { exact: true })).toHaveValue(
    'Unsaved inline identity',
  );
  await revised.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'New team', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'New team', exact: true });
  await panel.getByLabel('Team name', { exact: true }).fill('Unsaved contextual entry');
  await expect(panel).toHaveAttribute('aria-modal', 'false');
  for (const theme of ['light', 'dark'] as const)
    for (const width of [1920, 1366, 768, 390, 320]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
      if (width > 1100)
        expect(
          await panel.evaluate((el) => el.parentElement!.getBoundingClientRect().bottom),
        ).toBeLessThanOrEqual(900);
      await page.screenshot({
        path: `${evidence}/team-panel-${theme}-${width}.png`,
        fullPage: true,
      });
    }
  page.once('dialog', (d) => d.dismiss());
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(panel.getByLabel('Team name', { exact: true })).toHaveValue(
    'Unsaved contextual entry',
  );
  page.once('dialog', (d) => d.accept());
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.goto(root + '/website?view=homepage');
  await page.getByRole('button', { name: 'Add section', exact: true }).click();
  await page.getByRole('button', { name: 'Add section', exact: true }).click();
  await page.getByLabel('Select sections', { exact: true }).check();
  await page.getByRole('button', { name: 'Hide', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(
    page.getByText('Draft saved. The public version is unchanged.', { exact: true }),
  ).toBeVisible();
  const cms = await db.page.findFirstOrThrow({
    where: { tournamentId: id, slug: 'home' },
    include: { draftRevision: { include: { blocks: true } } },
  });
  expect(cms.draftRevision!.blocks).toHaveLength(2);
  expect(cms.draftRevision!.blocks.every((b) => !b.visible)).toBe(true);
  await page.getByLabel('Select sections', { exact: true }).check();
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Published', { exact: true })).toHaveCount(0);
  await expect
    .poll(async () =>
      db.contentBlock.count({
        where: {
          revision: { pageId: cms.id },
          revisionId: (await db.page.findUniqueOrThrow({ where: { id: cms.id } })).draftRevisionId!,
        },
      }),
    )
    .toBe(4);
  await page.goto(root + '/staff?view=access');
  await page.getByLabel('Search users', { exact: true }).fill(prefix + '-1');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByLabel(`Select ${prefix}-1`, { exact: true }).check();
  const refereeRole = await db.role.findFirstOrThrow({
    where: { tournamentId: id, templateKey: 'Referee' },
  });
  await page.getByLabel('Role', { exact: true }).selectOption(refereeRole.id);
  await page.getByRole('button', { name: 'Apply to selected', exact: true }).click();
  await confirm(page);
  await expect(page.getByText('User roles updated.', { exact: true })).toBeVisible();
  expect(
    await db.userRole.count({ where: { tournamentId: id, userId: refId, roleId: refereeRole.id } }),
  ).toBe(1);
  await page.goto(root + '/staff?view=roles');
  await page.getByRole('button', { name: 'Create role', exact: true }).click();
  const rolePanel = page.getByRole('dialog', { name: 'Create role', exact: true });
  await rolePanel.getByLabel('Role name', { exact: true }).fill('Copied referee access');
  await expect(rolePanel.getByRole('checkbox', { name: /^platform\.manage / })).toHaveCount(0);
  await rolePanel.getByLabel('Copy permissions from', { exact: true }).selectOption(refereeRole.id);
  await rolePanel.getByRole('button', { name: 'Save role', exact: true }).click();
  await expect(rolePanel).toHaveCount(0);
  const roleRow = page.getByRole('row').filter({ hasText: 'Copied referee access' });
  await roleRow.getByRole('button', { name: 'Edit role', exact: true }).click();
  const editing = page.getByRole('dialog', { name: 'Edit role', exact: true });
  await editing.getByLabel('Description', { exact: true }).fill('Stale browser description');
  await db.role.updateMany({
    where: { tournamentId: id, name: 'Copied referee access' },
    data: { description: 'A newer saved description' },
  });
  await editing.getByRole('button', { name: 'Save role', exact: true }).click();
  await expect(
    page.getByText('Role configuration changed. Reload before saving.', { exact: true }),
  ).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await editing.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editing).toHaveCount(0);
  const views = [
    'website?view=info',
    'website?view=branding',
    'website?view=navigation',
    'website?view=homepage',
    'website?view=rules',
    'website?view=media',
    'staff?view=listing',
    'staff?view=access',
    'staff?view=roles',
    'settings',
    'mappools?view=stages',
    'mappools?view=pooling',
    'matches',
    'referee/qualifiers',
    'qualifier-results',
  ];
  for (const [index, view] of views.entries()) {
    await page.goto(root + '/' + view);
    await expect(page.locator('main')).toBeVisible();
    for (const theme of ['light', 'dark'] as const)
      for (const width of [1920, 390]) {
        await page.emulateMedia({ colorScheme: theme });
        await page.setViewportSize({ width, height: 900 });
        await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
        await page.screenshot({
          path: `${evidence}/workspace-${index}-${theme}-${width}.png`,
          fullPage: true,
        });
      }
  }
});
