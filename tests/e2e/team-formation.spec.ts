import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { DEFAULT_MATCH_RULES } from '../../src/lib/match-rules';
import { qualifierPolicySchema } from '../../src/lib/qualifier-policy';
import { inheritedRules } from '../../src/lib/gameplay-scoring';

const url = process.env.TEST_DATABASE_URL!;
if (new URL(url).pathname !== '/tournament_platform_test')
  throw Error('Isolated test database required');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const evidence = '.data/setup-workspace-20261103';
const slug = `formation-${randomUUID()}`;
const root = `/t/${slug}/admin`;
const users: string[] = [];
const participants: number[] = [];
const beatmaps: number[] = [];
let token = '';
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const PLAYERS = 12;
const names = Array.from({ length: PLAYERS }, (_, index) => `Player ${index + 1}`);

async function login(context: BrowserContext, language = 'en', appearance = 'light') {
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
async function expectNoOverflow(page: Page) {
  const { overflow, offenders } = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return {
      overflow: document.documentElement.scrollWidth - width,
      // Names what pokes out, skipping anything inside a container meant to scroll.
      offenders: [...document.querySelectorAll('body *')]
        .filter((element) => {
          for (let up = element.parentElement; up; up = up.parentElement)
            if (['auto', 'scroll', 'hidden'].includes(getComputedStyle(up).overflowX)) return false;
          return element.getBoundingClientRect().right > width + 1;
        })
        .slice(0, 6)
        .map((element) => `${element.tagName}.${element.className}`.slice(0, 80)),
    };
  });
  expect(overflow, offenders.join(' | ')).toBeLessThanOrEqual(1);
}
// Pages here open with a hash, which the workspace honours once its data has loaded.
async function openSection(page: Page, name: string) {
  await expect(
    page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name, exact: true, level: 2 }) })
      .getByRole('button', { name, exact: true })
      .first(),
  ).toHaveAttribute('aria-expanded', 'true');
}
async function confirm(page: Page, trigger: string, final = trigger) {
  await page.getByRole('button', { name: trigger, exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: new RegExp(`^(confirm|${final})`, 'i') })
    .last()
    .click();
}

// A tournament where individual qualifiers have finished and registration has closed: the
// starting point a real draft event reaches through ordinary play.
async function seed() {
  await db.tournament.create({
    data: {
      id: slug,
      slug,
      name: 'Formation fixture',
      acronym: 'FOR',
      description: '',
      format: 'SOLO',
      status: 'UPCOMING',
      published: true,
      settings: {
        create: {
          banner: '',
          gameplayScoring: 'SCORE_V2',
          matchRules: json(DEFAULT_MATCH_RULES),
          socialLinks: [],
          importantDates: [],
          navigation: [{ href: '/', label: 'Home' }],
          footer: '',
          registrationPolicy: { minPlayers: 1, ineligible: 'REVIEW', countries: ['IT'] },
        },
      },
    },
  });
  const beatmapId = randomInt(1_800_000_000, 1_900_000_000);
  beatmaps.push(beatmapId);
  const metadata = {
    id: beatmapId,
    mode: 'osu',
    title: 'Map',
    artist: 'Fixture',
    mapper: 'Fixture',
    difficulty: 'Test',
    stars: 5,
    bpm: 180,
    length: 120,
    ar: 9,
    cs: 4,
    od: 8,
    hp: 6,
    cover: '',
    url: `https://osu.ppy.sh/beatmaps/${beatmapId}`,
  };
  await db.beatmap.create({ data: { id: beatmapId, mode: 'osu', metadata } });
  const stage = async (name: string, kind: string, position: number, extra: object = {}) => {
    const row = await db.tournamentStage.create({
      data: { tournamentId: slug, name, slug: name.toLowerCase(), kind, position, ...extra },
    });
    const pool = await db.mappool.create({ data: { tournamentId: slug, stageId: row.id } });
    const revision = await db.mappoolRevision.create({
      data: { tournamentId: slug, mappoolId: pool.id },
    });
    await db.mappoolSlot.create({
      data: {
        revisionId: revision.id,
        name: 'NM1',
        category: 'NM',
        categoryName: 'NM',
        color: '#ffffff',
        position: 0,
        beatmapId,
        metadata,
      },
    });
    await db.mappool.update({
      where: { id: pool.id },
      data: { state: 'PUBLISHED', publishedRevisionId: revision.id, draftRevisionId: revision.id },
    });
    return { id: row.id, revisionId: revision.id };
  };
  const policy = qualifierPolicySchema.parse({ method: 'RAW_SCORE' });
  const qualifiers = await stage('Qualifiers', 'QUALIFIERS', 0, { qualifierPolicy: json(policy) });
  const finals = await stage('Finals', 'ELIMINATION', 1);
  const teams = [];
  for (const [index, name] of names.entries()) {
    const osuId = randomInt(1_700_000_000, 1_790_000_000);
    participants.push(osuId);
    await db.participant.create({
      data: { osuId, username: name, avatarUrl: '', country: index === 11 ? 'FR' : 'IT' },
    });
    const team = await db.team.create({
      data: {
        tournamentId: slug,
        name,
        slug: `entrant-${index + 1}`,
        status: 'APPROVED',
        published: true,
        format: 'INDIVIDUAL',
      },
    });
    await db.teamMember.create({
      data: {
        tournamentId: slug,
        teamId: team.id,
        osuId,
        position: 0,
        captain: true,
        registrationRank: 1000 + index,
      },
    });
    teams.push({ id: team.id, name, osuId });
  }
  const lobby = await db.qualifierLobby.create({
    data: {
      tournamentId: slug,
      code: `${slug}-q`,
      stageId: qualifiers.id,
      poolRevisionId: qualifiers.revisionId,
      status: 'COMPLETED',
      rules: json(inheritedRules({ teamSize: 1, multiplierMode: 'NONE' }, 'SCORE_V2')),
      policy: json(policy),
      gameplayScoring: 'SCORE_V2',
      capacity: 16,
      participants: json(
        teams.map((team) => ({
          id: team.id,
          name: team.name,
          slug: team.name.toLowerCase().replace(' ', '-'),
          format: 'INDIVIDUAL',
          logoImageId: null,
          members: [
            {
              osuId: team.osuId,
              username: team.name,
              avatarUrl: '',
              captain: true,
              substitute: false,
            },
          ],
        })),
      ),
    },
  });
  await db.qualifierEntry.createMany({
    data: teams.map((team, position) => ({
      tournamentId: slug,
      lobbyId: lobby.id,
      teamId: team.id,
      position,
    })),
  });
  await db.qualifierScore.createMany({
    data: teams.map((team, index) => {
      const raw = 900000 - index * 1000;
      return {
        lobbyId: lobby.id,
        osuId: team.osuId,
        slotName: 'NM1',
        run: 1,
        raw,
        adjusted: raw,
        mods: ['NF'],
        actualScoring: 'SCORE_V2',
        representation: 'LEGACY',
        source: 'MANUAL',
        verified: true,
      };
    }),
  });
  return { qualifiers, finals };
}

const stages = { qualifiers: '', finals: '' };
async function adminAction(page: Page, body: object) {
  const result = await page.evaluate(
    async ({ scope, body }) => {
      const response = await fetch(`/api/admin/action?tournament=${scope}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { ok: response.ok, status: response.status, data: await response.json() };
    },
    { scope: slug, body },
  );
  expect(result.ok, JSON.stringify(result.data)).toBe(true);
  return result.data;
}
async function finalizeStandings(page: Page) {
  const read = () =>
    page.evaluate(
      async ({ scope, stageId }) =>
        (
          await fetch(
            `/api/admin/data?section=qualifier-standings&stageId=${stageId}&tournament=${scope}`,
          )
        ).json(),
      { scope: slug, stageId: stages.qualifiers },
    );
  let current = await read();
  await adminAction(page, {
    type: 'qualifier.standings.calculate',
    stageId: stages.qualifiers,
    baseVersion: current.latest?.version ?? 0,
    sourceHash: current.preview.sourceHash,
  });
  current = await read();
  await adminAction(page, {
    type: 'qualifier.standings.finalize',
    stageId: stages.qualifiers,
    baseVersion: current.latest.version,
    sourceHash: current.preview.sourceHash,
    tieOrder: [],
    reason: '',
    cutoff: 12,
  });
}
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true });
  const seeded = await seed();
  stages.qualifiers = seeded.qualifiers.id;
  stages.finals = seeded.finals.id;
  token = randomBytes(32).toString('base64url');
  const user = await db.user.create({
    data: {
      osuId: randomInt(1_790_000_000, 1_800_000_000),
      username: `formation-owner-${slug.slice(10, 18)}`,
      avatarUrl: '',
      profileUrl: '',
      platformAdmin: true,
      sessions: {
        create: {
          id: createHash('sha256').update(token).digest('hex'),
          expiresAt: new Date(Date.now() + 3600_000),
        },
      },
    },
  });
  users.push(user.id);
});

test.afterAll(async () => {
  const where = { tournamentId: slug };
  await db.tournamentPhase.updateMany({ where, data: { bracketId: null } });
  await db.bracketSlot.deleteMany({ where });
  await db.bracketNode.deleteMany({ where });
  await db.bracketRound.deleteMany({ where });
  await db.bracketEntry.deleteMany({ where });
  await db.bracket.deleteMany({ where });
  await db.match.deleteMany({ where });
  await db.qualifierStanding.deleteMany({ where });
  await db.qualifierLobby.deleteMany({ where });
  await db.formationSession.deleteMany({ where });
  await db.resourcePurchase.deleteMany({ where });
  await db.resourceAdjustment.deleteMany({ where });
  await db.resourceItem.deleteMany({ where });
  await db.tournamentPhase.deleteMany({ where });
  await db.mappool.updateMany({
    where,
    data: { publishedRevisionId: null, draftRevisionId: null },
  });
  await db.mappoolSlot.deleteMany({ where: { revision: where } });
  await db.mappoolRevision.deleteMany({ where });
  await db.mappool.deleteMany({ where });
  await db.tournamentStage.deleteMany({ where });
  await db.team.deleteMany({ where });
  await db.auditLog.deleteMany({ where });
  await db.role.deleteMany({ where });
  await db.tournament.deleteMany({ where: { id: slug } });
  await db.participant.deleteMany({ where: { osuId: { in: participants } } });
  await db.beatmap.deleteMany({ where: { id: { in: beatmaps } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

test('reviews eligibility with a decision beside each problem', async ({ page, context }) => {
  await login(context);
  await page.goto(`${root}#registration`);
  await openSection(page, 'Registration and eligibility');
  await expect(page.getByRole('heading', { name: 'Eligibility review' })).toBeVisible();
  const problem = page.getByText('Player 12 is not from an eligible country.');
  await expect(problem).toBeVisible();
  await page.screenshot({ path: `${evidence}/eligibility-review-1366.png` });
  const row = page.locator('li').filter({ has: problem }).last();
  await row.getByRole('textbox', { name: 'Why this is allowed' }).fill('Passed the interview');
  await row.getByRole('button', { name: 'Allow', exact: true }).click();
  await expect(problem).toBeHidden();
  await page.getByText('Allowed exceptions').click();
  await expect(page.getByText('Passed the interview')).toBeVisible();
  await expectNoOverflow(page);
  const audit = await db.auditLog.findFirst({
    where: { tournamentId: slug, action: 'eligibility.exception.grant' },
  });
  expect(JSON.stringify(audit?.details)).toContain('Passed the interview');
});

test('runs an auction from the workspace to confirmed teams', async ({ page, context }) => {
  await login(context);
  // Saved through the same setup the workspace uses: qualifiers, an auction, then a bracket.
  await db.tournamentPhase.createMany({
    data: [
      {
        tournamentId: slug,
        key: 'qualifiers',
        position: 0,
        kind: 'QUALIFIER',
        name: 'Qualifiers',
        stageId: stages.qualifiers,
        config: {
          kind: 'QUALIFIER',
          key: 'qualifiers',
          name: 'Qualifiers',
          stageId: stages.qualifiers,
          entrantUnit: 'INDIVIDUAL_PLAYER',
          advance: null,
        },
      },
      {
        tournamentId: slug,
        key: 'auction',
        position: 1,
        kind: 'TEAM_FORMATION',
        name: 'Captain auction',
        config: {
          kind: 'TEAM_FORMATION',
          key: 'auction',
          name: 'Captain auction',
          entries: [{ source: { kind: 'ALL', phase: 'qualifiers' }, seedFrom: 1 }],
          method: 'AUCTION',
          teamCount: 2,
          rosterSize: 3,
          captains: 'MANUAL',
          teamSeeding: 'AVERAGE_PLAYER_SEED',
          auction: { budget: 1000, minimumRaise: 100, lotOrder: 'SEED', reserveFillPrice: 200 },
        },
      },
      {
        tournamentId: slug,
        key: 'main',
        position: 2,
        kind: 'SINGLE_ELIMINATION',
        name: 'Main bracket',
        stageId: stages.finals,
        config: {
          kind: 'SINGLE_ELIMINATION',
          key: 'main',
          name: 'Main bracket',
          stageId: stages.finals,
          entries: [{ source: { kind: 'ALL', phase: 'auction' }, seedFrom: 1 }],
          size: 2,
        },
      },
    ],
  });
  await page.goto(`${root}#format`);
  await openSection(page, 'Phases and progression');
  await confirm(page, 'Lock format');
  await expect(page.getByRole('button', { name: 'Unlock format' })).toBeVisible();
  // Finalize the standings the board reads, through the same action the qualifier page sends.
  await finalizeStandings(page);
  await page.reload();
  await openSection(page, 'Phases and progression');

  const board = page.getByRole('region', { name: 'Phases' });
  await expect(board.getByText('Choose 2 captains (0 chosen)')).toBeVisible();
  await board.getByRole('checkbox', { name: /Player 1 / }).check();
  await board.getByRole('checkbox', { name: /Player 2 / }).check();
  await page.screenshot({ path: `${evidence}/formation-start-1366.png`, fullPage: true });
  await confirm(page, 'Start team formation', 'Confirm');

  // The board offers the best seed first and holds each sale to the rules.
  await expect(board.getByText('Now offering')).toBeVisible();
  const decision = board.locator('form').filter({ has: page.getByLabel('Winning price') });
  await expect(decision.getByText('Player 3', { exact: true })).toBeVisible();
  await decision.getByLabel('Team').selectOption({ label: 'Team Player 1' });
  await decision.getByLabel('Winning price').fill('2000');
  await decision.getByRole('button', { name: 'Sold', exact: true }).click();
  await expect(page.getByText('This team cannot afford that price.')).toBeVisible();
  await decision.getByLabel('Winning price').fill('600');
  await decision.getByRole('button', { name: 'Sold', exact: true }).click();
  await expect(decision.getByText('Player 4', { exact: true })).toBeVisible();
  await expect(board.getByText('1 seat left · 400 left')).toBeVisible();
  await page.screenshot({ path: `${evidence}/formation-board-1366.png`, fullPage: true });

  // A second operator's view stays read-only for the public, without the draw order.
  const viewer = await context.newPage();
  await viewer.goto(`/t/${slug}/team-formation`);
  await expect(viewer.getByRole('heading', { name: 'Team formation' })).toBeVisible();
  await expect(viewer.getByText('Now offering')).toBeVisible();
  await expect(viewer.getByText('Player 4', { exact: true }).first()).toBeVisible();
  await viewer.screenshot({ path: `${evidence}/formation-public-1366.png`, fullPage: true });
  await expectNoOverflow(viewer);

  // Pasted bot results go through the same checks, and only apply when all of them pass.
  await board.getByText('Paste results from a bot').click();
  const paste = board.getByRole('textbox', { name: 'One player per line' });
  await paste.fill('Player 4, Team Player 2, 100\nPlayer 5 - unsold\nNobody, Team Player 2, 100');
  await board.getByRole('button', { name: 'Check lines' }).click();
  await expect(board.getByText('No player on this board matches this line.')).toBeVisible();
  await expect(board.getByRole('button', { name: 'Apply 3 lines' })).toBeDisabled();
  await paste.fill('Player 4, Team Player 2, 100\nPlayer 5 - unsold');
  await board.getByRole('button', { name: 'Check lines' }).click();
  await board.getByRole('button', { name: 'Apply 2 lines' }).click();
  await expect(decision.getByText('Player 6', { exact: true })).toBeVisible();

  // The live page catches up without anyone reloading it.
  await expect(viewer.getByText('Player 6', { exact: true }).first()).toBeVisible({
    timeout: 15000,
  });
  await viewer.close();

  // Everyone else gets no bids, then the seats that remain fill from the reserves.
  for (let remaining = 7; remaining >= 0; remaining--) {
    const bids = decision.getByRole('button', { name: 'No bids', exact: true });
    if (!(await bids.isVisible())) break;
    await bids.click();
    await expect(
      board.getByText(/Every player has been offered|Now offering/).first(),
    ).toBeVisible();
    await page.waitForTimeout(150);
  }
  await expect(board.getByText('Fill 2 open seats from the reserves')).toBeVisible();
  await board.getByRole('button', { name: 'Fill from reserves' }).click();
  await expect(board.getByText('Fill 2 open seats')).toBeHidden();

  await board.getByLabel('Team name').first().fill('The Bombers');
  await board.getByLabel('Team name').first().blur();
  await expect(page.getByText('Team renamed.')).toBeVisible();

  await confirm(page, 'Confirm teams', 'Confirm');
  await expect(board.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible();
  const formed = await db.team.findMany({
    where: { tournamentId: slug, format: 'TEAM' },
    include: { members: true },
  });
  expect(formed).toHaveLength(2);
  expect(formed.every((team) => team.members.length === 3)).toBe(true);
  expect(formed.map((team) => team.name)).toContain('The Bombers');
  const session = await db.formationSession.findFirstOrThrow({ where: { tournamentId: slug } });
  expect(session.state).toBe('CONFIRMED');
});

test('tracks budgets through purchases, corrections and the public page', async ({
  page,
  context,
}) => {
  await login(context);
  await page.goto(`${root}#resources`);
  await openSection(page, 'Budgets and items');
  await page.getByLabel('Teams have a budget they can spend on items').check();
  await page.getByLabel('Earned per map won').fill('200');
  await page.getByRole('button', { name: 'Save budget rules' }).click();
  await expect(page.getByText('Budget rules saved.')).toBeVisible();

  const newItem = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Add item' }) });
  await newItem.getByLabel('Item', { exact: true }).fill('Extra ban');
  await newItem.getByLabel('Price').fill('100');
  await newItem.getByLabel('What it does').fill('One extra ban, applied by the referee');
  await newItem.getByLabel('Revealed').check();
  await newItem.getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByText('Item saved.')).toBeVisible();

  const team = page.locator('details').filter({ hasText: 'The Bombers' });
  await team.locator('summary').click();
  await team.getByLabel('Item to buy').selectOption({ label: 'Extra ban ($ 100)' });
  await team.getByRole('button', { name: 'Record purchase' }).click();
  await expect(page.getByText('Purchase recorded.')).toBeVisible();
  await team.getByRole('textbox', { name: 'Why this purchase is reversed' }).fill('Wrong team');
  await team.getByRole('button', { name: 'Reverse', exact: true }).click();
  await expect(page.getByText('Purchase reversed.')).toBeVisible();
  await team.getByLabel('Adjust balance by').fill('-50');
  await team.getByLabel('Why', { exact: true }).fill('Host ruling');
  await team.getByRole('button', { name: 'Adjust', exact: true }).click();
  await expect(page.getByText('Balance adjusted.')).toBeVisible();
  await expect(team.getByText('-50 · Host ruling')).toBeVisible();
  await page.screenshot({ path: `${evidence}/budgets-1366.png`, fullPage: true });
  await expectNoOverflow(page);

  await page.goto(`/t/${slug}/team-formation`);
  await expect(page.getByRole('heading', { name: 'Team balances' })).toBeVisible();
  await expect(page.getByText('These teams are final.')).toBeVisible();
  await expect(page.getByText('Extra ban', { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Host ruling');
  await expect(page.locator('body')).not.toContainText('Wrong team');
});

test('stays usable at every width in both appearances', async ({ page, context }) => {
  for (const [width, height] of [
    [1920, 1080],
    [1366, 900],
    [768, 900],
    [390, 844],
    [320, 700],
  ] as const) {
    for (const appearance of ['light', 'dark']) {
      await context.clearCookies();
      await login(context, 'en', appearance);
      await page.setViewportSize({ width, height });
      await page.goto('about:blank');
      await page.goto(`/t/${slug}/team-formation`);
      await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance);
      await expect(page.getByRole('heading', { name: 'Team formation' })).toBeVisible();
      await expectNoOverflow(page);
      await page.screenshot({
        path: `${evidence}/formation-public-${appearance}-${width}.png`,
        fullPage: true,
      });
      await page.goto('about:blank');
      await page.goto(`${root}#format`);
      await expect(page.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible();
      await expectNoOverflow(page);
      await page.screenshot({
        path: `${evidence}/formation-admin-${appearance}-${width}.png`,
        fullPage: true,
      });
    }
  }
  await context.clearCookies();
  await login(context, 'it');
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('about:blank');
  await page.goto(`/t/${slug}/team-formation`);
  await expect(page.getByRole('heading', { name: 'Formazione delle squadre' })).toBeVisible();
  await page.screenshot({ path: `${evidence}/formation-public-italian-1366.png` });
});
