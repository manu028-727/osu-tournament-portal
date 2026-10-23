import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { assertTestDatabase } from '../../src/lib/instance';
import { DEFAULT_MATCH_RULES } from '../../src/lib/match-rules';

assertTestDatabase(process.env.TEST_DATABASE_URL);
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
const prefix = `stage-ui-${randomUUID()}`;
const session = randomBytes(32).toString('base64url');
let userId = '';
const stageIds: string[] = [];

test.beforeAll(async () => {
  await db.tournament.create({
    data: {
      id: prefix,
      slug: prefix,
      name: 'Stage workflow QA',
      acronym: 'QA',
      description: '',
      gameMode: 'osu',
      settings: {
        create: {
          gameplayScoring: 'SCORE_V2',
          matchRules: DEFAULT_MATCH_RULES,
          navigation: [],
          importantDates: [],
          socialLinks: [],
          footer: '',
        },
      },
    },
  });
  const user = await db.user.create({
    data: {
      osuId: randomInt(1_500_000_000, 1_900_000_000),
      username: prefix,
      avatarUrl: '',
      profileUrl: '',
      platformAdmin: true,
      sessions: {
        create: {
          id: createHash('sha256').update(session).digest('hex'),
          expiresAt: new Date(Date.now() + 3600000),
        },
      },
    },
  });
  userId = user.id;
  for (const [position, name] of [
    'Round of 16',
    'Quarterfinals',
    'Semifinals',
    'Qualifiers',
  ].entries()) {
    const stage = await db.tournamentStage.create({
      data: {
        tournamentId: prefix,
        name,
        slug: `stage-${position}`,
        position,
        kind: name === 'Qualifiers' ? 'QUALIFIERS' : 'ELIMINATION',
        mappool: { create: {} },
      },
    });
    stageIds.push(stage.id);
  }
});
test.afterAll(async () => {
  assertTestDatabase(process.env.TEST_DATABASE_URL);
  await db.$transaction(async (tx) => {
    await tx.auditLog.deleteMany({ where: { tournamentId: prefix } });
    await tx.mappool.deleteMany({ where: { tournamentId: prefix } });
    await tx.tournamentStage.deleteMany({ where: { tournamentId: prefix } });
    await tx.tournament.deleteMany({ where: { id: prefix } });
    if (userId) await tx.user.deleteMany({ where: { id: userId } });
  });
  await db.$disconnect();
});

test('bulk rules, source copying, templates, reordering, and mobile selection persist', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.addCookies([{ name: 'tournament_session', value: session, url: baseURL! }]);
  const route = `/t/${prefix}/admin/mappools?view=stages`;
  await page.goto(route);
  await expect(page.getByRole('heading', { name: 'Tournament stages', exact: true })).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'Select Round of 16', exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole('combobox', { name: 'Best of: Qualifiers' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Select Round of 16', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Select Quarterfinals', exact: true }).check();
  await page
    .getByRole('region', { name: 'Bulk stage editing' })
    .getByRole('combobox', { name: 'Best of', exact: true })
    .selectOption('13');
  await page.getByRole('button', { name: 'Apply to 2 stages', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Best of: Round of 16' })).toHaveValue('13');
  expect(
    (await db.tournamentStage.findUniqueOrThrow({ where: { id: stageIds[0] } })).matchRules,
  ).toMatchObject({ bestOf: 13 });
  expect(
    (await db.tournamentStage.findUniqueOrThrow({ where: { id: stageIds[2] } })).matchRules,
  ).toBeNull();

  await page.getByRole('button', { name: 'Apply Round of 16 rules to other stages' }).click();
  await page.getByRole('checkbox', { name: 'Select Semifinals', exact: true }).check();
  await page.getByRole('button', { name: 'Apply to 1 stages', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Best of: Semifinals' })).toHaveValue('13');
  await page.getByRole('button', { name: 'Move Semifinals up', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Move Semifinals up', exact: true })).toBeEnabled();
  await expect
    .poll(
      async () =>
        (await db.tournamentStage.findUniqueOrThrow({ where: { id: stageIds[2] } })).position,
    )
    .toBe(1);

  await page.getByRole('button', { name: 'New stage', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Stage template').selectOption('GRAND_FINALS');
  await expect(dialog.getByLabel('Stage name', { exact: true })).toHaveValue('Grand Finals');
  await dialog.getByLabel('Configuration source').selectOption(stageIds[0]);
  await expect(dialog.getByLabel('Stage Best-of', { exact: true })).toHaveValue('13');
  await dialog.getByRole('button', { name: 'Save stage', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Best of: Grand Finals' })).toHaveValue('13');
  await page.getByRole('button', { name: 'Duplicate Round of 16', exact: true }).click();
  const duplication = page.getByRole('dialog');
  await duplication.getByLabel('New stage name', { exact: true }).fill('Independent copy');
  await expect(duplication.getByLabel('New stage URL slug')).toHaveValue('independent-copy');
  await duplication
    .getByLabel('Copy gameplay rules, Best-of and action sequence', { exact: true })
    .uncheck();
  await duplication.getByLabel('Copy stage banner', { exact: true }).uncheck();
  await duplication.getByLabel('Mappool copy', { exact: true }).selectOption('EMPTY');
  await duplication.getByRole('button', { name: 'Duplicate stage', exact: true }).click();
  await expect(duplication).toHaveCount(0);
  const copied = await db.tournamentStage.findUniqueOrThrow({
    where: { tournamentId_slug: { tournamentId: prefix, slug: 'independent-copy' } },
    include: { mappool: true },
  });
  expect(copied.matchRules).toBeNull();
  expect(copied.mappool?.state).toBe('DRAFT');
  await page.screenshot({ path: '.data/visual/stage-workflows-desktop.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Find stage', { exact: true }).fill('Semifinals');
  await page.getByRole('checkbox', { name: 'Select all visible stages' }).check();
  await expect(page.getByText('1 visible stages selected', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Rule source', exact: true }).selectOption('TOURNAMENT');
  await page.getByRole('button', { name: 'Apply to 1 stages', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Best of: Semifinals' })).toHaveValue('11');
  expect(
    (await db.tournamentStage.findUniqueOrThrow({ where: { id: stageIds[2] } })).matchRules,
  ).toBeNull();
  await page.screenshot({ path: '.data/visual/stage-workflows-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
