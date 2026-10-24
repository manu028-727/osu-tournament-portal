import { test, expect, type Page } from '@playwright/test';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertTestDatabase } from '../../src/lib/instance';

assertTestDatabase(process.env.TEST_DATABASE_URL);
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
const id = randomUUID(),
  emptyId = randomUUID(),
  userId = randomUUID();
const slug = `homepage-${id}`,
  root = `/t/${slug}`,
  raw = randomBytes(32).toString('base64url');
const title = 'A new season, your next challenge';
const blocks = [
  {
    type: 'hero',
    content: {
      eyebrow: 'Community tournament',
      title,
      html: '<p>Form your team. Find your rhythm. Make this season yours.</p>',
      image: '/homepage-qa-hero.svg',
      buttons: [{ label: 'Read the rules', href: '/rules' }],
    },
  },
  {
    type: 'text',
    content: {
      eyebrow: 'Made for the community',
      title: 'Every team has a story',
      html: '<p>Play together, learn together, and enjoy a competition built around the community.</p><ul><li>Weekly matches</li><li>A shared love of rhythm</li></ul>',
    },
  },
  {
    type: 'announcements',
    content: {
      eyebrow: 'Latest update',
      title: 'Registration dates are confirmed',
      text: 'Gather your teammates and read the format before signing up.',
      buttons: [{ label: 'Meet the staff', href: '/staff' }],
    },
  },
  {
    type: 'image',
    content: {
      title: 'Artwork from the community',
      text: 'Original artwork stays fully visible, with its own caption.',
      image: '/homepage-qa-art.svg',
    },
  },
  {
    type: 'buttons',
    content: {
      title: 'Everything you need to play',
      text: 'Keep the useful links close.',
      buttons: [
        { label: 'Explore the mappools', href: '/mappools' },
        { label: 'Read the rules', href: '/rules' },
        { label: 'Meet the staff', href: '/staff' },
      ],
    },
  },
  {
    type: 'timeline',
    content: {
      eyebrow: 'Mark your calendar',
      title: 'The road to the finals',
      text: 'All milestones use the tournament calendar.',
    },
  },
  { type: 'hero', content: { title: 'A title-only Hero also renders' } },
  { type: 'image', content: { image: '/homepage-qa-art.svg' } },
  { type: 'hero', content: { html: '<p></p>' } },
  {
    type: 'hero',
    visible: false,
    content: { title: 'PRIVATE HIDDEN HERO', image: '/homepage-qa-private.svg' },
  },
];
test.beforeAll(async () => {
  await db.user.create({
    data: {
      id: userId,
      osuId: randomInt(1_900_000_000, 2_000_000_000),
      username: 'Homepage QA',
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
  for (const tournamentId of [id, emptyId])
    await db.tournament.create({
      data: {
        id: tournamentId,
        slug: tournamentId === id ? slug : `${slug}-empty`,
        name:
          tournamentId === id
            ? 'Community Rhythm Cup'
            : 'A community championship with a deliberately long title for narrow screens',
        acronym: 'CRC',
        description: tournamentId === id ? 'A community competition for rhythm game players.' : '',
        status: 'UPCOMING',
        published: true,
        settings: {
          create: {
            gameplayScoring: 'SCORE_V2',
            banner: tournamentId === id ? '/homepage-qa-banner.svg' : '',
            logo: tournamentId === id ? '/homepage-qa-logo.svg' : '',
            registrationUrl: '',
            socialLinks: [],
            footer: 'Organized by the community.',
            importantDates:
              tournamentId === id
                ? [
                    { label: 'Registration opens', date: '2026-11-01' },
                    { label: 'Qualifiers', date: '2026-11-14' },
                    { label: 'Finals', date: '2026-12-06' },
                  ]
                : [],
            navigation: [
              { label: 'Home', href: '/' },
              { label: 'Mappools', href: '/mappools' },
              { label: 'Rules', href: '/rules' },
              { label: 'Staff', href: '/staff' },
            ],
          },
        },
      },
    });
  const page = await db.page.create({
    data: { tournamentId: id, slug: 'home', title: 'Community Rhythm Cup' },
  });
  const revision = await db.pageRevision.create({
    data: {
      tournamentId: id,
      pageId: page.id,
      title: 'Community Rhythm Cup',
      html: '<p>Saved page introduction.</p>',
      blocks: {
        create: blocks.map((block, position) => ({
          ...block,
          visible: block.visible ?? true,
          position,
        })),
      },
    },
  });
  await db.page.update({
    where: { id: page.id },
    data: { draftRevisionId: revision.id, publishedRevisionId: revision.id, state: 'PUBLISHED' },
  });
});
test.afterAll(async () => {
  await db.page.updateMany({
    where: { tournamentId: { in: [id, emptyId] } },
    data: { draftRevisionId: null, publishedRevisionId: null },
  });
  await db.auditLog.deleteMany({ where: { tournamentId: { in: [id, emptyId] } } });
  await db.tournament.deleteMany({ where: { id: { in: [id, emptyId] } } });
  await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
});

async function artwork(page: Page) {
  await page.route('**/homepage-qa-*.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 400"><rect width="1200" height="400" fill="#342c42"/><circle cx="1000" cy="90" r="240" fill="#ad82b5"/><circle cx="180" cy="340" r="220" fill="#8467a0"/><path d="M0 320L1200 60" stroke="#efb0ca" stroke-width="70"/><text x="100" y="240" fill="white" font-family="sans-serif" font-weight="bold" font-size="64">COMMUNITY RHYTHM CUP</text></svg>`,
    }),
  );
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const mode of ['dark', 'light'] as const)
  test(`homepage blocks and empty state across responsive layouts in ${mode}`, async ({
    browser,
  }, info) => {
    test.setTimeout(240000);
    await db.tournamentSettings.update({
      where: { tournamentId: id },
      data: { primaryColor: mode === 'dark' ? '#8ad3ad' : '#8e457b', accentColor: '#b6a0e5' },
    });
    const context = await browser.newContext({ colorScheme: mode, reducedMotion: 'reduce' });
    await context.addCookies([
      { name: 'portal_appearance', value: mode, url: 'http://localhost:3001' },
    ]);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await artwork(page);
    try {
      for (const [width, height] of [
        [3440, 1200],
        [2560, 1100],
        [1920, 1080],
        [1366, 900],
        [1024, 900],
        [844, 390],
        [768, 1024],
        [683, 900],
        [390, 844],
        [375, 812],
        [320, 740],
      ]) {
        await page.setViewportSize({ width, height });
        await page.goto(root);
        const profile = page.getByRole('banner', { name: 'Tournament profile', exact: true });
        await expect(profile).toContainText('Community Rhythm Cup');
        await expect(profile).not.toContainText(title);
        await expect(profile.locator('img').first()).toHaveAttribute(
          'src',
          '/homepage-qa-banner.svg',
        );
        await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
        await expect(page.locator('[data-block-type="hero"] img')).toHaveAttribute(
          'src',
          '/homepage-qa-hero.svg',
        );
        await expect(
          page.locator('[data-block-type="hero"]').getByRole('link', { name: 'Read the rules' }),
        ).toBeVisible();
        await expect(
          page.getByRole('heading', { name: 'A title-only Hero also renders' }),
        ).toBeVisible();
        await expect(page.getByText('Saved page introduction.')).toBeVisible();
        await expect(page.locator('[data-block-type="timeline"] time')).toHaveCount(3);
        await expect(page.locator('[data-block-type]')).toHaveCount(8);
        await expect(page.getByText('PRIVATE HIDDEN HERO')).toHaveCount(0);
        await expect(page.locator('img[src="/homepage-qa-private.svg"]')).toHaveCount(0);
        await noOverflow(page);
        const content = (await page.locator('[data-homepage]').boundingBox())!;
        expect(Math.abs(content.x - (await profile.boundingBox())!.x)).toBeLessThan(1);
        if (width >= 1366) expect(content.width).toBeGreaterThan(Math.min(width * 0.94, 2500));
        await page.screenshot({
          path: info.outputPath(`homepage-${mode}-${width}.png`),
          fullPage: true,
        });
        await page.goto(`/t/${slug}-empty`);
        await expect(
          page.getByRole('banner', { name: 'Tournament profile', exact: true }).locator('img'),
        ).toHaveCount(0);
        await expect(page.locator('[data-block-type]')).toHaveCount(0);
        await noOverflow(page);
        await page.screenshot({
          path: info.outputPath(`empty-${mode}-${width}.png`),
          fullPage: true,
        });
      }
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

test('editor saves, reorders and previews independent Hero sections before publishing', async ({
  page,
  context,
  browser,
}, info) => {
  test.setTimeout(180000);
  await context.addCookies([
    { name: 'tournament_session', value: raw, url: 'http://localhost:3001' },
  ]);
  await artwork(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${root}/admin/website?view=homepage`);
  const section = (name: string) =>
    page
      .locator('details.cms-block')
      .filter({ has: page.locator('summary').filter({ hasText: name }) });
  const hero = section(title);
  await expect(hero.getByLabel('Section title')).toHaveValue(title);
  await hero.getByLabel('Block type').selectOption('text');
  await hero.getByLabel('Block type').selectOption('hero');
  const editor = hero.getByRole('textbox', { name: 'Rich text content', exact: true });
  await editor.fill('Edited Hero body after a type change.');
  const editorNode = await editor.elementHandle();
  await hero.locator('..').getByRole('button', { name: 'Move down', exact: true }).click();
  // Reordering must move the existing editor instead of reusing another section's editor.
  await hero.locator('summary').click();
  await expect(editor).toContainText('Edited Hero body after a type change.');
  expect(await editor.evaluate((node, original) => node === original, editorNode)).toBe(true);
  await page.getByRole('button', { name: 'Add section', exact: true }).click();
  const added = section('New section');
  await added.locator('summary').click();
  await added.getByLabel('Block type').selectOption('hero');
  await added.getByLabel('Section title').fill('A newly added editable Hero');
  const newHero = section('A newly added editable Hero');
  await newHero.getByLabel('Body text').fill('Only published when the organizer chooses.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved draft' })).toBeVisible();
  await page.getByRole('button', { name: 'Preview draft', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Draft preview', exact: true });
  await expect(preview.getByRole('heading', { name: 'A newly added editable Hero' })).toBeVisible();
  await expect(preview.getByText('Edited Hero body after a type change.')).toBeVisible();
  await expect(
    preview.getByRole('banner', { name: 'Tournament profile', exact: true }),
  ).toContainText('Community Rhythm Cup');
  await preview
    .getByRole('heading', { name: 'A newly added editable Hero' })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('editor-preview-desktop.png') });
  await page.setViewportSize({ width: 320, height: 740 });
  await noOverflow(page);
  await preview
    .getByRole('heading', { name: 'A newly added editable Hero' })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('editor-preview-mobile.png') });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1366, height: 900 });
  const visitor = await browser.newContext();
  const publicPage = await visitor.newPage();
  await artwork(publicPage);
  try {
    await publicPage.goto(root);
    await expect(
      publicPage.getByRole('heading', { name: 'A newly added editable Hero' }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('status').filter({ hasText: 'Published' })).toBeVisible();
    await publicPage.reload();
    await expect(
      publicPage.getByRole('heading', { name: 'A newly added editable Hero' }),
    ).toBeVisible();
    await expect(publicPage.getByText('Edited Hero body after a type change.')).toBeVisible();
    await expect(publicPage.locator('[data-block-type]').first()).toHaveAttribute(
      'data-block-type',
      'text',
    );
    await publicPage
      .getByRole('navigation', { name: 'Tournament navigation', exact: true })
      .getByRole('link', { name: 'Mappools' })
      .click();
    await expect(
      publicPage.getByRole('banner', { name: 'Tournament profile', exact: true }),
    ).toContainText('Community Rhythm Cup');
    await expect(publicPage.getByText('A newly added editable Hero')).toHaveCount(0);
    await publicPage.goto(root);
    await newHero.locator('summary').click();
    await newHero.getByLabel('Visible', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved draft' })).toBeVisible();
    await page.getByRole('button', { name: 'Preview draft', exact: true }).click();
    await expect(preview.getByRole('heading', { name: 'A newly added editable Hero' })).toHaveCount(
      0,
    );
    await page.keyboard.press('Escape');
    await publicPage.reload();
    await expect(
      publicPage.getByRole('heading', { name: 'A newly added editable Hero' }),
    ).toBeVisible();
    await newHero.locator('summary').click();
    await newHero.getByRole('button', { name: 'Remove this section?', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Confirm', exact: true })
      .click();
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved draft' })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 740 });
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath('editor-mobile.png'), fullPage: true });
    await publicPage.reload();
    await expect(
      publicPage.getByRole('heading', { name: 'A newly added editable Hero' }),
    ).toBeVisible();
  } finally {
    await visitor.close();
  }
});

test('homepage follows system appearance and keeps authored copy through language changes and touch navigation', async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  await context.addCookies([
    { name: 'portal_appearance', value: 'system', url: 'http://localhost:3001' },
  ]);
  const page = await context.newPage();
  await artwork(page);
  try {
    await page.goto(root);
    const hero = page.locator('[data-block-type="hero"]').first();
    const light = await hero.evaluate((node) => getComputedStyle(node).backgroundColor);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect
      .poll(() => hero.evaluate((node) => getComputedStyle(node).backgroundColor))
      .not.toBe(light);
    await page.getByRole('button', { name: 'Interface language', exact: true }).tap();
    await page.getByRole('menuitemradio', { name: 'Italiano', exact: true }).tap();
    await expect(page.locator('html')).toHaveAttribute('lang', 'it');
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await noOverflow(page);
    await page.getByRole('heading', { name: title, exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('homepage-system-italian-touch.png') });
    await hero.getByRole('link', { name: 'Read the rules', exact: true }).tap();
    await expect(page).toHaveURL(`http://localhost:3001${root}/rules`);
    await page.getByRole('link', { name: 'Home', exact: true }).tap();
    await expect(page).toHaveURL(`http://localhost:3001${root}`);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
