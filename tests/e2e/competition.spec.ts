import {
  test as base,
  expect,
  type APIResponse,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Prisma } from '../../src/generated/prisma/client';
import { PrismaClient } from '../../src/generated/prisma/client';
import type {
  CompetitionData,
  CompetitionGenerationPreview,
} from '../../src/lib/competition-types';
import type { CompetitionCreate } from '../../src/lib/competition-validation';
import { matchRulesSchema } from '../../src/lib/match-rules';
import type { MatchListData } from '../../src/lib/matches-types';
import type { QualifierStandingsData } from '../../src/lib/qualifier-standings-contract';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/tournament_platform_test')
  throw new Error('Competition E2E fixtures require tournament_platform_test.');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const rules = matchRulesSchema.parse({
  bestOf: 1,
  teamSize: 1,
  teamMode: 'HEAD_TO_HEAD',
  bansPerTeam: 0,
  protectsPerTeam: 0,
  rollRequired: false,
  firstBanRule: 'RED',
  firstPickRule: 'RED',
  firstProtectRule: 'RED',
  enableTiebreaker: false,
  freeModRequiredHD: 0,
  freeModRequiredHR: 0,
  multiplierMode: 'NONE',
});
type Revision = { id: string; version: number };
type Entrant = { id: string; name: string; osuId: number };
type CompetitionFixture = {
  id: string;
  slug: string;
  root: string;
  ownerId: string;
  stageId: string;
  entrants: Entrant[];
  post: <T = Revision>(data: Record<string, unknown>) => Promise<T>;
  request: (data: Record<string, unknown>) => Promise<APIResponse>;
  data: <T>(section: string) => Promise<T>;
};

async function json<T>(response: Pick<APIResponse, 'text' | 'ok' | 'url' | 'status'>): Promise<T> {
  const body = await response.text();
  expect(response.ok(), `${response.url()}: ${response.status()} ${body}`).toBe(true);
  return JSON.parse(body) as T;
}

async function publishPool(tournamentId: string, stageId: string, beatmaps: number[]) {
  const pool = await db.mappool.upsert({
    where: { stageId },
    create: { tournamentId, stageId },
    update: {},
  });
  const slots = [];
  for (const [position, beatmapId] of beatmaps.entries()) {
    const beatmap = await db.beatmap.findUniqueOrThrow({ where: { id: beatmapId } });
    slots.push({
      name: `NM${position + 1}`,
      category: 'NM',
      categoryName: 'No Mod',
      color: '#90bdf4',
      position,
      beatmapId,
      metadata: beatmap.metadata as Prisma.InputJsonValue,
    });
  }
  const revision = await db.mappoolRevision.create({
    data: { tournamentId, mappoolId: pool.id, slots: { create: slots } },
  });
  await db.mappool.update({
    where: { id: pool.id },
    data: { state: 'PUBLISHED', draftRevisionId: revision.id, publishedRevisionId: revision.id },
  });
}

const test = base.extend<{ competition: CompetitionFixture }>({
  competition: async ({ context, baseURL }, use) => {
    const origin = new URL(baseURL!).origin;
    const slug = `competition-e2e-${randomUUID()}`;
    const osuBase = randomInt(1_100_000_000, 1_500_000_000);
    const token = randomBytes(32).toString('base64url');
    let ownerId = '';
    const participantIds: number[] = [],
      beatmapIds: number[] = [];
    try {
      const owner = await db.user.create({
        data: {
          osuId: osuBase,
          username: slug,
          avatarUrl: '/test-image.webp',
          profileUrl: `https://osu.ppy.sh/users/${osuBase}`,
          platformAdmin: true,
          sessions: {
            create: {
              id: createHash('sha256').update(token).digest('hex'),
              expiresAt: new Date(Date.now() + 3_600_000),
            },
          },
        },
      });
      ownerId = owner.id;
      await context.addCookies([
        {
          name: origin.startsWith('https:') ? '__Host-tournament_session' : 'tournament_session',
          value: token,
          url: origin,
          httpOnly: true,
          sameSite: 'Lax',
          secure: origin.startsWith('https:'),
        },
      ]);
      const { id } = await json<{ id: string }>(
        await context.request.post('/api/tournaments', {
          headers: { Origin: origin },
          data: {
            type: 'create',
            name: slug,
            slug,
            acronym: 'COMP',
            gameMode: 'osu',
            format: 'SOLO',
            gameplayScoring: 'SCORE_V2',
          },
        }),
      );
      const membership = await db.userRole.findFirstOrThrow({
        where: { userId: ownerId, tournamentId: id, role: { templateKey: 'Owner' } },
      });
      expect(membership.tournamentId).toBe(id);
      // Only tournament bootstrap uses platform access; competition exercises the real scoped role.
      await db.user.update({ where: { id: ownerId }, data: { platformAdmin: false } });
      await json(
        await context.request.post('/api/tournaments', {
          headers: { Origin: origin },
          data: { type: 'lifecycle', id, baseVersion: 1, published: true, archived: false },
        }),
      );
      await db.tournamentSettings.update({
        where: { tournamentId: id },
        data: { matchRules: rules, primaryColor: '#d64783', accentColor: '#278d79' },
      });
      const entrants: Entrant[] = [];
      for (let index = 1; index <= 8; index++) {
        const osuId = osuBase + index,
          name = `Competition seed ${index}`;
        await db.participant.create({
          data: { osuId, username: name, avatarUrl: '/test-image.webp' },
        });
        participantIds.push(osuId);
        const team = await db.team.create({
          data: {
            tournamentId: id,
            name,
            slug: `seed-${index}`,
            seed: index,
            format: 'INDIVIDUAL',
            status: 'APPROVED',
            published: true,
            members: { create: { osuId, captain: true, position: 0 } },
          },
        });
        entrants.push({ id: team.id, name, osuId });
      }
      for (let index = 1; index <= 2; index++) {
        const beatmapId = osuBase + 20 + index;
        await db.beatmap.create({
          data: {
            id: beatmapId,
            mode: 'osu',
            metadata: {
              id: beatmapId,
              mode: 'osu',
              title: `Competition NM${index}`,
              artist: 'E2E fixture',
              mapper: 'E2E fixture',
              difficulty: 'Regression',
              stars: 5,
              bpm: 180,
              length: 120,
              ar: 9,
              cs: 4,
              od: 8,
              hp: 6,
              cover: '/test-image.webp',
              url: `https://osu.ppy.sh/beatmaps/${beatmapId}`,
            },
          },
        });
        beatmapIds.push(beatmapId);
      }
      const stage = await db.tournamentStage.create({
        data: { tournamentId: id, name: 'Elimination', slug: 'elimination', kind: 'ELIMINATION' },
      });
      await publishPool(id, stage.id, beatmapIds);
      const request = (data: Record<string, unknown>) =>
        context.request.post(`/api/admin/action?tournament=${slug}`, {
          headers: { Origin: origin },
          data,
        });
      await use({
        id,
        slug,
        root: `/t/${slug}`,
        ownerId,
        stageId: stage.id,
        entrants,
        request,
        post: async <T>(data: Record<string, unknown>) => json<T>(await request(data)),
        data: async <T>(section: string) =>
          json<T>(
            await context.request.get(`/api/admin/data?tournament=${slug}&section=${section}`),
          ),
      });
    } finally {
      // Delete only this fixture's records, in FK order (including cross-node progression slots).
      for (const tournament of await db.tournament.findMany({ where: { slug } })) {
        const where = { tournamentId: tournament.id };
        await db.$transaction(
          async (tx) => {
            await tx.bracketSlot.deleteMany({ where });
            await tx.bracketNode.deleteMany({ where });
            await tx.bracketRound.deleteMany({ where });
            await tx.bracketEntry.deleteMany({ where });
            await tx.bracket.deleteMany({ where });
            await tx.match.deleteMany({ where });
            await tx.poolCandidate.deleteMany({ where });
            await tx.qualifierStanding.deleteMany({ where });
            await tx.qualifierLobby.deleteMany({ where });
            await tx.mappool.updateMany({
              where,
              data: { draftRevisionId: null, publishedRevisionId: null },
            });
            await tx.tournamentStage.updateMany({ where, data: { nextStageId: null } });
            await tx.tournamentStage.deleteMany({ where });
            await tx.team.deleteMany({ where });
            await tx.page.updateMany({
              where,
              data: { draftRevisionId: null, publishedRevisionId: null },
            });
            await tx.auditLog.deleteMany({ where });
            await tx.staffMember.deleteMany({ where });
            await tx.staffCategory.deleteMany({ where });
            await tx.role.deleteMany({ where });
            await tx.tournament.delete({ where: { id: tournament.id } });
          },
          { timeout: 30_000 },
        );
      }
      await db.participant.deleteMany({ where: { osuId: { in: participantIds } } });
      await db.beatmap.deleteMany({ where: { id: { in: beatmapIds } } });
      if (ownerId) {
        await db.rateLimit.deleteMany({
          where: { key: { in: [`write:${ownerId}`, `tournaments:${ownerId}`] } },
        });
        await db.user.deleteMany({ where: { id: ownerId } });
      }
    }
  },
});
test.afterAll(() => db.$disconnect());

async function uiAction<T = Revision>(page: Page, type: string, click: () => Promise<unknown>) {
  const response = page.waitForResponse(
    (response) =>
      response.url().includes('/api/admin/action') &&
      response.request().method() === 'POST' &&
      response.request().postDataJSON()?.type === type,
  );
  await click();
  return json<T>(await response);
}
function bracketInput(
  f: CompetitionFixture,
  name: string,
  extra: Partial<CompetitionCreate> = {},
): CompetitionCreate {
  return {
    type: 'competition.create',
    name,
    stageId: f.stageId,
    teamIds: f.entrants.map((e) => e.id),
    generationKey: randomUUID(),
    format: 'SINGLE_ELIMINATION',
    thirdPlace: false,
    grandFinalReset: true,
    byePlacement: 'BALANCED',
    groupCount: 1,
    advancePerGroup: 2,
    roundStages: {},
    manualMatches: false,
    ...extra,
  };
}
async function bracket(id: string) {
  return db.bracket.findUniqueOrThrow({
    where: { id },
    include: {
      rounds: { orderBy: { position: 'asc' } },
      entries: { orderBy: { seed: 'asc' } },
      nodes: {
        include: { slots: { orderBy: { side: 'asc' } }, match: true },
        orderBy: { key: 'asc' },
      },
    },
  });
}
async function matchAction(f: CompetitionFixture, id: string, type: string, fields = {}) {
  const match = await db.match.findUniqueOrThrow({ where: { id, tournamentId: f.id } });
  return f.post({ type, id, baseVersion: match.version, ...fields });
}
async function playToSubmission(f: CompetitionFixture, id: string, winner: 'A' | 'B' = 'A') {
  await matchAction(f, id, 'match.start');
  await matchAction(f, id, 'match.draft', { kind: 'PICK', side: 'A', slotName: 'NM1' });
  const action = await db.matchMapAction.findFirstOrThrow({
    where: { matchId: id, kind: 'PICK', voided: false },
  });
  const match = await db.match.findUniqueOrThrow({ where: { id } });
  expect(match.rules).toMatchObject({
    bestOf: 1,
    gameplayScoring: 'SCORE_V2',
    scoreMode: 'SCORE_V2',
    rollRequired: false,
  });
  const players = [match.teamAId, match.teamBId].map((teamId, index) => ({
    osuId: f.entrants.find((e) => e.id === teamId)!.osuId,
    side: index === 0 ? 'A' : 'B',
    score: (index === 0 ? winner === 'A' : winner === 'B') ? 900_000 : 700_000,
    mods: ['NF'],
  }));
  await matchAction(f, id, 'match.score', {
    actionId: action.id,
    scoreA: players[0].score,
    scoreB: players[1].score,
    representation: 'LEGACY',
    players,
    reason: 'Verified isolated E2E map scores',
  });
  await matchAction(f, id, 'match.submit', { notes: 'E2E referee result review' });
  return db.match.findUniqueOrThrow({ where: { id } });
}
async function confirm(f: CompetitionFixture, id: string) {
  await matchAction(f, id, 'match.confirm', { reason: 'Organizer confirmed verified E2E result' });
}
async function finish(
  f: CompetitionFixture,
  bracketId: string,
  mode: 'RED_WINS' | 'RESET_FINAL' | 'SEED_WINS' = 'RED_WINS',
) {
  let completed = 0;
  while (true) {
    const current = await bracket(bracketId);
    const node = current.nodes.find((n) => n.state === 'READY' && n.match?.status === 'SCHEDULED');
    if (!node) return completed;
    expect(++completed, 'Competition must reach a terminal state').toBeLessThanOrEqual(20);
    const round = current.rounds.find((r) => r.id === node.roundId)!;
    const redSeed = f.entrants.findIndex((e) => e.id === node.match!.teamAId);
    const blueSeed = f.entrants.findIndex((e) => e.id === node.match!.teamBId);
    const winner =
      mode === 'SEED_WINS'
        ? redSeed < blueSeed
          ? 'A'
          : 'B'
        : mode === 'RESET_FINAL' && round.key === 'g3-r1'
          ? 'B'
          : 'A';
    await playToSubmission(f, node.matchId!, winner);
    await confirm(f, node.matchId!);
  }
}
async function openBracket(page: Page, f: CompetitionFixture, bracketId?: string) {
  await page.goto(`${f.root}/admin/matches`);
  await page
    .getByRole('group', { name: 'Match view' })
    .getByRole('button', { name: 'Bracket', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Create bracket', exact: true })).toBeVisible();
  if (bracketId)
    await page.getByLabel('Competition bracket', { exact: true }).selectOption(bracketId);
}
async function generateInUI(page: Page, f: CompetitionFixture, name: string, standingId?: string) {
  await openBracket(page, f);
  await page.getByRole('button', { name: 'Create bracket', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create bracket', exact: true });
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel('Gameplay stage', { exact: true }).selectOption(f.stageId);
  if (standingId) {
    await dialog.getByLabel('Seed source', { exact: true }).selectOption(standingId);
    await dialog.getByLabel('Advancing participants', { exact: true }).fill('4');
  }
  const preview = await uiAction<{ rounds: unknown[]; nodes: unknown[] }>(
    page,
    'competition.preview',
    () => dialog.getByRole('button', { name: 'Preview bracket', exact: true }).click(),
  );
  expect(preview.rounds).toHaveLength(standingId ? 2 : 3);
  expect(preview.nodes).toHaveLength(standingId ? 3 : 7);
  expect(await db.bracket.count({ where: { tournamentId: f.id } })).toBe(0);
  expect(await db.match.count({ where: { tournamentId: f.id } })).toBe(0);
  const result = await uiAction(page, 'competition.create', () =>
    dialog.getByRole('button', { name: 'Generate bracket', exact: true }).click(),
  );
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Competition bracket', { exact: true })).toHaveValue(result.id);
  return bracket(result.id);
}
async function publishInUI(page: Page) {
  await uiAction(page, 'competition.publish', () =>
    page.getByRole('button', { name: 'Publish bracket', exact: true }).click(),
  );
  await expect(page.getByRole('button', { name: 'Unpublish bracket', exact: true })).toBeVisible();
}
async function screenshotLayouts(
  page: Page,
  context: BrowserContext,
  testInfo: TestInfo,
  label: string,
  region: Locator,
  scrollableTables = false,
) {
  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([
      { name: 'portal_appearance', value: theme, url: new URL(page.url()).origin },
    ]);
    await page.getByRole('button', { name: 'Appearance', exact: true }).first().click();
    await page
      .getByRole('menuitemradio', { name: theme === 'light' ? 'Light' : 'Dark', exact: true })
      .click();
    await expect(page.locator('html')).toHaveAttribute('data-appearance', theme);
    for (const width of [1366, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1366 ? 900 : 844 });
      await expect(region).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const canvas = region.getByLabel('Bracket canvas', { exact: true });
      if (await canvas.count()) {
        if (width === 1366) await expect(canvas).toBeVisible();
        else {
          await expect(canvas).toBeHidden();
          const round = region.getByLabel('Bracket round', { exact: true });
          const before = await round.inputValue();
          await region.getByRole('button', { name: 'Next round', exact: true }).click();
          await expect(round).not.toHaveValue(before);
          await region.getByRole('button', { name: 'Previous round', exact: true }).click();
          await expect(round).toHaveValue(before);
        }
      }
      const screenshotPath = testInfo.outputPath(`${label}-${theme}-${width}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });
      await testInfo.attach(`${label}-${theme}-${width}`, {
        path: screenshotPath,
        contentType: 'image/png',
      });
      const layout = await page.evaluate(() => ({
        viewport: innerWidth,
        html: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }));
      expect(layout.html, `${label} ${theme} ${width}: document overflow`).toBeLessThanOrEqual(
        layout.viewport,
      );
      expect(layout.body, `${label} ${theme} ${width}: body overflow`).toBeLessThanOrEqual(
        layout.viewport,
      );
      for (const select of await region.getByRole('combobox').all()) {
        if (scrollableTables) continue;
        if (!(await select.isVisible())) continue;
        const rect = await select.boundingBox();
        expect(rect!.width).toBeGreaterThan(0);
        expect(rect!.x).toBeGreaterThanOrEqual(-1);
        expect(rect!.x + rect!.width).toBeLessThanOrEqual(width + 1);
      }
    }
  }
  await page.setViewportSize({ width: 1366, height: 900 });
}

test('bulk stage rules, persistent empty pool plans and suggestion reviews work through the organizer UI', async ({
  page,
  context,
  competition: f,
}, testInfo) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const later = await f.post({
    type: 'stage.save',
    name: 'Later round',
    slug: 'later',
    description: '',
    position: 1,
    startsAt: null,
    kind: 'ELIMINATION',
    matchRules: null,
  });
  await page.goto(`${f.root}/admin/mappools?view=stages`);
  await page.getByRole('checkbox', { name: 'Select Elimination', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Select Later round', exact: true }).check();
  await page
    .getByRole('region', { name: 'Bulk stage editing' })
    .getByRole('combobox', { name: 'Best of', exact: true })
    .selectOption('3');
  await uiAction(page, 'stage.rules.patch', () =>
    page.getByRole('button', { name: 'Apply to 2 stages', exact: true }).click(),
  );
  expect(
    (await db.tournamentStage.findUniqueOrThrow({ where: { id: later.id } })).matchRules,
  ).toMatchObject({ bestOf: 3 });
  await screenshotLayouts(page, context, testInfo, 'stage-bulk', page.getByRole('main'), true);
  await page.goto(`${f.root}/admin/mappools?stage=${later.id}`);
  await page.getByRole('button', { name: 'Build slot plan', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('NM · NM', { exact: true }).fill('2');
  await dialog.getByRole('button', { name: 'Create slots', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await uiAction(page, 'pool.save', () =>
    page.getByRole('button', { name: 'Save draft', exact: true }).click(),
  );
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
  await page.reload();
  expect((await db.poolPlan.findUniqueOrThrow({ where: { stageId: later.id } })).slots).toEqual([
    { name: 'NM1', category: 'NM' },
    { name: 'NM2', category: 'NM' },
  ]);
  const currentPool = await db.mappool.findUniqueOrThrow({
    where: { stageId: f.stageId },
    include: { publishedRevision: { include: { slots: true } } },
  });
  const map = currentPool.publishedRevision!.slots[0];
  await page.goto(`${f.root}/admin/mappools?view=pooling`);
  await page.getByRole('button', { name: 'Suggest maps', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Beatmap IDs or URLs', { exact: true })
    .fill(`https://osu.ppy.sh/beatmaps/${map.beatmapId}`);
  await dialog.getByLabel('Suggested stage', { exact: true }).selectOption(later.id);
  await dialog.getByLabel('Mod category', { exact: true }).selectOption('NM');
  await dialog.getByRole('button', { name: 'Preview suggestions', exact: true }).click();
  await expect(
    dialog.getByText('1 new · 0 already suggested · 0 unavailable', { exact: true }),
  ).toBeVisible();
  await uiAction(page, 'pooling.suggest', () =>
    dialog.getByRole('button', { name: 'Submit 1 suggestions', exact: true }).click(),
  );
  await expect(dialog).toHaveCount(0);
  await uiAction(page, 'pooling.bulk', () =>
    page.getByLabel('Status for Competition NM1', { exact: true }).selectOption('ACCEPTED'),
  );
  await page.getByRole('button', { name: 'Review Competition NM1', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Pool fit', { exact: true }).selectOption('4');
  await dialog.getByLabel('Difficulty', { exact: true }).selectOption('3');
  await dialog
    .getByLabel('Feedback / suggested replacements', { exact: true })
    .fill('Verified through the organizer browser workflow.');
  await uiAction(page, 'pooling.review.save', () =>
    dialog.getByRole('button', { name: 'Save completed review', exact: true }).click(),
  );
  await expect(dialog).toHaveCount(0);
  await page.goto(`${f.root}/admin/mappools?stage=${later.id}`);
  await page.getByRole('button', { name: 'Suggestions', exact: true }).click();
  const suggestions = page.getByRole('region', { name: 'Mappool suggestions', exact: true });
  await suggestions.getByLabel('Search suggestions', { exact: true }).fill('not-a-suggested-map');
  await expect(
    suggestions.getByText('No suggestions match this view.', { exact: true }),
  ).toBeVisible();
  await suggestions.getByLabel('Search suggestions', { exact: true }).fill('Competition NM1');
  await suggestions.getByLabel('Category', { exact: true }).selectOption('NM');
  await suggestions.getByLabel('Suggestion status', { exact: true }).selectOption('ACCEPTED');
  await suggestions.getByRole('button').filter({ hasText: 'Competition NM1' }).click();
  await expect(
    suggestions.getByText('Verified through the organizer browser workflow.', { exact: false }),
  ).toBeVisible();
  await page.locator('summary').filter({ hasText: 'Mappool notes' }).click();
  await page
    .getByLabel('Mappool notes', { exact: true })
    .fill('Keep these edits while assigning a suggestion.');
  await uiAction(page, 'pooling.select', () =>
    suggestions.getByRole('button', { name: 'Assign to NM1', exact: true }).click(),
  );
  await suggestions.getByLabel('Suggestion status', { exact: true }).selectOption('SELECTED');
  await expect(
    suggestions.getByRole('button').filter({ hasText: 'Competition NM1' }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/admin/mappools\\?stage=${later.id}$`));
  const candidate = await db.poolCandidate.findFirstOrThrow({
    where: { tournamentId: f.id },
    include: { reviews: true },
  });
  expect(candidate.reviews[0].notes).toContain('browser workflow');
  const destination = await db.mappool.findUniqueOrThrow({
    where: { stageId: later.id },
    include: { draftRevision: { include: { slots: true } } },
  });
  expect(destination.publishedRevisionId).toBeNull();
  expect(destination.draftRevision!.slots).toHaveLength(1);
  expect(destination.draftRevision!.notes).toBe('Keep these edits while assigning a suggestion.');
  expect(
    (await db.mappool.findUniqueOrThrow({ where: { id: currentPool.id } })).publishedRevisionId,
  ).toBe(currentPool.publishedRevisionId);
  await screenshotLayouts(page, context, testInfo, 'pooling-reviews', page.getByRole('main'), true);
  expect(errors).toEqual([]);
});

test('an existing completed match can be linked with reversed bracket sides and its history intact', async ({
  page,
  competition: f,
}) => {
  const existing = await f.post({
    type: 'match.create',
    code: '1',
    stageId: f.stageId,
    teamAId: f.entrants[1].id,
    teamBId: f.entrants[0].id,
    refereeIds: [],
    notes: '',
  });
  await playToSubmission(f, existing.id);
  await confirm(f, existing.id);
  const before = await db.match.findUniqueOrThrow({ where: { id: existing.id } });
  const history = await db.matchMapAction.count({ where: { matchId: existing.id } });
  const created = await f.post(
    bracketInput(f, 'Historical bracket', {
      manualMatches: true,
      teamIds: f.entrants.slice(0, 2).map((entrant) => entrant.id),
    }),
  );
  const initial = await bracket(created.id),
    node = initial.nodes.find((item) => item.state === 'READY')!;
  expect(initial.nodes.every((item) => !item.matchId && item.matchNumber === null)).toBe(true);
  await openBracket(page, f, created.id);
  await page
    .getByLabel('Bracket canvas', { exact: true })
    .getByRole('button', { name: node.key, exact: true })
    .click();
  const dialog = page.getByRole('complementary', { name: 'Bracket match editor', exact: true });
  await dialog.getByLabel('Existing match', { exact: true }).selectOption(existing.id);
  await expect(dialog.getByText('Bracket sides will be swapped', { exact: false })).toBeVisible();
  await uiAction(page, 'competition.link-match', () =>
    dialog.getByRole('button', { name: 'Link existing match', exact: true }).click(),
  );
  await expect(dialog.getByRole('tab', { name: 'Match', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const linked = await db.bracketNode.findUniqueOrThrow({ where: { id: node.id } });
  expect(linked.matchId).toBe(before.id);
  expect(linked.matchNumber).toBe(before.matchNumber);
  expect(await db.match.findUniqueOrThrow({ where: { id: before.id } })).toMatchObject({
    version: before.version,
    scoreA: before.scoreA,
    scoreB: before.scoreB,
    lobbyUrl: before.lobbyUrl,
  });
  expect(await db.matchMapAction.count({ where: { matchId: before.id } })).toBe(history);
  expect(await db.match.count({ where: { tournamentId: f.id } })).toBe(1);
});

test('bulk pool releases preserve revisions and audit responses never expose draft payloads', async ({
  page,
  competition: f,
}) => {
  const pool = await db.mappool.findUniqueOrThrow({
    where: { stageId: f.stageId },
    include: { draftRevision: { include: { slots: true } } },
  });
  const draft = await f.post<{ revisionId: string }>({
    type: 'pool.save',
    id: pool.id,
    baseRevisionId: pool.draftRevisionId,
    notes: 'Private pooling note',
    slots: pool.draftRevision!.slots.map(({ name, category, beatmapId }) => ({
      name,
      category,
      beatmapId,
    })),
  });
  await page.goto(`${f.root}/admin/mappools`);
  await page.getByRole('button', { name: 'Pool releases', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Pool releases', exact: true });
  await dialog.getByRole('checkbox', { name: 'Release Elimination', exact: true }).check();
  await uiAction(page, 'pooling.pools.release', () =>
    dialog.getByRole('button', { name: 'Publish 1 pools', exact: true }).click(),
  );
  await expect(dialog).toHaveCount(0);
  expect((await db.mappool.findUniqueOrThrow({ where: { id: pool.id } })).publishedRevisionId).toBe(
    draft.revisionId,
  );
  await page.getByRole('button', { name: 'Pool releases', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Pool releases', exact: true });
  await dialog.getByLabel('Release action', { exact: true }).selectOption('UNPUBLISH');
  await dialog.getByRole('checkbox', { name: 'Release Elimination', exact: true }).check();
  await uiAction(page, 'pooling.pools.release', () =>
    dialog.getByRole('button', { name: 'Unpublish 1 pools', exact: true }).click(),
  );
  await expect(dialog).toHaveCount(0);
  expect(await db.mappool.findUniqueOrThrow({ where: { id: pool.id } })).toMatchObject({
    state: 'UNPUBLISHED',
    publishedRevisionId: null,
    draftRevisionId: draft.revisionId,
  });
  const audit = await f.data<Record<string, unknown>[]>('audit');
  expect(audit.length).toBeGreaterThan(0);
  expect(audit.every((entry) => !('details' in entry))).toBe(true);
  expect(
    await db.auditLog.count({ where: { tournamentId: f.id, action: 'pooling.pools.release' } }),
  ).toBe(2);
});

test('bulk qualifier sessions inherit stage policy and support scheduling and entrant transfers', async ({
  page,
  context,
  competition: f,
}, testInfo) => {
  page.setDefaultTimeout(15000);
  const stage = await f.post({
    type: 'stage.save',
    name: 'Qualifiers',
    slug: 'qualifiers',
    kind: 'QUALIFIERS',
    description: '',
    position: 1,
    startsAt: null,
    matchRules: null,
    qualifierPolicy: {
      runs: 2,
      runSelection: 'BEST_COMPLETE_RUN',
      method: 'RAW_SCORE',
      requiredPlayers: 1,
    },
  });
  const maps = await db.mappoolSlot.findMany({
    where: { revision: { mappool: { stageId: f.stageId } } },
    take: 2,
  });
  await publishPool(
    f.id,
    stage.id,
    maps.map((map) => map.beatmapId),
  );
  await page.goto(`${f.root}/admin/referee/qualifiers`);
  await page.getByRole('button', { name: 'Create several sessions', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Create qualifier sessions', exact: true });
  await dialog.getByLabel('Qualifier stage', { exact: true }).selectOption(stage.id);
  await dialog.getByLabel('Number of sessions', { exact: true }).fill('2');
  await dialog
    .getByLabel('First session time (your timezone)', { exact: true })
    .fill('2030-06-12T10:00');
  await dialog.getByRole('button', { name: 'Preview sessions', exact: true }).click();
  await uiAction(page, 'qualifier.batch.create', () =>
    dialog.getByRole('button', { name: 'Create 2 sessions', exact: true }).click(),
  );
  await expect(dialog).toHaveCount(0);
  const lobbies = await db.qualifierLobby.findMany({
    where: { tournamentId: f.id },
    orderBy: { code: 'asc' },
  });
  expect(lobbies).toHaveLength(2);
  expect(lobbies[0].policy).toMatchObject({ runs: 2, requiredPlayers: 1 });
  await page
    .getByRole('checkbox', { name: 'Select all visible qualifier sessions', exact: true })
    .check();
  await page.getByRole('button', { name: 'Edit schedule and assignments', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Bulk qualifier schedule', exact: true });
  await dialog.getByLabel('Schedule', { exact: true }).selectOption('shift');
  await dialog.getByLabel('Shift (minutes)', { exact: true }).fill('60');
  await uiAction(page, 'qualifier.bulk.schedule', () =>
    dialog.getByRole('button', { name: 'Apply to 2 sessions', exact: true }).click(),
  );
  await expect(dialog).toHaveCount(0);
  expect(
    (
      await db.qualifierLobby.findUniqueOrThrow({ where: { id: lobbies[0].id } })
    ).scheduledAt!.getTime() - lobbies[0].scheduledAt!.getTime(),
  ).toBe(3600000);
  await page.getByRole('button', { name: 'Assign entrants', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Assign qualifier entrants', exact: true });
  await dialog.getByLabel('To', { exact: true }).selectOption(lobbies[0].id);
  await dialog.getByRole('checkbox', { name: f.entrants[0].name, exact: true }).check();
  await uiAction(page, 'qualifier.participants.move', () =>
    dialog.getByRole('button', { name: 'Assign 1 entrants', exact: true }).click(),
  );
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Assign entrants', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Assign qualifier entrants', exact: true });
  await dialog.getByLabel('From', { exact: true }).selectOption(lobbies[0].id);
  await dialog.getByLabel('To', { exact: true }).selectOption(lobbies[1].id);
  await dialog.getByRole('checkbox', { name: f.entrants[0].name, exact: true }).check();
  await uiAction(page, 'qualifier.participants.move', () =>
    dialog.getByRole('button', { name: 'Assign 1 entrants', exact: true }).click(),
  );
  await expect(dialog).toHaveCount(0);
  await page.reload();
  expect(await db.qualifierEntry.count({ where: { lobbyId: lobbies[0].id } })).toBe(0);
  expect(await db.qualifierEntry.count({ where: { lobbyId: lobbies[1].id } })).toBe(1);
  await screenshotLayouts(
    page,
    context,
    testInfo,
    'qualifier-scheduling',
    page.getByRole('main'),
    true,
  );
});

test('public staff categories and visibility can be edited together without granting access', async ({
  page,
  context,
  competition: f,
}, testInfo) => {
  const category = await db.staffCategory.create({
    data: { tournamentId: f.id, name: 'Commentators' },
  });
  for (const entrant of f.entrants.slice(0, 2))
    await db.staffMember.create({
      data: {
        tournamentId: f.id,
        osuId: entrant.osuId,
        username: entrant.name,
        avatarUrl: '',
        profileUrl: '',
      },
    });
  const rolesBefore = await db.userRole.count({ where: { tournamentId: f.id } });
  await page.goto(`${f.root}/admin/staff`);
  await page.getByRole('checkbox', { name: 'Select all 2 matching staff', exact: true }).check();
  await page.getByRole('button', { name: 'Edit positions', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Public visibility', { exact: true }).selectOption('HIDE');
  await dialog.getByLabel('Public staff category', { exact: true }).selectOption('ADD');
  await dialog.getByLabel('Category', { exact: true }).selectOption(category.id);
  await uiAction(page, 'staff.bulk', () =>
    dialog.getByRole('button', { name: 'Apply to 2 staff', exact: true }).click(),
  );
  await expect(dialog).toHaveCount(0);
  await page.reload();
  expect(
    await db.staffMember.count({
      where: {
        tournamentId: f.id,
        visible: false,
        assignments: { some: { categoryId: category.id } },
      },
    }),
  ).toBe(2);
  expect(await db.userRole.count({ where: { tournamentId: f.id } })).toBe(rolesBefore);
  await screenshotLayouts(page, context, testInfo, 'staff-bulk', page.getByRole('main'), true);
});

test('SE8 preview, native List/Bracket identity, confirmed advancement and public layouts', async ({
  page,
  context,
  browser,
  competition: f,
}, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 900 });
  const initial = await generateInUI(page, f, 'Main bracket');
  expect(initial.entries.map((e) => e.teamId)).toEqual(f.entrants.map((e) => e.id));
  const firstRound = initial.nodes.filter((n) => n.matchId);
  expect(firstRound).toHaveLength(4);
  expect(
    initial.nodes
      .flatMap((n) => (n.matchNumber == null ? [] : [n.matchNumber]))
      .sort((a, b) => a - b),
  ).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(
    firstRound.flatMap((n) => (n.matchNumber == null ? [] : [n.matchNumber])).sort((a, b) => a - b),
  ).toEqual([1, 2, 3, 4]);
  expect(
    firstRound.map((n) => n.slots.map((s) => f.entrants.findIndex((e) => e.id === s.teamId) + 1)),
  ).toEqual([
    [1, 8],
    [4, 5],
    [2, 7],
    [3, 6],
  ]);
  const node = firstRound[0],
    match = node.match!;
  const guests = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const publicPage = await guests.newPage();
    await publicPage.goto(`${f.root}/brackets`);
    await expect(publicPage.getByText('No brackets published yet.', { exact: true })).toBeVisible();
    await publishInUI(page);
    const toggle = page.getByRole('group', { name: 'Match view' });
    await toggle.getByRole('button', { name: 'List', exact: true }).click();
    const listLink = page.getByRole('link', { name: `Open match ${match.code}`, exact: true });
    await expect(listLink).toHaveAttribute('href', `${f.root}/admin/referee/${match.matchNumber}`);
    await screenshotLayouts(page, context, testInfo, 'admin-match-list', page.getByRole('main'));
    await listLink.click();
    await expect(page).toHaveURL(new RegExp(`/admin/referee/${match.matchNumber}$`));
    await openBracket(page, f, initial.id);
    await page
      .getByLabel('Bracket canvas', { exact: true })
      .getByRole('button', { name: `Match ${match.matchNumber}`, exact: true })
      .click();
    await page
      .getByRole('button', { name: `Edit result for match ${match.matchNumber}`, exact: true })
      .click();
    await expect(
      page.getByRole('region', {
        name: `Result editor for match ${match.matchNumber}`,
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole('complementary', { name: 'Bracket match editor', exact: true })
      .getByRole('link', { name: 'Referee', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/admin/referee/${match.matchNumber}$`));
    await openBracket(page, f, initial.id);
    await page.getByRole('button', { name: 'Edit bracket positions', exact: true }).click();
    await page
      .getByLabel('Bracket canvas', { exact: true })
      .getByRole('button', { name: `Match ${match.matchNumber}`, exact: true })
      .click();
    const editor = page.getByRole('complementary', { name: 'Bracket match editor', exact: true });
    await editor.getByRole('tab', { name: 'Match', exact: true }).click();
    const nativeLink = editor.getByRole('link', { name: 'Referee', exact: true });
    await expect(nativeLink).toHaveAttribute(
      'href',
      `${f.root}/admin/referee/${match.matchNumber}`,
    );
    await nativeLink.click();
    await expect(page).toHaveURL(new RegExp(`/admin/referee/${match.matchNumber}$`));
    await expect(page.getByTestId('current-phase')).toBeVisible();

    const submitted = await playToSubmission(f, match.id);
    expect(submitted.status).toBe('AWAITING_CONFIRMATION');
    expect((await bracket(initial.id)).nodes.filter((n) => n.matchId)).toHaveLength(4);
    const outgoing = await db.bracketSlot.findFirstOrThrow({
      where: { sourceNodeId: node.id, outcome: 'WINNER' },
    });
    expect(outgoing.teamId).toBeNull();
    await confirm(f, match.id);
    expect((await db.bracketSlot.findUniqueOrThrow({ where: { id: outgoing.id } })).teamId).toBe(
      match.teamAId,
    );
    expect(await finish(f, initial.id)).toBe(6);
    const finished = await bracket(initial.id);
    expect(finished.nodes.every((n) => n.state === 'COMPLETED')).toBe(true);
    expect(
      finished.nodes
        .flatMap((n) => (n.matchNumber == null ? [] : [n.matchNumber]))
        .sort((a, b) => a - b),
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(finished.nodes.map((n) => n.matchId)).size).toBe(7);
    expect(await db.match.count({ where: { tournamentId: f.id } })).toBe(7);
    expect(
      await db.matchMapResult.count({ where: { match: { tournamentId: f.id }, voided: false } }),
    ).toBe(7);
    expect(
      await db.matchPlayerScore.count({ where: { result: { match: { tournamentId: f.id } } } }),
    ).toBe(14);
    const beforeSync = finished.nodes.map((n) => n.matchId);
    await f.post({ type: 'competition.sync', id: initial.id, baseVersion: finished.version });
    expect((await bracket(initial.id)).nodes.map((n) => n.matchId)).toEqual(beforeSync);
    const historical = await db.match.findUniqueOrThrow({ where: { id: match.id } });
    expect(historical).toMatchObject({
      teamAId: match.teamAId,
      teamBId: match.teamBId,
      scoreA: 1,
      scoreB: 0,
      status: 'COMPLETED',
    });
    expect(await db.matchEvent.count({ where: { matchId: match.id } })).toBeGreaterThanOrEqual(6);
    const historyCount = await db.matchEvent.count({ where: { matchId: match.id } });
    const impact = await f.data<{ blocked: boolean; affected: unknown[]; hash: string }>(
      `competition-correction&id=${match.id}`,
    );
    expect(impact.blocked).toBe(true);
    expect(impact.affected.length).toBeGreaterThan(0);
    const correction = await f.request({
      type: 'match.reopen',
      id: match.id,
      baseVersion: historical.version,
      approveProgression: true,
      correctionHash: impact.hash,
      reason: 'Completed downstream matches must keep their participants and histories',
    });
    expect(correction.status()).toBe(409);
    expect((await correction.json()).error).toMatch(/started|completed|reconcil/i);
    expect(await db.match.findUniqueOrThrow({ where: { id: match.id } })).toEqual(historical);
    expect(await db.matchEvent.count({ where: { matchId: match.id } })).toBe(historyCount);
    const eliminated = await f.request({
      type: 'match.create',
      bracketId: initial.id,
      code: 'invalid-eliminated',
      stageId: f.stageId,
      teamAId: match.teamBId,
      teamBId: match.teamAId,
      refereeIds: [],
    });
    expect(eliminated.status()).toBe(409);
    expect(await db.match.count({ where: { tournamentId: f.id } })).toBe(7);

    await page.goto(`${f.root}/admin/matches`);
    await page.getByRole('button', { name: 'New match', exact: true }).click();
    const newMatch = page.getByRole('dialog');
    await expect(newMatch.getByLabel(/scoring system|score mode/i)).toHaveCount(0);
    await newMatch.getByLabel('Tournament stage', { exact: true }).selectOption(f.stageId);
    await newMatch.getByLabel('Competition path', { exact: true }).selectOption(initial.id);
    const redOptions = newMatch.getByLabel('Team A / red', { exact: true });
    await expect(redOptions.locator(`option[value="${match.teamBId}"]`)).toHaveCount(0);
    await newMatch
      .getByRole('checkbox', {
        name: 'Allow ineligible participants (exhibition or custom match)',
        exact: true,
      })
      .check();
    await expect(redOptions.locator(`option[value="${match.teamBId}"]`)).toHaveCount(1);
    await expect(newMatch.getByLabel('Eligibility override reason', { exact: true })).toBeVisible();
    page.once('dialog', (confirmation) => confirmation.accept());
    await newMatch.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(newMatch).toHaveCount(0);
    const exhibition = await f.post({
      type: 'match.create',
      bracketId: initial.id,
      code: 'approved-exhibition',
      stageId: f.stageId,
      teamAId: match.teamBId,
      teamBId: match.teamAId,
      refereeIds: [],
      allowIneligible: true,
      overrideReason: 'Approved exhibition outside the completed bracket',
    });
    expect(await db.bracketNode.count({ where: { matchId: exhibition.id } })).toBe(0);
    expect(
      await db.auditLog.count({
        where: { tournamentId: f.id, action: 'competition.eligibility.override' },
      }),
    ).toBeGreaterThan(0);
    expect((await bracket(initial.id)).nodes.map((n) => n.matchId)).toEqual(beforeSync);

    await openBracket(page, f, initial.id);
    const adminRegion = page.getByRole('region', { name: 'Main bracket bracket', exact: true });
    await screenshotLayouts(page, context, testInfo, 'admin-bracket', adminRegion);
    const canvas = page.getByLabel('Bracket canvas', { exact: true });
    for (let index = 0; index < 10; index++) {
      const zoom = page.getByRole('button', { name: 'Zoom in', exact: true });
      if (await zoom.isEnabled()) await zoom.click();
    }
    expect(await canvas.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await canvas.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => canvas.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Fit bracket', exact: true }).click();
    await page.getByRole('button', { name: 'Next round', exact: true }).click();
    await expect(page.getByLabel('Bracket round', { exact: true })).toHaveValue(
      finished.rounds[1].id,
    );

    await publicPage.reload();
    const publicRegion = publicPage.getByRole('region', {
      name: 'Main bracket bracket',
      exact: true,
    });
    await expect(publicRegion).toBeVisible();
    for (const name of [
      'Create bracket',
      'Publish bracket',
      'Unpublish bracket',
      'Recalculate progression',
      'Edit bracket positions',
      'Save position',
      'Start match',
      'Regenerate Match',
      'Delete bracket',
    ])
      await expect(publicPage.getByRole('button', { name, exact: true })).toHaveCount(0);
    await expect(publicPage.getByRole('checkbox')).toHaveCount(0);
    await screenshotLayouts(publicPage, guests, testInfo, 'public-bracket', publicRegion);
    await publicPage
      .getByLabel('Bracket canvas', { exact: true })
      .getByRole('button', { name: `Match ${match.matchNumber}`, exact: true })
      .click();
    await expect(publicPage).toHaveURL(
      `${new URL(page.url()).origin}${f.root}/matches/${match.matchNumber}`,
    );
    await expect(publicPage.getByRole('region', { name: 'Match action history' })).toBeVisible();
    const denied = await guests.request.post(`/api/admin/action?tournament=${f.slug}`, {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        type: 'competition.publish',
        id: initial.id,
        baseVersion: (await bracket(initial.id)).version,
        published: false,
      },
    });
    expect(denied.status()).toBe(401);
    expect((await bracket(initial.id)).published).toBe(true);
  } finally {
    await guests.close();
  }
  expect(errors).toEqual([]);
});

test('bracket controls edit and restore fixtures, then permanently rebuild from match 1', async ({
  page,
  context,
  competition: f,
}, testInfo) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(15000);
  await page.setViewportSize({ width: 1366, height: 900 });
  const created = await f.post(
    bracketInput(f, 'Managed bracket', {
      teamIds: f.entrants.slice(0, 4).map((entry) => entry.id),
    }),
  );
  const initial = await bracket(created.id);
  const node = initial.nodes.find((node) => node.match)!;
  const m = node.match!;
  await openBracket(page, f, created.id);
  const canvas = page.getByLabel('Bracket canvas', { exact: true });
  await page.getByLabel('Search bracket', { exact: true }).fill(String(m.matchNumber));
  await page.getByLabel('Search bracket', { exact: true }).press('Enter');
  const panel = page.getByRole('complementary', { name: 'Bracket match editor', exact: true });
  await expect(panel).toBeVisible();
  await panel
    .getByRole('button', { name: `Edit time for match ${m.matchNumber}`, exact: true })
    .click();
  await panel
    .getByLabel(`Scheduled time for match ${m.matchNumber}`, { exact: true })
    .fill('2030-01-02T12:30');
  await uiAction(page, 'match.schedule', () =>
    panel.getByRole('button', { name: 'Save', exact: true }).click(),
  );
  await panel
    .getByRole('button', { name: `Edit referees for match ${m.matchNumber}`, exact: true })
    .click();
  const ownerName = (await db.user.findUniqueOrThrow({ where: { id: f.ownerId } })).username;
  await panel.getByRole('checkbox', { name: ownerName, exact: true }).check();
  await uiAction(page, 'match.schedule', () =>
    panel.getByRole('button', { name: 'Save', exact: true }).click(),
  );
  expect(await db.matchAssignment.count({ where: { matchId: m.id, userId: f.ownerId } })).toBe(1);
  await panel.getByRole('tab', { name: 'Positions', exact: true }).click();
  await panel.getByLabel('Assignment', { exact: true }).selectOption('LOCKED');
  await uiAction(page, 'competition.slot', () =>
    panel.getByRole('button', { name: 'Save position', exact: true }).click(),
  );
  await expect(panel.getByRole('tab', { name: 'Match', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await panel
    .getByRole('button', { name: `Edit result for match ${m.matchNumber}`, exact: true })
    .click();
  const result = panel.getByRole('form', {
    name: `Result editor for match ${m.matchNumber}`,
    exact: true,
  });
  await result.getByLabel('Forfeit (FF)', { exact: true }).selectOption('B');
  for (const width of [1920, 1024, 768, 375, 844, 683, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(result.getByLabel('Forfeit (FF)', { exact: true })).toHaveValue('B');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole('button', { name: 'Interface language', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Italiano', exact: true }).click();
  const localizedPanel = page.locator('aside[tabindex="-1"]');
  await expect(localizedPanel.getByLabel('Rinuncia (FF)', { exact: true })).toHaveValue('B');
  await page.screenshot({
    path: testInfo.outputPath('bracket-result-italian-320.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByLabel('Cerca nel tabellone', { exact: true }).fill('2');
  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.getByLabel('Cerca nel tabellone', { exact: true }).press('Enter');
  await expect(localizedPanel.getByLabel('Rinuncia (FF)', { exact: true })).toHaveValue('B');
  await page.getByRole('button', { name: "Lingua dell'interfaccia", exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'English', exact: true }).click();
  await page.getByLabel('Search bracket', { exact: true }).fill(String(m.matchNumber));
  await page.setViewportSize({ width: 1366, height: 900 });
  await uiAction(page, 'match.result.set', () =>
    result.getByRole('button', { name: 'Save result', exact: true }).click(),
  );
  expect(await db.match.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({
    status: 'COMPLETED',
    scoreA: 1,
    scoreB: 0,
    winnerSide: 'A',
    forfeitSide: 'B',
  });
  await screenshotLayouts(page, context, testInfo, 'bracket-inspector', page.getByRole('main'));
  await panel.getByRole('button', { name: 'Delete match', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Delete generated match', exact: true });
  await dialog.getByLabel('Match number confirmation', { exact: true }).fill(String(m.matchNumber));
  await dialog
    .getByLabel('Deletion reason', { exact: true })
    .fill('Test explicit bracket restoration');
  await uiAction(page, 'match.delete', () =>
    dialog.getByRole('button', { name: 'Delete generated match', exact: true }).click(),
  );
  await expect(panel).toHaveCount(0);
  await canvas.getByRole('button', { name: 'Regenerate Match', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Regenerate Match', exact: true });
  await uiAction(page, 'competition.regenerate', () =>
    dialog.getByRole('button', { name: 'Regenerate Match', exact: true }).click(),
  );
  await expect(dialog).toHaveCount(0);
  expect(await db.match.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({
    deletedAt: null,
    matchNumber: m.matchNumber,
    status: 'COMPLETED',
    scoreA: 1,
    forfeitSide: 'B',
  });
  expect(await db.match.count({ where: { tournamentId: f.id } })).toBe(2);
  await db.team.updateMany({
    where: { id: { in: f.entrants.slice(0, 3).map((entrant) => entrant.id) } },
    data: { seed: { increment: 1 } },
  });
  await db.team.update({ where: { id: f.entrants[3].id }, data: { seed: 1 } });
  await page.getByRole('button', { name: 'Rebuild bracket', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Delete bracket', exact: true });
  await dialog
    .getByLabel('Type the bracket name to confirm', { exact: true })
    .fill('Managed bracket');
  await dialog
    .getByRole('checkbox', {
      name: 'I understand that completed matches and all referee histories will be permanently erased.',
      exact: true,
    })
    .check();
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(
    dialog.getByText('Recreation will start again at match 1.', { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('permanent-bracket-delete-320.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  await uiAction(page, 'competition.delete', () =>
    dialog.getByRole('button', { name: 'Delete bracket', exact: true }).click(),
  );
  dialog = page.getByRole('dialog', { name: 'Rebuild bracket', exact: true });
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Managed bracket');
  await uiAction(page, 'competition.preview', () =>
    dialog.getByRole('button', { name: 'Preview bracket', exact: true }).click(),
  );
  const rebuilt = await uiAction(page, 'competition.create', () =>
    dialog.getByRole('button', { name: 'Generate bracket', exact: true }).click(),
  );
  expect(rebuilt.id).not.toBe(created.id);
  const current = await bracket(rebuilt.id);
  expect(current.entries[0].teamId).toBe(f.entrants[3].id);
  expect(current.nodes.map((node) => node.matchNumber).sort()).toEqual([1, 2, 3]);
  expect(await db.bracket.findUnique({ where: { id: created.id } })).toBeNull();
  expect(await db.match.findUnique({ where: { id: m.id } })).toBeNull();
  await expect(page.getByLabel('Competition bracket', { exact: true })).toHaveValue(rebuilt.id);
  await page.getByLabel('Search bracket', { exact: true }).fill('No such participant');
  await expect(page.getByRole('status').filter({ hasText: 'No matches found.' })).toBeVisible();
  await page.getByLabel('Search bracket', { exact: true }).fill('');
  expect(
    await db.matchEvent.count({ where: { matchId: m.id, kind: 'competition.regenerate' } }),
  ).toBe(0);
  await page.getByRole('button', { name: 'Delete bracket', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Delete bracket', exact: true });
  await expect(
    dialog.getByText('Recreation will start again at match 1.', { exact: true }),
  ).toBeVisible();
  await dialog
    .getByLabel('Type the bracket name to confirm', { exact: true })
    .fill('Managed bracket');
  await uiAction(page, 'competition.delete', () =>
    dialog.getByRole('button', { name: 'Delete bracket', exact: true }).click(),
  );
  await expect(page.getByText('No competition brackets', { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('bracket-empty.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('DE8 routes losers, preserves an independent division and plays the Grand Finals reset', async ({
  competition: f,
}) => {
  test.setTimeout(240_000);
  const input = bracketInput(f, 'Double elimination', { format: 'DOUBLE_ELIMINATION' });
  const created = await f.post(input);
  expect((await f.post(input)).id).toBe(created.id);
  const initial = await bracket(created.id),
    first = initial.nodes.find((n) => n.matchId)!;
  await playToSubmission(f, first.matchId!);
  const losingRoute = await db.bracketSlot.findFirstOrThrow({
    where: { sourceNodeId: first.id, outcome: 'LOSER' },
  });
  expect(losingRoute.teamId).toBeNull();
  await confirm(f, first.matchId!);
  const loser = first.match!.teamBId!;
  expect((await db.bracketSlot.findUniqueOrThrow({ where: { id: losingRoute.id } })).teamId).toBe(
    loser,
  );
  const eligibility = await f.data<MatchListData>('matches');
  expect(
    eligibility
      .options!.paths!.find((p) => p.id === created.id)!
      .teams.find((r) => r.teamId === loser)?.eligible,
  ).toBe(true);
  expect(await finish(f, created.id, 'RESET_FINAL')).toBe(14);
  const finished = await bracket(created.id);
  expect(
    finished.nodes
      .flatMap((n) => (n.matchNumber == null ? [] : [n.matchNumber]))
      .sort((a, b) => a - b),
  ).toEqual(Array.from({ length: 15 }, (_, index) => index + 1));
  expect(finished.nodes.filter((n) => n.matchId)).toHaveLength(15);
  expect(finished.nodes.every((n) => ['COMPLETED', 'SKIPPED', 'BYE'].includes(n.state))).toBe(true);
  const losses = new Map<string, number>();
  for (const node of finished.nodes)
    if (node.match?.status === 'COMPLETED') {
      const losingId = node.match.winnerSide === 'A' ? node.match.teamBId! : node.match.teamAId!;
      losses.set(losingId, (losses.get(losingId) || 0) + 1);
    }
  expect([...losses.values()].filter((count) => count === 2)).toHaveLength(7);
  const independent = await f.post(bracketInput(f, 'Independent division'));
  expect((await bracket(independent.id)).entries.map((e) => e.teamId)).toContain(loser);
  const paths = (await f.data<MatchListData>('matches')).options!.paths!;
  expect(
    paths.find((p) => p.id === created.id)!.teams.find((e) => e.teamId === loser)?.eligible,
  ).toBe(false);
  expect(
    paths.find((p) => p.id === independent.id)!.teams.find((e) => e.teamId === loser)?.eligible,
  ).toBe(true);
  expect(await db.match.count({ where: { tournamentId: f.id } })).toBe(19);
});

test('creation previews automatic progression stages and number ranges, refreshes overrides and creates exactly the reviewed bracket', async ({
  page,
  context,
  competition: f,
}, info) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(15000);
  const pool = await db.mappool.findUniqueOrThrow({
    where: { stageId: f.stageId },
    include: { publishedRevision: { include: { slots: true } } },
  });
  const stageIds = [f.stageId];
  const names = ['RO8', 'Semifinale dell autore', 'Finalissima', 'Grand Finals configurata'];
  await db.tournamentStage.update({
    where: { id: f.stageId },
    data: { name: names[0], position: 10 },
  });
  for (let i = 1; i < names.length; i++) {
    const stage = await db.tournamentStage.create({
      data: {
        tournamentId: f.id,
        name: names[i],
        slug: `generation-${i}`,
        kind: 'ELIMINATION',
        position: 10 - i,
      },
    });
    await publishPool(
      f.id,
      stage.id,
      pool.publishedRevision!.slots.map((slot) => slot.beatmapId),
    );
    stageIds.push(stage.id);
  }
  for (let i = 0; i < stageIds.length - 1; i++)
    await db.tournamentStage.update({
      where: { id: stageIds[i] },
      data: { nextStageId: stageIds[i + 1] },
    });
  await openBracket(page, f);
  await page.getByRole('button', { name: 'Create bracket', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create bracket', exact: true });
  await dialog.getByLabel('Name', { exact: true }).fill('Stage progression preview');
  await dialog.getByLabel('Format', { exact: true }).selectOption('DOUBLE_ELIMINATION');
  await expect(dialog.getByLabel('Gameplay stage', { exact: true })).toHaveValue(f.stageId);
  const preview = await uiAction<CompetitionGenerationPreview>(page, 'competition.preview', () =>
    dialog.getByRole('button', { name: 'Preview bracket', exact: true }).click(),
  );
  const expectedKeys = [
    'g1-r1',
    'g2-r1',
    'g1-r2',
    'g2-r2',
    'g2-r3',
    'g1-r3',
    'g2-r4',
    'g3-r1',
    'g3-r2',
  ];
  expect(preview.assignments.map((row) => row.roundKey)).toEqual(expectedKeys);
  expect(
    await dialog
      .locator('[data-round-preview]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-round-preview'))),
  ).toEqual(expectedKeys);
  const row = (key: string) => dialog.locator(`[data-round-preview="${key}"]`);
  await expect(row('g1-r1')).toContainText('Matches #1-4');
  await expect(row('g2-r1')).toContainText('Matches #5-6');
  await expect(row('g1-r2')).toContainText('Matches #7-8');
  await db.tournamentStage.update({
    where: { id: stageIds[3] },
    data: { description: 'Configuration changed after review' },
  });
  const staleResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/admin/action') &&
      response.request().postDataJSON()?.type === 'competition.create',
  );
  await dialog.getByRole('button', { name: 'Generate bracket', exact: true }).click();
  expect((await staleResponse).status()).toBe(409);
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Stage progression preview');
  expect(await db.bracket.count({ where: { tournamentId: f.id } })).toBe(0);
  await uiAction(page, 'competition.preview', () =>
    dialog.getByRole('button', { name: 'Preview bracket', exact: true }).click(),
  );
  await expect(row('g3-r2')).toContainText('Match #15');
  for (const assignment of preview.assignments)
    await expect(row(assignment.roundKey).getByRole('combobox')).toHaveValue('');
  await expect(row('g1-r2').getByRole('combobox')).toContainText(`Automatic: ${names[1]}`);
  await expect(row('g3-r1').getByRole('combobox')).toContainText(`Automatic: ${names[3]}`);
  await row('g1-r2').getByRole('combobox').focus();
  await uiAction<CompetitionGenerationPreview>(page, 'competition.preview', () =>
    row('g1-r2').getByRole('combobox').selectOption(f.stageId),
  );
  await expect(row('g1-r2')).toContainText('Matches #5-6');
  await expect(row('g1-r2').getByRole('combobox')).toBeFocused();
  await expect(row('g2-r1')).toContainText('Matches #7-8');
  await uiAction<CompetitionGenerationPreview>(page, 'competition.preview', () =>
    row('g1-r2').getByRole('combobox').selectOption(''),
  );
  await expect(row('g1-r2')).toContainText('Matches #7-8');
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10000 });
  for (const appearance of ['light', 'dark']) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute('data-appearance', value),
      appearance,
    );
    for (const width of [1920, 1366, 1024, 844, 768, 683, 390, 375, 320]) {
      await page.setViewportSize({ width, height: width === 844 ? 390 : 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const bounds = await dialog.evaluate((el) => ({
        width: el.clientWidth,
        scroll: el.scrollWidth,
        overflow: [...el.querySelectorAll('*')]
          .filter((item) => item.getBoundingClientRect().right > el.getBoundingClientRect().right)
          .slice(0, 8)
          .map((item) => ({
            tag: item.tagName,
            classes: item.className,
            width: item.getBoundingClientRect().width,
            text: item.textContent?.slice(0, 100),
          })),
      }));
      expect(bounds.scroll, JSON.stringify({ viewport: width, ...bounds })).toBeLessThanOrEqual(
        bounds.width,
      );
      await row('g1-r1').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath(`generation-preview-${appearance}-${width}.png`),
        fullPage: true,
        animations: 'disabled',
      });
      await row('g3-r2').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath(`generation-ending-${appearance}-${width}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  const created = await uiAction(page, 'competition.create', () =>
    dialog.getByRole('button', { name: 'Generate bracket', exact: true }).click(),
  );
  await expect(dialog).toHaveCount(0);
  const current = await bracket(created.id);
  for (const assignment of preview.assignments) {
    const round = current.rounds.find((round) => round.key === assignment.roundKey)!;
    expect(round.stageId).toBe(assignment.stageId);
    expect(
      current.nodes
        .filter((node) => node.roundId === round.id)
        .map((node) => node.matchNumber)
        .sort((a, b) => a! - b!),
    ).toEqual(
      Array.from({ length: assignment.matchCount }, (_, i) => assignment.firstMatchNumber! + i),
    );
  }
  await publishInUI(page);
  const guests = await context.browser()!.newContext();
  try {
    const publicPage = await guests.newPage();
    await publicPage.goto(`${f.root}/brackets`);
    const canvas = publicPage.getByLabel('Bracket canvas', { exact: true });
    await expect(canvas.getByRole('button', { name: 'Match 5', exact: true })).toContainText(
      'Loser of Match #1',
    );
    expect(await finish(f, created.id, 'RESET_FINAL')).toBe(15);
    await publicPage.reload();
    await expect(canvas.getByRole('button', { name: 'Match 15', exact: true })).toContainText(
      'Completed',
    );
    await page.reload();
    await page.getByRole('button', { name: 'Interface language', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Italiano', exact: true }).click();
    await page.getByRole('button', { name: 'Crea tabellone', exact: true }).click();
    const italian = page.getByRole('dialog', { name: 'Crea tabellone', exact: true });
    await italian.getByRole('button', { name: 'Anteprima del tabellone', exact: true }).click();
    await expect(italian.locator('[data-round-preview="g1-r1"]')).toContainText('Incontri #16-19');
    await expect(italian.locator('[data-round-preview="g1-r2"]')).toContainText(
      `Automatica: ${names[1]}`,
    );
    await page.setViewportSize({ width: 320, height: 844 });
    await italian.locator('[data-round-preview="g1-r1"]').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath('generation-preview-italian-320.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await italian.getByRole('button', { name: 'Annulla', exact: true }).click();
  } finally {
    await guests.close();
  }
});

test('rebuild refreshes stage suggestions when former participants and stages are no longer available', async ({
  page,
  competition: f,
}) => {
  const retiredStage = await db.tournamentStage.create({
    data: {
      tournamentId: f.id,
      name: 'Former final',
      slug: 'former-final',
      kind: 'ELIMINATION',
      position: 1,
    },
  });
  const original = await f.post(
    bracketInput(f, 'Smaller rebuild', {
      roundStages: { 'g1-r2': retiredStage.id, 'g1-r3': retiredStage.id },
    }),
  );
  await db.team.updateMany({
    where: { id: { in: f.entrants.slice(4).map((team) => team.id) } },
    data: { status: 'REJECTED' },
  });
  await db.tournamentStage.update({
    where: { id: retiredStage.id },
    data: { archivedAt: new Date() },
  });
  await openBracket(page, f, original.id);
  await page.getByRole('button', { name: 'Rebuild bracket', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: 'Delete bracket', exact: true });
  await deletion
    .getByLabel('Type the bracket name to confirm', { exact: true })
    .fill('Smaller rebuild');
  await uiAction(page, 'competition.delete', () =>
    deletion.getByRole('button', { name: 'Delete bracket', exact: true }).click(),
  );
  const dialog = page.getByRole('dialog', { name: 'Rebuild bracket', exact: true });
  const preview = await uiAction<CompetitionGenerationPreview>(page, 'competition.preview', () =>
    dialog.getByRole('button', { name: 'Preview bracket', exact: true }).click(),
  );
  expect(preview.rounds).toHaveLength(2);
  expect(preview.assignments.every((row) => row.stageId === f.stageId)).toBe(true);
  await expect(dialog.locator('[data-round-preview="g1-r1"]')).toContainText('Matches #1-2');
  const created = await uiAction(page, 'competition.create', () =>
    dialog.getByRole('button', { name: 'Generate bracket', exact: true }).click(),
  );
  const rebuilt = await bracket(created.id);
  expect(rebuilt.entries).toHaveLength(4);
  expect(rebuilt.nodes.map((node) => node.matchNumber).sort()).toEqual([1, 2, 3]);
  expect(rebuilt.id).not.toBe(original.id);
});

test('concurrent reviewed generations serialize counter reservations and require the stale writer to re-preview', async ({
  competition: f,
}) => {
  const inputs = ['First', 'Second'].map((name) => bracketInput(f, name));
  const reviews: CompetitionGenerationPreview[] = [];
  for (const input of inputs)
    reviews.push(
      await f.post<CompetitionGenerationPreview>({ ...input, type: 'competition.preview' }),
    );
  expect(reviews.every((review) => review.assignments[0].firstMatchNumber === 1)).toBe(true);
  const responses = await Promise.all(
    inputs.map((input, i) => f.request({ ...input, reviewHash: reviews[i].reviewHash })),
  );
  expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);
  const staleIndex = responses.findIndex((response) => response.status() === 409);
  expect(await responses[staleIndex].text()).toContain('Preview the bracket again');
  expect(await db.bracket.count({ where: { tournamentId: f.id } })).toBe(1);
  const fresh = await f.post<CompetitionGenerationPreview>({
    ...inputs[staleIndex],
    type: 'competition.preview',
  });
  expect(fresh.assignments[0].firstMatchNumber).toBe(8);
  await f.post({ ...inputs[staleIndex], reviewHash: fresh.reviewHash });
  expect(
    (
      await db.bracketNode.findMany({
        where: { tournamentId: f.id },
        orderBy: { matchNumber: 'asc' },
        select: { matchNumber: true },
      })
    ).map((node) => node.matchNumber),
  ).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
});

for (const resetPlayed of [false, true]) {
  test(`DE8 presentation uses two paths, configured stages and a ${resetPlayed ? 'played' : 'skipped'} reset`, async ({
    page,
    competition: f,
  }, info) => {
    test.setTimeout(180000);
    page.setDefaultTimeout(15000);
    const pool = await db.mappool.findUniqueOrThrow({
      where: { stageId: f.stageId },
      include: { publishedRevision: { include: { slots: true } } },
    });
    const stageNames = ['Quarterfinals', 'Semifinals', "Finalissima dell'autore"];
    const stages = [];
    for (const [i, name] of stageNames.entries()) {
      const stage = await db.tournamentStage.create({
        data: {
          tournamentId: f.id,
          name,
          slug: `display-${i}`,
          kind: 'ELIMINATION',
          position: i + 1,
        },
      });
      await publishPool(
        f.id,
        stage.id,
        pool.publishedRevision!.slots.map((slot) => slot.beatmapId),
      );
      stages.push(stage.id);
    }
    const roundStages = Object.fromEntries([
      ['g1-r1', stages[0]],
      ['g1-r2', stages[1]],
      ['g1-r3', stages[2]],
      ['g2-r1', stages[0]],
      ['g2-r2', stages[1]],
      ['g2-r3', stages[1]],
      ['g2-r4', stages[2]],
      ['g3-r1', stages[2]],
      ['g3-r2', stages[2]],
    ]);
    const created = await f.post(
      bracketInput(f, 'Readable double elimination', {
        format: 'DOUBLE_ELIMINATION',
        stageId: stages[0],
        roundStages,
      }),
    );
    await f.post({
      type: 'competition.publish',
      id: created.id,
      baseVersion: (await bracket(created.id)).version,
      published: true,
    });
    const initial = await bracket(created.id);
    const beforeViewing = JSON.stringify(initial);
    await openBracket(page, f, created.id);
    const canvas = page.getByLabel('Bracket canvas', { exact: true });
    const wf = initial.rounds.filter((round) => round.lane === 'WINNERS').at(-1)!;
    const lf = initial.rounds.filter((round) => round.lane === 'LOSERS').at(-1)!;
    const gf = initial.rounds.find((round) => round.lane === 'FINALS')!;
    const reset = initial.rounds.filter((round) => round.lane === 'FINALS').at(-1)!;
    const gfNode = initial.nodes.find((node) => node.roundId === gf.id)!;
    const resetNode = initial.nodes.find((node) => node.roundId === reset.id)!;
    await expect(canvas.locator('[data-bracket-section]')).toHaveCount(2);
    await expect(canvas.locator('[data-bracket-section="WINNERS"]')).toHaveText('Winners Bracket');
    await expect(canvas.locator('[data-bracket-section="LOSERS"]')).toHaveText('Losers Bracket');
    await expect(canvas.locator('path[data-progression-lane="WINNERS"]')).toHaveCount(6);
    await expect(canvas.locator('path[data-progression-lane="LOSERS"]')).toHaveCount(5);
    await expect(canvas.locator('path')).toHaveCount(11);
    for (const round of [wf, lf, gf, reset])
      await expect(canvas.locator(`[data-round-heading="${round.id}"]`)).toContainText(
        stageNames[2],
      );
    await expect(canvas.locator(`[data-round-heading="${wf.id}"]`)).toContainText('Winners Finals');
    await expect(canvas.locator(`[data-round-heading="${lf.id}"]`)).toContainText('Losers Finals');
    await expect(canvas.locator(`[data-round-heading="${gf.id}"]`)).toContainText('Grand Finals');
    await expect(canvas.locator(`[data-round-heading="${reset.id}"]`)).toContainText(
      'Bracket reset',
    );
    const losingTarget = initial.nodes.find((node) =>
      node.slots.some((slot) => slot.outcome === 'LOSER'),
    )!;
    const losingSlot = losingTarget.slots.find((slot) => slot.outcome === 'LOSER')!;
    const losingSource = initial.nodes.find((node) => node.id === losingSlot.sourceNodeId)!;
    await expect(
      canvas.getByRole('button', { name: `Match ${losingTarget.matchNumber}`, exact: true }),
    ).toContainText(`Loser of Match #${losingSource.matchNumber}`);
    await expect(
      canvas.getByRole('button', { name: `Match ${gfNode.matchNumber}`, exact: true }),
    ).toContainText(
      `Winner of Match #${initial.nodes.find((node) => node.roundId === wf.id)!.matchNumber}`,
    );
    await expect(
      canvas.getByRole('button', { name: `Match ${resetNode.matchNumber}`, exact: true }),
    ).toContainText(`Loser of Match #${gfNode.matchNumber}`);
    const positions = await canvas.locator('button[data-round]').evaluateAll((buttons) =>
      buttons.map((button) => ({
        round: button.getAttribute('data-round'),
        x: button.parentElement!.style.left,
        y: button.parentElement!.style.top,
      })),
    );
    const at = (id: string) => positions.find((position) => position.round === id)!;
    expect(at(wf.id).x).toBe(at(lf.id).x);
    expect(parseFloat(at(gf.id).x)).toBeGreaterThan(parseFloat(at(wf.id).x));
    expect(at(gf.id).y).toBe(at(reset.id).y);
    expect(parseFloat(at(reset.id).x)).toBeGreaterThan(parseFloat(at(gf.id).x));
    for (const appearance of ['light', 'dark']) {
      await page.getByRole('button', { name: 'Appearance', exact: true }).first().click();
      await page
        .getByRole('menuitemradio', {
          name: appearance === 'light' ? 'Light' : 'Dark',
          exact: true,
        })
        .click();
      for (const width of [1920, 1366, 1024, 844, 768, 683, 390, 375, 320]) {
        await page.setViewportSize({ width, height: width === 844 ? 390 : 900 });
        await page.getByLabel('Bracket round', { exact: true }).selectOption(lf.id);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        if (width >= 768) {
          await page.getByRole('button', { name: 'Fit bracket', exact: true }).click();
          const fitted = await page
            .getByRole('button', { name: 'Reset zoom', exact: true })
            .textContent();
          await page.getByRole('button', { name: 'Fit bracket', exact: true }).click();
          await expect(page.getByRole('button', { name: 'Reset zoom', exact: true })).toHaveText(
            fitted!,
          );
        } else {
          await expect(
            page.getByRole('heading', { name: 'Losers Bracket', exact: true }),
          ).toBeVisible();
          await page.getByLabel('Bracket round', { exact: true }).selectOption(gf.id);
          await expect(
            page
              .getByRole('button', { name: `Match ${gfNode.matchNumber}`, exact: true })
              .filter({ visible: true }),
          ).toContainText('Winner of Match #');
        }
        await page.screenshot({
          path: info.outputPath(`de-pending-${appearance}-${width}.png`),
          fullPage: true,
          animations: 'disabled',
        });
      }
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.getByRole('button', { name: 'Reset zoom', exact: true }).click();
    await page.getByLabel('Bracket round', { exact: true }).selectOption(gf.id);
    await canvas.getByRole('button', { name: `Match ${gfNode.matchNumber}`, exact: true }).click();
    const editor = page.getByRole('complementary', { name: 'Bracket match editor', exact: true });
    await expect(editor).toContainText(stageNames[2]);
    await expect(editor).toContainText('Winner of Match #');
    await editor.getByRole('button', { name: 'Close bracket editor', exact: true }).click();
    expect(JSON.stringify(await bracket(created.id))).toBe(beforeViewing);
    const guests = await page.context().browser()!.newContext();
    try {
      const publicPage = await guests.newPage();
      await publicPage.goto(`${f.root}/brackets`);
      await expect(
        publicPage.getByLabel('Bracket canvas', { exact: true }).locator('[data-bracket-section]'),
      ).toHaveCount(2);
      await expect(publicPage.getByLabel('Bracket canvas', { exact: true })).toContainText(
        'Loser of Match #',
      );
      expect(await finish(f, created.id, resetPlayed ? 'RESET_FINAL' : 'RED_WINS')).toBe(
        resetPlayed ? 15 : 14,
      );
      const finished = await bracket(created.id);
      expect(finished.nodes.find((node) => node.id === resetNode.id)!.state).toBe(
        resetPlayed ? 'COMPLETED' : 'SKIPPED',
      );
      const finalWitness = JSON.stringify(finished);
      await page.reload();
      await page.getByLabel('Bracket round', { exact: true }).selectOption(reset.id);
      await expect(
        page
          .getByLabel('Bracket canvas', { exact: true })
          .getByRole('button', { name: `Match ${resetNode.matchNumber}`, exact: true }),
      ).toContainText(resetPlayed ? 'Completed' : 'Not required');
      await publicPage.reload();
      await expect(
        publicPage.getByLabel('Bracket canvas', { exact: true }).locator('path'),
      ).toHaveCount(11);
      const playedFinal = finished.nodes.find((node) => node.id === gfNode.id)!.match!;
      const visibleFinal = publicPage
        .getByLabel('Bracket canvas', { exact: true })
        .getByRole('button', { name: `Match ${gfNode.matchNumber}`, exact: true });
      for (const teamId of [playedFinal.teamAId, playedFinal.teamBId])
        await expect(visibleFinal).toContainText(
          f.entrants.find((entry) => entry.id === teamId)!.name,
        );
      await expect(visibleFinal).not.toContainText('Winner of Match #');
      await page.getByRole('button', { name: 'Fit bracket', exact: true }).click();
      await page.screenshot({
        path: info.outputPath('de-completed-desktop.png'),
        fullPage: true,
        animations: 'disabled',
      });
      await page.setViewportSize({ width: 320, height: 844 });
      await page.screenshot({
        path: info.outputPath('de-completed-mobile.png'),
        fullPage: true,
        animations: 'disabled',
      });
      await page.getByRole('button', { name: 'Interface language', exact: true }).click();
      await page.getByRole('menuitemradio', { name: 'Italiano', exact: true }).click();
      await expect(page.getByLabel('Turno del tabellone', { exact: true })).toContainText(
        stageNames[2],
      );
      await page.screenshot({
        path: info.outputPath('de-completed-italian.png'),
        fullPage: true,
        animations: 'disabled',
      });
      expect(JSON.stringify(await bracket(created.id))).toBe(finalWitness);
    } finally {
      await guests.close();
    }
  });
}

test('six-player byes, locked placements, and group standings use native confirmed matches', async ({
  competition: f,
}) => {
  test.setTimeout(240_000);
  const six = await f.post(
    bracketInput(f, 'Six-player bracket', { teamIds: f.entrants.slice(0, 6).map((e) => e.id) }),
  );
  let current = await bracket(six.id);
  expect(current.nodes.filter((n) => n.state === 'BYE')).toHaveLength(2);
  const first = current.nodes.find((n) => n.matchId)!;
  await f.post({
    type: 'competition.slot',
    id: six.id,
    baseVersion: current.version,
    nodeId: first.id,
    side: 'A',
    teamId: first.match!.teamAId,
    mode: 'LOCKED',
  });
  current = await bracket(six.id);
  await f.post({ type: 'competition.sync', id: six.id, baseVersion: current.version });
  expect((await bracket(six.id)).nodes.find((n) => n.id === first.id)!.slots[0]).toMatchObject({
    mode: 'LOCKED',
    teamId: first.match!.teamAId,
  });
  expect(await finish(f, six.id)).toBe(5);
  expect(await db.match.count({ where: { tournamentId: f.id } })).toBe(5);
  const groups = await f.post(
    bracketInput(f, 'Groups', { format: 'GROUPS', groupCount: 2, advancePerGroup: 1 }),
  );
  expect(await finish(f, groups.id, 'SEED_WINS')).toBe(12);
  const data = await f.data<CompetitionData>('competition');
  const standings = data.brackets.find((b) => b.id === groups.id)!.standings!;
  expect(standings).toHaveLength(8);
  expect(standings.every((r) => r.played === 3 && r.wins + r.losses === 3)).toBe(true);
  expect(standings.filter((r) => r.qualified)).toHaveLength(2);
  expect(standings.reduce((sum, r) => sum + r.mapDifference, 0)).toBe(0);
  expect(await db.match.count({ where: { tournamentId: f.id } })).toBe(17);
});

test('two-run raw qualifier scores are reviewed, finalized, published and seed a cutoff bracket', async ({
  page,
  browser,
  competition: f,
}, testInfo) => {
  test.setTimeout(240_000);
  await page.goto(`${f.root}/admin/stages`);
  await page.getByRole('button', { name: 'New stage', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New stage', exact: true });
  await dialog.getByLabel('Stage name', { exact: true }).fill('Qualifiers');
  await dialog.getByLabel('Stage type', { exact: true }).selectOption('QUALIFIERS');
  await dialog.getByText('Advanced stage settings', { exact: true }).click();
  await dialog.getByLabel('Seeding method', { exact: true }).selectOption('RAW_SCORE');
  await dialog.getByLabel('Playthroughs', { exact: true }).selectOption('2');
  await dialog.getByLabel('Run selection', { exact: true }).selectOption('BEST_PER_MAP');
  await dialog.getByLabel('Players counted per map', { exact: true }).fill('1');
  await expect(dialog.getByLabel('Best of', { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel(/scoring system|score mode/i)).toHaveCount(0);
  const stage = await uiAction<{ id: string }>(page, 'stage.save', () =>
    dialog.getByRole('button', { name: 'Save stage', exact: true }).click(),
  );
  await expect(dialog).toHaveCount(0);
  const qualifier = await db.tournamentStage.findUniqueOrThrow({ where: { id: stage.id } });
  expect(qualifier).toMatchObject({
    kind: 'QUALIFIERS',
    matchRules: null,
    qualifierPolicy: { method: 'RAW_SCORE', runs: 2, runSelection: 'BEST_PER_MAP' },
  });
  const maps = await db.mappoolSlot.findMany({
    where: { revision: { mappool: { stageId: f.stageId } } },
    orderBy: { position: 'asc' },
  });
  await publishPool(
    f.id,
    stage.id,
    maps.map((m) => m.beatmapId),
  );
  const session = await f.post({
    type: 'qualifier.create',
    code: 'Q1',
    stageId: stage.id,
    teamIds: f.entrants.map((e) => e.id),
    refereeIds: [f.ownerId],
    scheduledAt: '2030-01-01T12:00:00.000Z',
  });
  async function lobbyAction(type: string, fields = {}) {
    const lobby = await db.qualifierLobby.findUniqueOrThrow({ where: { id: session.id } });
    return f.post({ type, id: session.id, baseVersion: lobby.version, ...fields });
  }
  await lobbyAction('qualifier.lobby', { lobbyUrl: 'https://osu.ppy.sh/community/matches/123456' });
  await lobbyAction('qualifier.status', {
    command: 'START',
    reason: 'Begin isolated full-pool qualifier',
  });
  const lobby = await db.qualifierLobby.findUniqueOrThrow({ where: { id: session.id } });
  expect(lobby).toMatchObject({
    gameplayScoring: 'SCORE_V2',
    policy: { runs: 2, method: 'RAW_SCORE', requiredPlayers: 1 },
  });
  expect(lobby.rules).toMatchObject({
    gameplayScoring: 'SCORE_V2',
    scoreMode: 'SCORE_V2',
    teamMode: 'HEAD_TO_HEAD',
  });
  const incomplete = await f.request({
    type: 'qualifier.status',
    id: session.id,
    baseVersion: lobby.version,
    command: 'SUBMIT',
    reason: 'Incomplete qualifier must not submit',
  });
  expect(incomplete.status()).toBe(409);
  expect((await incomplete.json()).error).toContain('complete eligible qualifier run');
  // Run 1 wins NM1, Run 2 wins NM2. Better qualifier seeds deliberately reverse registration seeds.
  for (const [index, entrant] of f.entrants.entries())
    for (const run of [1, 2])
      for (const [mapIndex, map] of maps.entries())
        await lobbyAction('qualifier.score', {
          osuId: entrant.osuId,
          slotName: map.name,
          run,
          mods: ['NF'],
          representation: 'LEGACY',
          raw: 500_000 + index * 20_000 + ((mapIndex === 0 ? run === 1 : run === 2) ? 10_000 : 0),
          reason: 'Verified complete two-run E2E performance',
        });
  expect(await db.qualifierScore.count({ where: { lobbyId: session.id } })).toBe(32);
  await lobbyAction('qualifier.status', {
    command: 'SUBMIT',
    reason: 'Review all recorded maps and runs',
  });
  await page.goto(`${f.root}/admin/qualifier-results`);
  const review = page.getByRole('region', { name: 'Qualifier standings review', exact: true });
  await page.getByLabel('Qualifier stage', { exact: true }).selectOption(stage.id);
  await expect(review).toContainText('Provisional');
  await expect(review).toContainText('must be referee-confirmed');
  await lobbyAction('qualifier.status', {
    command: 'CONFIRM',
    reason: 'Referee verified both complete playthroughs',
  });
  await review.getByRole('button', { name: 'Refresh standings', exact: true }).click();
  await expect(review.getByText(/blocking issue/)).toHaveCount(0);
  await uiAction(page, 'qualifier.standings.calculate', () =>
    review.getByRole('button', { name: 'Calculate standings', exact: true }).click(),
  );
  await expect(
    review.getByRole('button', { name: 'Finalize seedings', exact: true }),
  ).toBeVisible();
  const provisional = await f.data<QualifierStandingsData>(
    `qualifier-standings&stageId=${stage.id}`,
  );
  expect(provisional.latest!.snapshot.state).toBe('PROVISIONAL');
  expect(provisional.preview.canFinalize).toBe(true);
  expect(provisional.preview.rows.map((r) => r.participantId)).toEqual(
    f.entrants.toReversed().map((e) => e.id),
  );
  for (const row of provisional.preview.rows) {
    const index = f.entrants.findIndex((e) => e.id === row.participantId);
    expect(row.value).toBe(1_020_000 + index * 40_000);
    expect(row.selected.map((s) => [s.slotName, s.run])).toEqual([
      ['NM1', 1],
      ['NM2', 2],
    ]);
  }
  const guests = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const publicPage = await guests.newPage();
    await publicPage.goto(`${f.root}/qualifiers`);
    await expect(
      publicPage.getByText('No qualifier results published yet.', { exact: true }),
    ).toBeVisible();
    await review.getByLabel('Advancement cutoff', { exact: true }).fill('4');
    await expect(
      review.getByRole('button', { name: 'Finalize seedings', exact: true }),
    ).toBeDisabled();
    await review
      .getByRole('checkbox', {
        name: 'Reviewed source scores, run selection and final seed order',
        exact: true,
      })
      .check();
    await uiAction(page, 'qualifier.standings.finalize', () =>
      review.getByRole('button', { name: 'Finalize seedings', exact: true }).click(),
    );
    await expect(review.getByRole('status')).toContainText('Finalized');
    await uiAction(page, 'qualifier.standings.publish', () =>
      review.getByRole('button', { name: 'Publish standings', exact: true }).click(),
    );
    await expect(review.getByRole('status')).toContainText('Published');
    const finalized = (
      await f.data<QualifierStandingsData>(`qualifier-standings&stageId=${stage.id}`)
    ).latest!;
    expect(finalized.snapshot.seeds.filter((s) => s.qualified).map((s) => s.teamId)).toEqual(
      f.entrants
        .toReversed()
        .slice(0, 4)
        .map((e) => e.id),
    );
    expect(await db.qualifierStanding.count({ where: { tournamentId: f.id } })).toBe(2);
    await publicPage.reload();
    const publicStandings = publicPage.getByRole('region', {
      name: 'Qualifiers standings',
      exact: true,
    });
    await expect(publicStandings.getByRole('row').filter({ hasText: 'Below cutoff' })).toHaveCount(
      4,
    );
    await expect(publicStandings.getByRole('row').filter({ hasText: 'Qualified' })).toHaveCount(4);
    for (const name of ['Calculate standings', 'Finalize seedings', 'Publish standings'])
      await expect(publicPage.getByRole('button', { name, exact: true })).toHaveCount(0);
    await screenshotLayouts(publicPage, guests, testInfo, 'public-qualifiers', publicStandings);
    await screenshotLayouts(page, page.context(), testInfo, 'admin-qualifiers', review);

    const seeded = await generateInUI(page, f, 'Qualified bracket', finalized.id);
    const qualifiedIds = f.entrants
      .toReversed()
      .slice(0, 4)
      .map((e) => e.id);
    expect(seeded.sourceStandingId).toBe(finalized.id);
    expect(seeded.entries.map((e) => e.teamId)).toEqual(qualifiedIds);
    expect(seeded.nodes.filter((n) => n.matchId).map((n) => n.slots.map((s) => s.teamId))).toEqual([
      [qualifiedIds[0], qualifiedIds[3]],
      [qualifiedIds[1], qualifiedIds[2]],
    ]);
    const invalid = await f.request(
      bracketInput(f, 'Below cutoff attempt', { sourceStandingId: finalized.id }),
    );
    expect(invalid.status()).toBe(400);
    const completedLobby = await db.qualifierLobby.findUniqueOrThrow({ where: { id: session.id } });
    const reopen = await f.request({
      type: 'qualifier.status',
      id: session.id,
      baseVersion: completedLobby.version,
      command: 'REOPEN',
      reason: 'Must not silently invalidate finalized seeds',
    });
    expect(reopen.status()).toBe(409);
    expect((await reopen.json()).error).toMatch(/finalized|locked|review/i);
    expect((await bracket(seeded.id)).seedOrder).toEqual(qualifiedIds);
    expect(
      await db.qualifierScore.count({
        where: {
          lobbyId: session.id,
          actualScoring: 'SCORE_V2',
          representation: 'LEGACY',
          source: 'MANUAL',
          verified: true,
        },
      }),
    ).toBe(32);
    expect(await db.team.count({ where: { tournamentId: f.id, status: 'APPROVED' } })).toBe(8);
    expect(
      await db.qualifierEvent.count({ where: { lobbyId: session.id } }),
    ).toBeGreaterThanOrEqual(37);

    const sourceScores = await db.qualifierScore.findMany({
      where: { lobbyId: session.id },
      orderBy: { id: 'asc' },
    });
    await page.goto(`${f.root}/admin/qualifier-results`);
    await page.getByLabel('Qualifier stage', { exact: true }).selectOption(stage.id);
    await review.getByRole('button', { name: 'Review correction', exact: true }).click();
    const correction = page.getByRole('dialog', { name: 'Reopen qualifier results', exact: true });
    await expect(correction.getByRole('row').filter({ hasText: 'Qualified bracket' })).toHaveCount(
      1,
    );
    const approve = correction.getByRole('button', { name: 'Reopen for correction', exact: true });
    await expect(approve).toBeDisabled();
    const reason =
      'Reviewed source correction; preserve downstream participants and historical seeds';
    await correction.getByLabel('Correction reason', { exact: true }).fill(reason);
    await expect(approve).toBeDisabled();
    await correction
      .getByRole('checkbox', {
        name: 'Reviewed every affected bracket and approved invalidating its existing qualifier seed witness',
        exact: true,
      })
      .check();
    await expect(approve).toBeEnabled();
    const screenshotPath = testInfo.outputPath('qualifier-correction-review.png');
    await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });
    await testInfo.attach('qualifier-correction-review', {
      path: screenshotPath,
      contentType: 'image/png',
    });
    await uiAction(page, 'qualifier.standings.reopen', () => approve.click());
    await expect(correction).toHaveCount(0);
    await expect(review.getByRole('status')).toContainText('Reopened for correction');
    const reviewed = (
      await f.data<QualifierStandingsData>(`qualifier-standings&stageId=${stage.id}`)
    ).latest!;
    expect(reviewed.version).toBe(finalized.version + 1);
    expect(reviewed.snapshot).toMatchObject({
      state: 'REOPENED',
      correctionReview: { standingId: finalized.id, reason, actorId: f.ownerId },
    });
    const historicalStanding = await db.qualifierStanding.findUniqueOrThrow({
      where: { id: finalized.id },
    });
    expect(historicalStanding.snapshot).toEqual(finalized.snapshot);
    expect(historicalStanding.published).toBe(false);
    expect(
      await db.qualifierScore.findMany({ where: { lobbyId: session.id }, orderBy: { id: 'asc' } }),
    ).toEqual(sourceScores);
    expect(await bracket(seeded.id)).toEqual(seeded);
    await publicPage.reload();
    await expect(
      publicPage.getByText('No qualifier results published yet.', { exact: true }),
    ).toBeVisible();
    const firstSeededMatch = seeded.nodes.find((node) => node.matchId)!.match!;
    const staleStart = await f.request({
      type: 'match.start',
      id: firstSeededMatch.id,
      baseVersion: firstSeededMatch.version,
    });
    expect(staleStart.status()).toBe(409);
    expect((await staleStart.json()).error).toMatch(/reopened|superseded|reconcil/i);
    expect(await bracket(seeded.id)).toEqual(seeded);
    expect(
      await db.auditLog.count({
        where: { tournamentId: f.id, action: 'qualifier.standings.reopen' },
      }),
    ).toBe(1);
  } finally {
    await guests.close();
  }
});
