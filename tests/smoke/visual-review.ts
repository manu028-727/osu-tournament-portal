import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { chromium, expect } from '@playwright/test';
import { db } from '../../src/lib/db';
import { loginUser, actorForTournament, createSession } from '../../src/lib/auth';
import { tournamentAction } from '../../src/lib/tournaments-service';
import { executeAction } from '../../src/lib/admin-service';
import { actionSchema } from '../../src/lib/validation';
import { scopedDb } from '../../src/lib/scoped-db';
import { matchRulesSchema } from '../../src/lib/match-rules';
import type { BeatmapMetadata } from '../../src/lib/osu';

assert.equal(new URL(process.env.DATABASE_URL!).pathname, '/platform_visual_test');
assert.equal(process.env.ALLOW_ISOLATED_CONTAINER_TESTS, 'yes');
const origin = process.env.APP_URL!;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const slug = 'visual-review';
async function seed() {
  const existing = await db.tournament.findUnique({ where: { slug } });
  if (existing && (await db.tournamentStage.count({ where: { tournamentId: existing.id } })))
    return;
  assert.equal(await db.tournament.count(), existing ? 1 : 0);
  const user = await loginUser({
    id: 990200011,
    username: 'Synthetic QA organizer',
    avatar_url: '',
  });
  const profile = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    include: { roles: { include: { role: { include: { permissions: true } } } } },
  });
  assert.equal(profile.platformAdmin, true);
  const id =
    existing?.id ||
    (
      await tournamentAction(actorForTournament(profile, 'none'), {
        type: 'create',
        name: 'Visual Test Tournament',
        acronym: 'TEST',
        slug,
        gameMode: 'osu',
        format: 'TEAMS',
        description: 'Synthetic data for visual and accessibility checks.',
        timezone: 'Europe/Rome',
      })
    ).id;
  const actor = actorForTournament(profile, id),
    scoped = scopedDb(db, id);
  const act = (input: unknown) => executeAction(actor, actionSchema.parse(input));
  const rules = matchRulesSchema.parse({
    bestOf: 3,
    teamSize: 1,
    protectsPerTeam: 0,
    bansPerTeam: 0,
    rollRequired: false,
    firstPickRule: 'RED',
    firstBanRule: 'RED',
    firstProtectRule: 'RED',
    freeModRequiredHD: 0,
    freeModRequiredHR: 0,
  });
  const key = randomUUID() + '.webp';
  const pixels = Buffer.alloc(960 * 320 * 3);
  for (let y = 0; y < 320; y++)
    for (let x = 0; x < 960; x++) {
      const i = (y * 960 + x) * 3,
        band = Math.floor(x / 160) % 3;
      pixels[i] = [104, 44, 72][band];
      pixels[i + 1] = [65, 88, 86][band];
      pixels[i + 2] = [79, 103, 67][band];
    }
  const image = await sharp(pixels, { raw: { width: 960, height: 320, channels: 3 } })
    .webp()
    .toBuffer();
  await mkdir(process.env.STORAGE_LOCAL_DIR!, { recursive: true });
  await writeFile(path.join(process.env.STORAGE_LOCAL_DIR!, key), image);
  const asset = await scoped.mediaAsset.create({
    data: {
      key,
      name: 'Synthetic QA color chart.webp',
      mimeType: 'image/webp',
      size: image.length,
      width: 960,
      height: 320,
      isPublic: true,
    },
  });
  const cover = `/api/media/${asset.id}`;
  await db.user.update({ where: { id: user.id }, data: { avatarUrl: cover } });
  await scoped.tournamentSettings.update({
    where: { tournamentId: id },
    data: {
      banner: cover,
      importantDates: [
        { label: 'Qualifiers', date: '2026-10-24' },
        { label: 'Finals', date: '2026-11-07' },
      ],
      footer: 'Synthetic QA content. Not a real tournament.',
    },
  });
  for (const pageSlug of ['home', 'rules'] as const) {
    const page = await scoped.page.findFirstOrThrow({ where: { slug: pageSlug } });
    const html = Array.from(
      { length: 9 },
      (_, i) =>
        `<h2>Section ${i + 1}: tournament procedures</h2><p>Synthetic rules content for typography and navigation testing. This is not a real tournament rule. Long documents must remain readable on narrow screens.</p><ul><li>First list item</li><li>Second list item with <strong>important information</strong></li></ul>`,
    ).join('');
    await act({
      type: 'page.save',
      slug: pageSlug,
      title: pageSlug === 'home' ? 'Visual Test Tournament' : 'Tournament rules',
      html: pageSlug === 'rules' ? html : '',
      baseRevisionId: page.draftRevisionId,
      blocks:
        pageSlug === 'home'
          ? [
              {
                type: 'hero',
                visible: true,
                content: {
                  title: 'Visual Test Tournament',
                  text: 'Synthetic data for visual and accessibility checks.',
                  image: cover,
                  buttons: [
                    { label: 'Mappools', href: '/mappools' },
                    { label: 'Schedule', href: '/matches' },
                  ],
                },
              },
              { type: 'timeline', visible: true, content: { title: 'Tournament dates' } },
              {
                type: 'text',
                visible: true,
                content: {
                  title: 'Announcements',
                  text: 'Synthetic announcement for layout review.',
                },
              },
            ]
          : [],
    });
    const saved = await scoped.page.findFirstOrThrow({ where: { slug: pageSlug } });
    await act({ type: 'page.publish', slug: pageSlug, revisionId: saved.draftRevisionId });
  }
  const stage = await scoped.tournamentStage.create({
    data: {
      name: 'Quarterfinals',
      slug: 'quarterfinals',
      matchRules: rules,
      mappool: { create: {} },
    },
    include: { mappool: true },
  });
  const slots = [];
  for (const [category, count, color] of [
    ['NM', 5, '#90bdf4'],
    ['HD', 2, '#e5c76c'],
    ['HR', 2, '#e78b9d'],
    ['DT', 3, '#b69ae6'],
    ['FM', 2, '#86d0b8'],
    ['TB', 1, '#e8a2ca'],
  ] as const)
    for (let n = 1; n <= count; n++) {
      const beatmapId: number = 1000000000 + slots.length;
      const metadata: BeatmapMetadata = {
        id: beatmapId,
        mode: 'osu',
        artist: 'Synthetic artist',
        title:
          n === 1
            ? 'A deliberately long synthetic song title used to check truncation and full-detail access'
            : `Synthetic beatmap ${slots.length + 1}`,
        difficulty: 'Synthetic expert difficulty with a long readable name',
        mapper: 'Synthetic mapper',
        stars: 5.42,
        bpm: 180,
        length: 148,
        ar: 9,
        cs: 4,
        od: 8,
        hp: 6,
        cover,
        url: `https://osu.ppy.sh/beatmaps/${beatmapId}`,
      };
      await db.beatmap.create({ data: { id: beatmapId, mode: 'osu', metadata } });
      slots.push({
        name: category === 'TB' ? 'TB' : category + n,
        category,
        categoryName: category,
        color,
        position: slots.length,
        beatmapId,
        metadata,
      });
    }
  const revision = await scoped.mappoolRevision.create({
    data: {
      mappoolId: stage.mappool!.id,
      notes: 'Synthetic mappool fixture.',
      slots: { create: slots },
    },
  });
  await scoped.mappool.update({
    where: { id: stage.mappool!.id },
    data: { state: 'PUBLISHED', draftRevisionId: revision.id, publishedRevisionId: revision.id },
  });
  const teams = [];
  for (let i = 0; i < 8; i++) {
    const osuId = 990201000 + i;
    await db.participant.create({
      data: { osuId, username: `Synthetic player ${i + 1}`, avatarUrl: cover },
    });
    teams.push(
      await scoped.team.create({
        data: {
          name:
            i === 0
              ? 'Synthetic team with a deliberately very long name'
              : `Synthetic team ${i + 1}`,
          slug: `team-${i + 1}`,
          seed: i + 1,
          status: 'APPROVED',
          published: true,
          members: { create: { osuId, captain: true, position: 0 } },
        },
      }),
    );
  }
  const group = await scoped.staffCategory.create({ data: { name: 'Tournament staff' } });
  for (let i = 0; i < 8; i++)
    await scoped.staffMember.create({
      data: {
        osuId: 990202000 + i,
        username: `Synthetic staff ${i + 1}`,
        avatarUrl: cover,
        profileUrl: `https://osu.ppy.sh/users/${990202000 + i}`,
        position: i,
        assignments: { create: { categoryId: group.id, position: i < 2 ? 'Host' : 'Referee' } },
      },
    });
  for (let i = 0; i < 6; i++)
    await act({
      type: 'match.create',
      code: `V0${i + 1}`,
      stageId: stage.id,
      teamAId: teams[i].id,
      teamBId: teams[(i + 1) % teams.length].id,
      refereeIds: [user.id],
      scheduledAt: `2026-10-${24 + i}T16:00:00.000Z`,
      published: true,
    });
  const match = await scoped.match.findFirstOrThrow({ where: { code: 'V01' } });
  await act({ type: 'match.start', id: match.id, baseVersion: match.version });
  const started = await scoped.match.findUniqueOrThrow({ where: { id: match.id } });
  await act({
    type: 'match.draft',
    id: match.id,
    baseVersion: started.version,
    kind: 'PICK',
    side: 'A',
    slotName: 'NM1',
  });
  const picked = await scoped.match.findUniqueOrThrow({
    where: { id: match.id },
    include: { actions: true },
  });
  await act({
    type: 'match.score',
    id: match.id,
    baseVersion: picked.version,
    actionId: picked.actions[0].id,
    scoreA: 900000,
    scoreB: 870000,
    players: [],
    notes: '',
    reason: 'Synthetic visual test result',
  });
  await tournamentAction(actor, {
    type: 'lifecycle',
    id,
    baseVersion: 1,
    published: true,
    archived: false,
  });
  console.log(
    'Created explicitly synthetic visual-review fixtures in the dedicated test database.',
  );
}
try {
  if (process.argv.includes('--seed')) await seed();
  else {
    const phase = process.argv.includes('--before') ? 'before' : 'after';
    const user = await db.user.findUniqueOrThrow({ where: { osuId: 990200011 } });
    const session = await createSession(user.id);
    const match = await db.match.findFirstOrThrow({ where: { code: 'V01' } });
    const root = `/t/${slug}`,
      admin = `${root}/admin`;
    const routes = [
      ['directory', '/tournaments'],
      ['home', root],
      ['mappool', `${root}/mappools/quarterfinals`],
      ['stage-index', `${root}/mappools`],
      ['rules', `${root}/rules`],
      ['staff', `${root}/staff`],
      ['teams', `${root}/teams`],
      ['team', `${root}/teams/team-1`],
      ['schedule', `${root}/matches`],
      ['result', `${root}/matches/V01`],
      ['chooser', '/admin/tournaments'],
      ...[
        '',
        'homepage',
        'rules',
        'mappools',
        'staff',
        'media',
        'teams',
        'stages',
        'matches',
        'referee',
        'settings',
        'users',
        'roles',
        'audit',
        'sheet-data',
      ].map((s) => [`admin-${s || 'tournament'}`, admin + (s ? '/' + s : '')]),
      ['referee', `${admin}/referee/${match.id}`],
      ['qualifiers', `${admin}/referee/qualifiers`],
    ];
    const browser = await chromium.launch();
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
    const report: { name: string; width: number; status?: number; overflow: boolean }[] = [];
    const output = `.data/visual/${phase}`;
    await mkdir(output, { recursive: true });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('response', (r) => {
        if (r.url().includes('/api/admin/') && r.status() >= 400)
          errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
      });
      const selectedRoutes = process.argv.includes('--interactions-only')
        ? []
        : process.argv.includes('--extras-only')
          ? routes.filter(([name]) =>
              ['stage-index', 'admin-referee', 'admin-sheet-data', 'admin-matches'].includes(name),
            )
          : routes;
      for (const [name, route] of selectedRoutes)
        for (const width of process.argv.includes('--matrix')
          ? [320, 375, 390, 768, 1024, 1366, 1920]
          : [1366, 390]) {
          await page.setViewportSize({ width, height: width > 1024 ? 900 : 844 });
          const response = await page.goto(origin + route, { waitUntil: 'networkidle' });
          await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true });
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          );
          report.push({ name, width, status: response?.status(), overflow });
          console.log(`${phase} ${name} ${width}: ${response?.status()} overflow=${overflow}`);
        }
      if (report.length)
        await writeFile(
          `${output}/${process.argv.includes('--extras-only') ? 'extras-report' : 'report'}.json`,
          JSON.stringify({ routes: report, errors }, null, 2),
        );
      assert.deepEqual(errors, []);
      if (phase === 'after') {
        assert.deepEqual(
          report.filter((r) => r.status !== 200 || r.overflow),
          [],
        );
        await page.setViewportSize({ width: 375, height: 844 });
        await page.goto(origin + root + '/mappools/quarterfinals', { waitUntil: 'networkidle' });
        const toggle = page.locator('button[aria-controls="public-mobile-navigation"]');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await page.keyboard.press('Escape');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(toggle).toBeFocused();
        const profileMenu = page.getByRole('button', {
          name: 'Synthetic QA organizer profile menu',
          exact: true,
        });
        await profileMenu.click();
        await page.keyboard.press('Escape');
        await expect(profileMenu).toBeFocused();
        await page.getByRole('button', { name: 'Dettagli NM1', exact: true }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.screenshot({ path: `${output}/mobile-map-details.png` });
        await page.getByRole('button', { name: 'Chiudi', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Dettagli NM1', exact: true })).toBeFocused();
        await page.goto(origin + admin + '/matches', { waitUntil: 'networkidle' });
        await expect(page.getByLabel('Assigned referee', { exact: true })).toBeHidden();
        await page.getByRole('button', { name: 'Filters', exact: true }).click();
        await expect(page.getByLabel('Assigned referee', { exact: true })).toHaveValue('');
        await page.getByRole('button', { name: 'Hide filters', exact: true }).click();
        const openMatch = page.getByRole('link', { name: 'Open match V01', exact: true });
        const openBox = await openMatch.boundingBox();
        assert.ok(openBox && openBox.x >= 0 && openBox.x + openBox.width <= 375);
        await page.getByRole('button', { name: 'New match', exact: true }).click();
        await page.screenshot({ path: `${output}/mobile-match-dialog.png` });
        const modal = await page.getByRole('dialog').boundingBox();
        assert.ok(modal && modal.x >= 0 && modal.x + modal.width <= 375 && modal.height <= 844);
        await page.keyboard.press('Escape');
        const sidebarToggle = page.getByRole('button', { name: 'Open sidebar', exact: true });
        await sidebarToggle.click();
        await expect(
          page.getByRole('button', { name: 'Close sidebar', exact: true }).first(),
        ).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(sidebarToggle).toBeFocused();
        await page.goto(origin + admin + '/settings', { waitUntil: 'networkidle' });
        const description = await page.getByLabel('Description', { exact: true }).inputValue();
        await page
          .getByLabel('Description', { exact: true })
          .fill(description + ' Tab retention check.');
        await page.getByRole('tab', { name: 'Branding', exact: true }).click();
        await expect(page.getByLabel('Main banner', { exact: true })).toBeVisible();
        await page.screenshot({ path: `${output}/mobile-branding-settings.png`, fullPage: true });
        await page.getByRole('tab', { name: 'Identity', exact: true }).click();
        await expect(page.getByLabel('Description', { exact: true })).toHaveValue(
          description + ' Tab retention check.',
        );
        await page.getByLabel('Description', { exact: true }).fill(description);
        await page.getByRole('button', { name: 'Save settings', exact: true }).first().click();
        await expect(
          page.getByRole('button', { name: 'Save settings', exact: true }).first(),
        ).toBeDisabled();
        await page.goto(origin + admin + '/homepage', { waitUntil: 'networkidle' });
        await page.getByRole('button', { name: 'Preview draft', exact: true }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.screenshot({ path: `${output}/mobile-cms-preview.png` });
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width: 1366, height: 900 });
        await page.goto(origin + root + '/mappools/quarterfinals', { waitUntil: 'networkidle' });
        await expect(
          page
            .getByRole('navigation', { name: 'Main navigation' })
            .locator('a[aria-current="page"]'),
        ).toHaveText('Mappools');
        await page
          .getByRole('group', { name: 'Mappool', exact: true })
          .locator('li')
          .first()
          .getByRole('link')
          .hover();
        await expect(page.getByRole('tooltip', { name: 'Anteprima NM1' })).toBeVisible();
        await page.screenshot({ path: `${output}/desktop-map-preview.png` });
        await page.goto(origin + admin + '/mappools', { waitUntil: 'networkidle' });
        await page.screenshot({ path: `${output}/desktop-pool-editor.png`, fullPage: true });
        await page.goto(origin + admin + '/referee/' + match.id, { waitUntil: 'networkidle' });
        await page.locator('summary').filter({ hasText: 'Bancho IRC' }).click();
        await page.screenshot({ path: `${output}/desktop-irc-security.png`, fullPage: true });
        for (const [width, height] of [
          [844, 390],
          [960, 720],
        ]) {
          await page.setViewportSize({ width, height });
          await page.goto(origin + admin + '/referee/' + match.id, { waitUntil: 'networkidle' });
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
          );
          await page.screenshot({ path: `${output}/referee-landscape-${width}.png` });
        }
        const failures = await context.newPage();
        await failures.setViewportSize({ width: 390, height: 844 });
        let release!: () => void;
        const delayed = new Promise<void>((resolve) => {
          release = resolve;
        });
        await failures.route('**/api/admin/data?*', async (route) => {
          await delayed;
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Synthetic connection failure for visual testing.' }),
          });
        });
        await failures.goto(origin + admin + '/teams', { waitUntil: 'domcontentloaded' });
        await expect(failures.getByRole('status', { name: 'Loading', exact: true })).toBeVisible();
        await failures.screenshot({ path: `${output}/mobile-loading.png` });
        release();
        await expect(failures.locator('main').getByRole('alert')).toContainText(
          'Synthetic connection failure',
        );
        await failures.screenshot({ path: `${output}/mobile-error.png` });
        await failures.unroute('**/api/admin/data?*');
        await failures.getByRole('button', { name: 'Try again', exact: true }).click();
        await expect(
          failures.getByRole('heading', { name: 'Teams & players', exact: true }),
        ).toBeVisible();
        await failures.close();
        // Half-width layout with 2x pixels exercises 200%-equivalent browser reflow.
        const scaled = await browser.newContext({
          viewport: { width: 683, height: 450 },
          deviceScaleFactor: 2,
          reducedMotion: 'reduce',
        });
        await scaled.addCookies([
          {
            name: 'tournament_session',
            value: session.raw,
            url: origin,
            httpOnly: true,
            sameSite: 'Lax',
          },
        ]);
        const zoomed = await scaled.newPage();
        for (const [name, route] of [
          ['mappool', root + '/mappools/quarterfinals'],
          ['settings', admin + '/settings'],
          ['referee', admin + '/referee/' + match.id],
        ]) {
          await zoomed.goto(origin + route, { waitUntil: 'networkidle' });
          assert.equal(
            await zoomed.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
          );
          await zoomed.screenshot({ path: `${output}/${name}-200-percent-reflow.png` });
        }
        await scaled.close();
        assert.deepEqual(errors, []);
        console.log(
          'Navigation, modal bounds/focus, CMS preview, map details/hover, IRC notice and landscape checks passed.',
        );
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await db.$disconnect();
}
