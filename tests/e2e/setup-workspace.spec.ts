import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { DEFAULT_MATCH_RULES, matchRulesSchema } from '../../src/lib/match-rules';
import { ALL_PERMISSIONS } from '../../src/lib/permissions';

const url = process.env.TEST_DATABASE_URL!;
if (new URL(url).pathname !== '/tournament_platform_test')
  throw Error('Isolated test database required');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const evidence = '.data/setup-workspace-20261103';
const slug = `setup-${randomUUID()}`;
const emptySlug = `setup-empty-${randomUUID()}`;
const root = `/t/${slug}/admin`;
const users: string[] = [];
const extraTournaments: string[] = [];
const participants: number[] = [];
let ownerToken = '';
let editorToken = '';

async function session(username: string, platformAdmin: boolean) {
  const token = randomBytes(32).toString('base64url');
  const user = await db.user.create({
    data: {
      osuId: randomInt(1_750_000_000, 1_790_000_000),
      username,
      avatarUrl: '',
      profileUrl: '',
      platformAdmin,
      sessions: {
        create: {
          id: createHash('sha256').update(token).digest('hex'),
          expiresAt: new Date(Date.now() + 3600_000),
        },
      },
    },
  });
  users.push(user.id);
  return { token, id: user.id };
}
async function login(
  context: BrowserContext,
  token: string,
  language = 'en',
  appearance = 'light',
) {
  await context.addCookies([
    { name: 'portal_appearance', value: appearance, url: 'http://localhost:3001' },
    {
      name: 'tournament_session',
      value: token,
      url: 'http://localhost:3001',
      httpOnly: true,
      sameSite: 'Lax',
    },
    { name: 'portal_language', value: language, url: 'http://localhost:3001' },
  ]);
}
async function tournament(id: string) {
  await db.tournament.create({
    data: {
      id,
      slug: id,
      name: `Workspace ${id.slice(0, 18)}`,
      acronym: 'WSP',
      description: '',
      format: 'TEAMS',
      status: 'DRAFT',
      settings: {
        create: {
          banner: '',
          gameplayScoring: 'SCORE_V2',
          matchRules: JSON.parse(JSON.stringify(DEFAULT_MATCH_RULES)),
          socialLinks: [],
          importantDates: [],
          navigation: [{ href: '/', label: 'Home' }],
          footer: '',
        },
      },
    },
  });
  for (const [position, acronym] of ['NM', 'HD', 'HR', 'DT', 'FM', 'TB'].entries())
    await db.modCategory.create({
      data: { tournamentId: id, acronym, name: acronym, color: '#a7d9bc', position },
    });
}
// The workspace opens the next unfinished section by itself, so this only clicks when closed.
const open = (page: Page, name: string) => ({
  async click() {
    const header = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name, exact: true, level: 2 }) })
      .getByRole('button', { name, exact: true })
      .first();
    if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click();
  },
});
async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true });
  await tournament(slug);
  await tournament(emptySlug);
  ownerToken = (await session(`setup-owner-${slug.slice(6, 14)}`, true)).token;
  const editor = await session(`setup-editor-${slug.slice(6, 14)}`, false);
  editorToken = editor.token;
  const role = await db.role.create({
    data: {
      tournamentId: slug,
      name: 'Content only',
      permissions: { create: [{ permissionKey: 'homepage.edit' }] },
    },
  });
  await db.userRole.create({
    data: { tournamentId: slug, userId: editor.id, roleId: role.id },
  });
});
test.afterAll(async () => {
  const where = { tournamentId: { in: [slug, emptySlug, ...extraTournaments] } };
  await db.tournamentPhase.updateMany({ where, data: { bracketId: null } });
  await db.bracketSlot.deleteMany({ where });
  await db.bracketNode.deleteMany({ where });
  await db.bracketRound.deleteMany({ where });
  await db.bracketEntry.deleteMany({ where });
  await db.bracket.deleteMany({ where });
  await db.match.deleteMany({ where });
  await db.team.deleteMany({ where });
  await db.tournamentPhase.deleteMany({ where });
  await db.poolPlan.deleteMany({ where });
  await db.mappool.deleteMany({ where });
  await db.tournamentStage.deleteMany({ where });
  await db.modCategory.deleteMany({ where });
  await db.auditLog.deleteMany({ where });
  await db.userRole.deleteMany({ where });
  await db.role.deleteMany({ where });
  await db.tournament.deleteMany({ where: { id: { in: [slug, emptySlug, ...extraTournaments] } } });
  await db.participant.deleteMany({ where: { osuId: { in: participants } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

test('configures a whole tournament from one screen', async ({ page, context }) => {
  await login(context, ownerToken);
  await page.goto(root);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Workspace');
  // An empty tournament starts with the format choice open.
  const format = page.getByRole('radiogroup', { name: 'Tournament format' });
  await expect(format).toBeVisible();
  await format.getByRole('radio', { name: /^Top seeds skip groups/ }).click();
  await expect(page.getByRole('list', { name: 'Phase flow' })).toContainText('Group stage');
  await page.getByRole('button', { name: 'Use this format' }).click();
  await expect(page.getByText(/Template applied/)).toBeVisible();

  const stages = await db.tournamentStage.findMany({
    where: { tournamentId: slug },
    orderBy: { position: 'asc' },
  });
  expect(stages.map((stage) => stage.name)).toEqual([
    'Qualifiers',
    'Group stage',
    'Quarterfinals',
    'Semifinals',
    'Finals',
    'Grand Finals',
  ]);
  const phases = await db.tournamentPhase.findMany({
    where: { tournamentId: slug },
    orderBy: { position: 'asc' },
  });
  expect(phases.map((phase) => phase.kind)).toEqual(['QUALIFIER', 'GROUPS', 'DOUBLE_ELIMINATION']);
  // Once a format exists, its choice is replaced by editing what it created.
  await expect(format).toBeHidden();

  // A rule-document table is one edit away.
  await open(page, 'Stages and mappools').click();
  await page.getByRole('spinbutton', { name: 'Best of for Finals' }).fill('15');
  await page.getByRole('spinbutton', { name: 'DT maps for Finals' }).fill('7');
  await page.getByRole('button', { name: 'Save stages' }).click();
  await expect(page.getByText('Stages saved.')).toBeVisible();
  const finals = await db.tournamentStage.findFirstOrThrow({
    where: { tournamentId: slug, name: 'Finals' },
    include: { poolPlan: true },
  });
  expect(matchRulesSchema.parse(finals.matchRules).bestOf).toBe(15);
  expect(
    (finals.poolPlan!.slots as { category: string }[]).filter((s) => s.category === 'DT'),
  ).toHaveLength(7);

  // A stage's details open in place, with its qualifier scoring and mappool editor.
  await page.getByRole('button', { name: 'Details for Qualifiers' }).click();
  await expect(page.getByRole('button', { name: 'Save qualifier scoring' })).toBeVisible();
  await expect(page.getByLabel('Seeded on')).toBeVisible();
  await page.getByRole('button', { name: 'Details for Qualifiers' }).click();

  // Team size has one control, reaching rules, roster limits and qualifiers together.
  await open(page, 'Rosters and entrants').click();
  await page.getByRole('spinbutton', { name: 'Players per side' }).fill('3');
  await page.getByRole('spinbutton', { name: 'Maximum roster' }).fill('5');
  await page.getByRole('button', { name: 'Save rosters' }).click();
  await expect(page.getByText('Roster settings saved.')).toBeVisible();
  const qualifiers = await db.tournamentStage.findFirstOrThrow({
    where: { tournamentId: slug, kind: 'QUALIFIERS' },
  });
  expect((qualifiers.qualifierPolicy as { requiredPlayers: number }).requiredPlayers).toBe(3);
  const afterRoster = await db.tournamentSettings.findUniqueOrThrow({
    where: { tournamentId: slug },
  });
  expect(matchRulesSchema.parse(afterRoster.matchRules).teamSize).toBe(3);
  expect((afterRoster.registrationPolicy as { maxPlayers: number }).maxPlayers).toBe(5);

  // The win condition reaches every stage, and each stage keeps its own match length.
  await open(page, 'Scoring and mods').click();
  await page.getByLabel('Maps are won by').selectOption('ACCURACY');
  await page.getByRole('button', { name: 'Save scoring and mods' }).click();
  await expect(page.getByText('Scoring saved.')).toBeVisible();
  const scored = await db.tournamentStage.findFirstOrThrow({
    where: { tournamentId: slug, name: 'Finals' },
  });
  expect(matchRulesSchema.parse(scored.matchRules)).toMatchObject({
    bestOf: 15,
    teamSize: 3,
    scoreMode: 'SCORE_V2',
    winCondition: { metric: 'ACCURACY', teamAggregation: 'AVERAGE', applyMultipliers: false },
  });

  // An impossible plan explains itself and cannot be saved.
  await open(page, 'Phases and progression').click();
  const save = page.getByRole('button', { name: 'Save format' });
  const entrants = page.getByRole('spinbutton', { name: 'Entrants advancing' });
  await expect(entrants).toHaveValue('20');
  await entrants.fill('10');
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'This rank range goes beyond the entrants who advance.' }),
  ).toBeVisible();
  await expect(save).toBeDisabled();
  await entrants.fill('20');
  await page.getByRole('button', { name: 'Preview matches' }).click();
  await expect(page.getByText('47 matches would be created')).toBeVisible();
  await page.getByText('Main bracket · 23 matches').click();
  await expect(page.getByText('Qualifiers #1 vs Group stage: place 1 (4)')).toBeVisible();
  await page.getByRole('textbox', { name: 'Double elimination name' }).fill('Playoffs');
  await save.click();
  await expect(page.getByText('Tournament format saved.')).toBeVisible();
  expect(
    (await db.tournamentPhase.findFirstOrThrow({ where: { tournamentId: slug, key: 'main' } }))
      .name,
  ).toBe('Playoffs');

  // Registration opens in one click and becomes reachable.
  await open(page, 'Registration and eligibility').click();
  await page.getByRole('button', { name: 'Open registration', exact: true }).click();
  await expect(page.getByText('Registration opened.')).toBeVisible();
  const opened = await db.tournament.findUniqueOrThrow({
    where: { id: slug },
    include: { settings: true },
  });
  expect(opened.status).toBe('REGISTRATIONS_OPEN');
  expect(opened.settings!.navigation).toContainEqual({ label: 'Register', href: '/register' });

  // Readiness points at what is left, and publication stays possible regardless.
  await expect(page.getByRole('navigation', { name: 'Setup sections' })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Setup progress' })).toBeVisible();
  await page.getByRole('button', { name: /Publish the mappool for 6 more stages/ }).click();
  await expect(page.getByRole('button', { name: 'Save stages' })).toBeVisible();

  await open(page, 'Publication').click();
  await page.getByRole('button', { name: 'Publish tournament', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Tournament published.')).toBeVisible();
  expect((await db.tournament.findUniqueOrThrow({ where: { id: slug } })).published).toBe(true);
  await expect(page.getByText('Published. Everything here stays editable.')).toBeVisible();
});

test('resumes where the organizer left off', async ({ page, context }) => {
  await login(context, ownerToken);
  await page.goto(`${root}#format`);
  await expect(page.getByRole('button', { name: 'Save format' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Double elimination name' }).fill('Unsaved name');
  // Leaving the section with unsaved edits asks first, and declining keeps them.
  page.once('dialog', (dialog) => void dialog.dismiss());
  await open(page, 'Schedule').click();
  await expect(page.getByRole('textbox', { name: 'Double elimination name' })).toHaveValue(
    'Unsaved name',
  );
  page.once('dialog', (dialog) => void dialog.accept());
  await open(page, 'Schedule').click();
  await expect(page.getByRole('button', { name: 'Save key dates' })).toBeVisible();
  await page.getByRole('button', { name: 'Add a date for each stage' }).click();
  await expect(page.getByRole('textbox', { name: 'Label' }).first()).toHaveValue('Qualifiers');
});

test('rejects a stale format and keeps the organizer’s work visible', async ({ page, context }) => {
  await login(context, ownerToken);
  await page.goto(`${root}#format`);
  const name = page.getByRole('textbox', { name: 'Double elimination name' });
  await name.fill('Stale edit');
  await db.tournamentPhase.updateMany({
    where: { tournamentId: slug, key: 'main' },
    data: { name: 'Changed elsewhere', version: { increment: 1 } },
  });
  await page.getByRole('button', { name: 'Save format' }).click();
  await expect(page.getByText(/format changed/)).toBeVisible();
  await expect(name).toHaveValue('Stale edit');
  await db.tournamentPhase.updateMany({
    where: { tournamentId: slug, key: 'main' },
    data: { name: 'Playoffs' },
  });
});

test('locks a format, advances entrants and creates real matches', async ({ page, context }) => {
  const id = `setup-run-${randomUUID()}`;
  await tournament(id);
  extraTournaments.push(id);
  const stage = await db.tournamentStage.create({
    data: { tournamentId: id, name: 'Finals', slug: 'finals', kind: 'ELIMINATION', position: 0 },
  });
  const teams = [];
  for (let index = 0; index < 4; index++) {
    const osuId = randomInt(1_700_000_000, 1_749_000_000);
    await db.participant.create({ data: { osuId, username: `run-${osuId}`, avatarUrl: '' } });
    participants.push(osuId);
    const team = await db.team.create({
      data: {
        tournamentId: id,
        name: `Runner ${index + 1}`,
        slug: `runner-${index + 1}`,
        status: 'APPROVED',
        format: 'TEAM',
        seed: index + 1,
      },
    });
    await db.teamMember.createMany({
      data: [{ tournamentId: id, teamId: team.id, osuId, position: 0, captain: true }],
    });
    teams.push(team);
  }
  await db.tournamentSettings.update({
    where: { tournamentId: id },
    data: {
      matchRules: JSON.parse(JSON.stringify(matchRulesSchema.parse({ teamSize: 1, bestOf: 3 }))),
    },
  });
  await db.tournamentPhase.create({
    data: {
      tournamentId: id,
      key: 'main',
      position: 0,
      kind: 'SINGLE_ELIMINATION',
      name: 'Playoffs',
      stageId: stage.id,
      config: {
        entries: [{ source: { kind: 'REGISTRATION', count: 4 }, seedFrom: 1 }],
        size: 4,
        pairing: 'STANDARD',
        thirdPlace: false,
        reseed: 'NONE',
        roundStages: {},
        rematch: 'ALLOW',
      },
    },
  });
  await login(context, ownerToken);
  await page.goto(`/t/${id}/admin#format`);
  await page.getByRole('button', { name: 'Lock format' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Format locked. Its matches are reserved.')).toBeVisible();
  await expect(page.getByText('Waiting for entrants')).toBeVisible();
  // A locked format can no longer be edited, though it can be unlocked until play starts.
  await expect(page.getByRole('button', { name: 'Save format' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Unlock format' })).toBeVisible();
  const nodes = await db.bracketNode.findMany({ where: { tournamentId: id } });
  expect(nodes.map((node) => node.matchNumber).sort()).toEqual([1, 2, 3]);
  expect(await db.match.count({ where: { tournamentId: id } })).toBe(0);

  await page.getByRole('button', { name: 'Review entrants' }).click();
  await expect(page.getByRole('combobox', { name: 'Seed 1 in Playoffs' })).toHaveValue(teams[0].id);
  await page.screenshot({ path: `${evidence}/advance-review-1366.png` });
  // Changing a seat needs a fresh review and a recorded reason before it can apply.
  await page.getByRole('combobox', { name: 'Seed 2 in Playoffs' }).selectOption(teams[3].id);
  await page.getByRole('combobox', { name: 'Seed 4 in Playoffs' }).selectOption(teams[1].id);
  await expect(page.getByRole('button', { name: 'Apply entrants' })).toBeDisabled();
  await page.getByLabel('Why are you setting seats by hand?').fill('Hosts swapped two seeds');
  await page.getByRole('button', { name: 'Review entrants' }).first().click();
  await expect(page.getByRole('button', { name: 'Apply entrants' })).toBeEnabled();
  await page.getByRole('button', { name: 'Apply entrants' }).click();
  await expect(page.getByText('Entrants applied.')).toBeVisible();
  await expect(page.getByText('Entrants set, revision 1')).toBeVisible();
  const row = await db.tournamentPhase.findFirstOrThrow({ where: { tournamentId: id } });
  const history = await db.phaseAdvancement.findFirstOrThrow({ where: { phaseId: row.id } });
  expect(history.reason).toBe('Hosts swapped two seeds');
  // Seeds 1 v 4 and 2 v 3 become real matches using their reserved numbers.
  const matches = await db.match.findMany({
    where: { tournamentId: id },
    orderBy: { matchNumber: 'asc' },
  });
  expect(matches.map((match) => match.matchNumber)).toEqual([1, 2]);
  expect([matches[0].teamAId, matches[0].teamBId]).toEqual([teams[0].id, teams[1].id]);

  await page.getByRole('link', { name: 'Open bracket' }).click();
  await expect(page.getByText('Managed by the tournament format')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete bracket' })).toHaveCount(0);
  await page.screenshot({ path: `${evidence}/advance-bracket-1366.png` });
});

test('shows only what a limited role can act on', async ({ page, context }) => {
  await login(context, editorToken);
  await page.goto(root);
  await expect(page.getByRole('heading', { name: 'Publication', level: 2 })).toBeVisible();
  for (const hidden of ['Scoring and mods', 'Phases and progression', 'Staff and access'])
    await expect(page.getByRole('heading', { name: hidden, level: 2 })).toHaveCount(0);
  const forbidden = await context.request.post(`/api/admin/action?tournament=${slug}`, {
    headers: { Origin: 'http://localhost:3001' },
    data: {
      type: 'setup.apply',
      operations: [{ type: 'settings.save', baseVersion: 1, name: 'Hijacked' }],
    },
  });
  expect(forbidden.status()).toBe(403);
  expect((await db.tournament.findUniqueOrThrow({ where: { id: slug } })).name).not.toBe(
    'Hijacked',
  );
  expect(ALL_PERMISSIONS).toContain('homepage.edit');
});

test('stays usable at every width in both appearances and languages', async ({ page, context }) => {
  test.setTimeout(240000);
  for (const [token, target, label] of [
    [ownerToken, slug, 'populated'],
    [ownerToken, emptySlug, 'empty'],
  ] as const) {
    for (const scheme of ['light', 'dark'] as const) {
      await login(context, token, 'en', scheme);
      for (const width of [1920, 1366, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        const section = label === 'empty' ? '' : '#format';
        // Leave first: a same-URL hash change would not reload the page or its appearance.
        await page.goto('about:blank');
        await page.goto(`/t/${target}/admin${section}`);
        await expect(page.locator('html')).toHaveAttribute('data-appearance', scheme);
        await expect(page.getByRole('navigation', { name: 'Setup sections' })).toBeVisible();
        if (label === 'empty')
          await expect(page.getByRole('radiogroup', { name: 'Tournament format' })).toBeVisible();
        else await expect(page.getByRole('button', { name: 'Save format' })).toBeVisible();
        await expectNoOverflow(page);
        await page.screenshot({
          path: `${evidence}/${label}-${scheme}-${width}.png`,
          fullPage: width <= 768,
        });
        if (label === 'populated' && (width === 1366 || width === 320)) {
          await open(page, 'Stages and mappools').click();
          await expect(page.getByRole('button', { name: 'Save stages' })).toBeVisible();
          await expectNoOverflow(page);
          // Two-digit values must be readable, not clipped by their inputs.
          const bestOf = page.getByRole('spinbutton', { name: 'Best of for Semifinals' });
          const clipped = await bestOf.evaluate(
            (input: HTMLInputElement) => input.scrollWidth > input.clientWidth,
          );
          expect(clipped).toBe(false);
          await page.screenshot({ path: `${evidence}/stages-${scheme}-${width}.png` });
        }
      }
    }
  }
  await login(context, ownerToken, 'it');
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('about:blank');
  await page.goto(`/t/${slug}/admin#format`);
  await expect(page.getByRole('heading', { name: 'Fasi e progressione', level: 2 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salva il formato' })).toBeVisible();
  await page.screenshot({ path: `${evidence}/italian-1366.png` });
});
