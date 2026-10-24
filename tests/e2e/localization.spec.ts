import { test, expect, type Page } from '@playwright/test';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertTestDatabase } from '../../src/lib/instance';
import { matchRulesSchema } from '../../src/lib/match-rules';
import type { Locale } from '../../src/lib/i18n';

assertTestDatabase(process.env.TEST_DATABASE_URL);
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
const id = randomUUID(),
  emptyId = randomUUID(),
  userId = randomUUID();
const slug = `languages-${id}`,
  root = `/t/${slug}`,
  admin = `${root}/admin`;
const raw = randomBytes(32).toString('base64url'),
  beatmapId = randomInt(1_800_000_000, 1_900_000_000);
let stageId = '',
  matchId = '',
  candidateId = '';
const authored = 'Save Next Captain - contenuto scritto da chi organizza';
const metadata = {
  id: beatmapId,
  mode: 'osu',
  title: 'Save',
  artist: 'Next',
  mapper: 'Captain',
  difficulty: 'English difficulty',
  stars: 5.82,
  bpm: 180,
  length: 125,
  ar: 9,
  cs: 4,
  od: 8,
  hp: 6,
  cover: '/test-image.webp',
  url: `https://osu.ppy.sh/beatmaps/${beatmapId}`,
};
test.beforeAll(async () => {
  await db.user.create({
    data: {
      id: userId,
      osuId: randomInt(1_900_000_000, 2_000_000_000),
      username: 'Captain',
      avatarUrl: '/test-image.webp',
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
  for (const [tournamentId, tournamentSlug, published] of [
    [id, slug, true],
    [emptyId, `${slug}-empty`, false],
  ] as const)
    await db.tournament.create({
      data: {
        id: tournamentId,
        slug: tournamentSlug,
        name: tournamentId === id ? authored : 'Empty synthetic tournament',
        acronym: 'LANG',
        description: authored,
        status: 'UPCOMING',
        published,
        settings: {
          create: {
            gameplayScoring: 'SCORE_V2',
            banner: '',
            registrationUrl: '',
            navigation: [
              { label: 'Next', href: '/' },
              { label: 'Save', href: '/rules' },
            ],
            socialLinks: [],
            importantDates: [{ label: 'Save', date: '2026-10-24T12:30:00Z' }],
            footer: authored,
            copy: { mappoolsTitle: 'Save' },
          },
        },
      },
    });
  for (const pageSlug of ['home', 'rules']) {
    const page = await db.page.create({
      data: { tournamentId: id, slug: pageSlug, title: 'Save' },
    });
    const revision = await db.pageRevision.create({
      data: {
        tournamentId: id,
        pageId: page.id,
        title: 'Save',
        html: `<h2>Next</h2><p>${authored}</p>`,
      },
    });
    await db.page.update({
      where: { id: page.id },
      data: { draftRevisionId: revision.id, publishedRevisionId: revision.id, state: 'PUBLISHED' },
    });
  }
  await db.beatmap.create({ data: { id: beatmapId, mode: 'osu', metadata } });
  const stage = await db.tournamentStage.create({
    data: {
      tournamentId: id,
      name: 'Save',
      slug: 'save',
      startsAt: new Date('2026-10-24T12:30:00Z'),
    },
  });
  stageId = stage.id;
  const pool = await db.mappool.create({ data: { tournamentId: id, stageId } });
  const revision = await db.mappoolRevision.create({
    data: {
      tournamentId: id,
      mappoolId: pool.id,
      notes: authored,
      slots: {
        create: {
          name: 'NM1',
          category: 'NM',
          categoryName: 'NoMod',
          color: '#8bbdff',
          beatmapId,
          metadata,
          position: 0,
        },
      },
    },
  });
  await db.mappool.update({
    where: { id: pool.id },
    data: { draftRevisionId: revision.id, publishedRevisionId: revision.id, state: 'PUBLISHED' },
  });
  await db.modCategory.create({
    data: { tournamentId: id, name: 'NoMod', acronym: 'NM', color: '#8bbdff' },
  });
  const teams: { id: string; name: string; slug: string }[] = [];
  for (const [name, teamSlug] of [
    ['Captain', 'captain'],
    ['Next', 'next'],
  ])
    teams.push(
      await db.team.create({
        data: { tournamentId: id, name, slug: teamSlug, status: 'APPROVED', published: true },
      }),
    );
  const side = (team: (typeof teams)[number]) => ({
    id: team.id,
    name: team.name,
    slug: team.slug,
    format: 'TEAM',
    logoImageId: null,
    members: [],
  });
  const match = await db.match.create({
    data: {
      tournamentId: id,
      stageId,
      code: 'language-match',
      rules: matchRulesSchema.parse({
        bestOf: 1,
        bansPerTeam: 0,
        enableTiebreaker: false,
        gameplayScoring: 'SCORE_V2',
      }),
      participants: { A: side(teams[0]), B: side(teams[1]) },
      teamAId: teams[0].id,
      teamBId: teams[1].id,
      poolRevisionId: revision.id,
      scheduledAt: new Date('2026-10-24T12:30:00Z'),
      published: true,
    },
  });
  matchId = match.id;
  const candidate = await db.poolCandidate.create({
    data: {
      tournamentId: id,
      stageId,
      beatmapId,
      metadata,
      category: 'NM',
      status: 'ACCEPTED',
      notes: authored,
      submitterId: userId,
    },
  });
  candidateId = candidate.id;
});
test.afterAll(async () => {
  for (const tournamentId of [id, emptyId]) {
    await db.page.updateMany({
      where: { tournamentId },
      data: { draftRevisionId: null, publishedRevisionId: null },
    });
    await db.mappool.updateMany({
      where: { tournamentId },
      data: { draftRevisionId: null, publishedRevisionId: null },
    });
    await db.poolCandidate.deleteMany({ where: { tournamentId } });
    await db.match.deleteMany({ where: { tournamentId } });
    await db.team.deleteMany({ where: { tournamentId } });
    await db.tournamentStage.deleteMany({ where: { tournamentId } });
    await db.auditLog.deleteMany({ where: { tournamentId } });
    await db.tournament.deleteMany({ where: { id: tournamentId } });
  }
  await db.beatmap.deleteMany({ where: { id: beatmapId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});
test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: 'tournament_session', value: raw, url: 'http://localhost:3001' },
    { name: 'portal_language', value: 'en', url: 'http://localhost:3001' },
  ]);
});
async function language(page: Page, value: Locale) {
  await page
    .getByRole('button', { name: /^(Interface language|Lingua dell'interfaccia)$/ })
    .click();
  await page
    .getByRole('menuitemradio', { name: value === 'en' ? 'English' : 'Italiano', exact: true })
    .click();
  await expect(page.locator('html')).toHaveAttribute('lang', value);
}
async function dismissNavigation(page: Page, action: () => Promise<unknown>, accepted: boolean) {
  const dialog = page.waitForEvent('dialog');
  const task = action();
  const prompt = await dialog;
  expect(prompt.type()).toBe('confirm');
  await (accepted ? prompt.accept() : prompt.dismiss());
  await task;
}

test('English and Italian persist across public routes while authored CMS and metadata remain verbatim', async ({
  page,
  context,
}) => {
  await page.goto(`${root}/rules`);
  await expect(page.getByRole('heading', { name: 'Save', exact: true })).toBeVisible();
  await language(page, 'it');
  await expect(page.getByRole('button', { name: "Lingua dell'interfaccia" })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Navigazione del torneo' })
      .getByRole('link', { name: 'Save', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Next', exact: true })).toBeVisible();
  await expect(page.getByText(authored, { exact: true }).first()).toBeVisible();
  await expect(page).toHaveTitle('Regolamento · LANG');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  expect((await context.cookies()).find((cookie) => cookie.name === 'portal_language')?.value).toBe(
    'it',
  );
  await page.goto(`${root}/matches`);
  await expect(
    page.getByRole('heading', { name: 'Incontri e risultati', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/24 ott 2026/).first()).toBeVisible();
  await page.goto(`${root}/mappools/save`);
  await page.getByRole('button', { name: 'Dettagli NM1', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('5,82');
  await expect(page.getByRole('dialog')).toContainText('Captain');
  await page.keyboard.press('Escape');
  await language(page, 'en');
  await page.getByRole('button', { name: 'Details for NM1', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('5.82');
  await expect(page.getByRole('dialog')).toContainText('English difficulty');
  await page.keyboard.press('Escape');
  await page.goto(`${admin}/referee/${matchId}`);
  await language(page, 'it');
  await expect(page.getByRole('tab', { name: 'regolamento', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'rose', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'cronologia', exact: true })).toBeVisible();
  await expect(page.getByLabel('Tipo di timer')).toHaveValue('PICK');
  await expect(page.getByLabel('Tipo di timer').locator('option:checked')).toHaveText('Scelta');
  await page.goto(`${admin}/mappools?view=pooling`);
  await expect(page.getByText('5,82 stelle', { exact: false }).first()).toBeVisible();
});

test('switching language retains dirty settings, CMS and team forms and localizes actual server failures', async ({
  page,
  context,
}) => {
  await page.goto(`${admin}/website?view=info`);
  const before = await db.tournament.findUniqueOrThrow({ where: { id } });
  await page.getByLabel('Description', { exact: true }).fill('Unsaved English Captain');
  await language(page, 'it');
  await expect(page.getByLabel('Descrizione', { exact: true })).toHaveValue(
    'Unsaved English Captain',
  );
  await expect(
    page.getByRole('button', { name: 'Salva modifiche', exact: true }).first(),
  ).toBeEnabled();
  expect((await db.tournament.findUniqueOrThrow({ where: { id } })).version).toBe(before.version);
  expect((await db.tournament.findUniqueOrThrow({ where: { id } })).description).toBe(authored);
  // Real validation and stale-version responses, without modifying a tournament.
  const endpoint = `/api/admin/action?tournament=${slug}`;
  const headers = { Origin: 'http://localhost:3001' };
  const stale = await context.request.post(endpoint, {
    headers,
    data: {
      type: 'settings.save',
      baseVersion: before.version + 100,
      description: 'Must not save',
    },
  });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).error).toBe(
    'Le impostazioni del torneo sono cambiate. Ricarica e revisiona prima di salvare.',
  );
  const invalid = await context.request.post(endpoint, {
    headers,
    data: { type: 'settings.save', baseVersion: 'invalid', description: 12 },
  });
  expect(invalid.status()).toBe(400);
  const invalidMessage = (await invalid.json()).error;
  expect(invalidMessage).toContain('description: Tipo di valore richiesto: testo.');
  expect(invalidMessage).toContain('baseVersion: Tipo di valore richiesto: numero.');
  await language(page, 'en');
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue(
    'Unsaved English Captain',
  );
  const english = await context.request.post(endpoint, {
    headers,
    data: {
      type: 'settings.save',
      baseVersion: before.version + 100,
      description: 'Must not save',
    },
  });
  expect(english.status()).toBe(409);
  expect((await english.json()).error).toBe(
    'Tournament settings changed. Reload and review before saving.',
  );
  await dismissNavigation(
    page,
    () =>
      page
        .getByRole('navigation', { name: 'Website sections' })
        .getByRole('link', { name: 'Homepage', exact: true })
        .click(),
    true,
  );
  await page.getByLabel('Page title', { exact: true }).fill('Unpublished Captain');
  const revisions = await db.pageRevision.count({ where: { tournamentId: id } });
  await language(page, 'it');
  await expect(page.getByLabel('Titolo della pagina', { exact: true })).toHaveValue(
    'Unpublished Captain',
  );
  expect(await db.pageRevision.count({ where: { tournamentId: id } })).toBe(revisions);
  await language(page, 'en');
  await dismissNavigation(
    page,
    () =>
      page
        .getByRole('navigation', { name: 'Administration' })
        .getByRole('link', { name: 'Teams & players', exact: true })
        .click(),
    true,
  );
  await language(page, 'it');
  await page.getByRole('button', { name: 'Nuova squadra', exact: true }).click();
  await page.getByLabel('Nome della squadra', { exact: true }).fill('Unsaved Captain');
  await dismissNavigation(
    page,
    () => page.getByRole('dialog').getByRole('button', { name: 'Chiudi finestra' }).click(),
    false,
  );
  await expect(page.getByLabel('Nome della squadra', { exact: true })).toHaveValue(
    'Unsaved Captain',
  );
  await dismissNavigation(page, () => page.keyboard.press('Escape'), true);
});

test('dirty pooling dialogs retain edits on canceled close, history navigation and programmatic stage exit', async ({
  page,
}) => {
  await page.goto(`${admin}/website?view=info`);
  await page
    .getByRole('navigation', { name: 'Administration' })
    .getByRole('link', { name: 'Stages & mappools', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Stages & mappools sections' })
    .getByRole('link', { name: 'Suggestions & playtesting', exact: true })
    .click();
  const suggest = page.getByRole('button', { name: 'Suggest maps', exact: true });
  await suggest.click();
  await page.getByLabel('Beatmap IDs or URLs', { exact: true }).fill('Captain unsaved input');
  await dismissNavigation(
    page,
    () => page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click(),
    false,
  );
  await expect(page.getByLabel('Beatmap IDs or URLs', { exact: true })).toHaveValue(
    'Captain unsaved input',
  );
  // Navigation API cancellation runs before Next's popstate handling.
  await dismissNavigation(page, () => page.evaluate(() => history.back()), false);
  await expect(page).toHaveURL(new RegExp('view=pooling'));
  await expect(page.getByLabel('Beatmap IDs or URLs', { exact: true })).toHaveValue(
    'Captain unsaved input',
  );
  await dismissNavigation(page, () => page.keyboard.press('Escape'), true);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(suggest).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp('/mappools$'));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp('website\\?view=info'));
  await page.getByLabel('Description', { exact: true }).fill('Forward must retain Captain');
  await dismissNavigation(page, () => page.evaluate(() => history.forward()), false);
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue(
    'Forward must retain Captain',
  );
  await dismissNavigation(page, () => page.evaluate(() => history.forward()), true);
  await expect(page).toHaveURL(new RegExp('/mappools$'));
  await page
    .getByRole('navigation', { name: 'Stages & mappools sections' })
    .getByRole('link', { name: 'Suggestions & playtesting', exact: true })
    .click();
  await page.getByRole('button', { name: 'Next - Save', exact: true }).first().click();
  await page.getByLabel('Pooler notes', { exact: true }).fill('Unsaved review notes');
  await dismissNavigation(
    page,
    () =>
      page.getByRole('dialog').getByRole('button', { name: 'Your review', exact: true }).click(),
    false,
  );
  await expect(page.getByLabel('Pooler notes', { exact: true })).toHaveValue(
    'Unsaved review notes',
  );
  expect((await db.poolCandidate.findUniqueOrThrow({ where: { id: candidateId } })).notes).toBe(
    authored,
  );
  await dismissNavigation(page, () => page.keyboard.press('Escape'), true);
  await page.goto(`${admin}/mappools?view=stages&stage=${stageId}&return=pool`);
  await page.getByLabel('Stage name', { exact: true }).fill('Unsaved stage');
  await dismissNavigation(
    page,
    () =>
      page.getByRole('dialog').getByRole('button', { name: 'Close dialog', exact: true }).click(),
    false,
  );
  await expect(page.getByLabel('Stage name', { exact: true })).toHaveValue('Unsaved stage');
  await dismissNavigation(page, () => page.keyboard.press('Escape'), true);
  await expect(page).toHaveURL(new RegExp(`/mappools\\?stage=${stageId}`));
});

test('bilingual shared layouts and populated/empty workflows fit every required viewport in both appearances', async ({
  page,
  context,
}, info) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const widths = [
    [1920, 1080],
    [1366, 900],
    [1024, 768],
    [768, 1024],
    [390, 844],
    [375, 812],
    [320, 740],
    [844, 390],
    [683, 512],
  ];
  const routes = [
    ['public', `${root}/matches`],
    ['chooser', '/admin/tournaments'],
    ['settings', `${admin}/website?view=info`],
    ['pooling', `${admin}/mappools?view=pooling`],
    ['referee', `${admin}/referee/${matchId}`],
    ['empty', `/t/${slug}-empty/admin/mappools`],
  ];
  for (const lang of ['en', 'it'] as const)
    for (const appearance of ['light', 'dark']) {
      await context.addCookies([
        { name: 'portal_language', value: lang, url: 'http://localhost:3001' },
        { name: 'portal_appearance', value: appearance, url: 'http://localhost:3001' },
      ]);
      for (const [name, url] of routes) {
        await page.goto(url);
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance);
        await expect(
          page.getByRole('button', {
            name: lang === 'it' ? "Lingua dell'interfaccia" : 'Interface language',
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole('status', {
            name: lang === 'it' ? 'Caricamento' : 'Loading',
            exact: true,
          }),
        ).toHaveCount(0);
        for (const [width, height] of widths) {
          await page.setViewportSize({ width, height });
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            `${name} ${lang} ${appearance} ${width}`,
          ).toBe(true);
          await page.screenshot({
            path: info.outputPath(`${name}-${lang}-${appearance}-${width}.png`),
            fullPage: true,
          });
        }
      }
    }
  expect(errors).toEqual([]);
});
