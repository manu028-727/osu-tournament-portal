import { test, expect, type BrowserContext } from '@playwright/test';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { inheritedRules } from '../../src/lib/gameplay-scoring';
import { qualifierPolicySchema } from '../../src/lib/qualifier-policy';
import { rpcHeaders } from '../../src/lib/irc-security';
import { createGateway } from '../../services/irc/gateway';
import { mockBancho } from '../helpers/mock-bancho';
const url = process.env.TEST_DATABASE_URL!;
if (new URL(url).pathname !== '/tournament_platform_test')
  throw Error('Isolated test database required');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const slug = `qbrowser-${randomUUID()}`;
const root = `/t/${slug}`;
const accounts: { id: string; osuId: number; username: string; token: string }[] = [];
let lobbyId: string, bookingId: string, externalStageId: string;
const rules = inheritedRules({ teamSize: 1, multiplierMode: 'NONE' }, 'SCORE_V2');
const policy = qualifierPolicySchema.parse({ requiredPlayers: 1, runs: 2 });
const evidence = '.data/qualifier-audit-20261030';
async function login(context: BrowserContext, index: number) {
  await context.addCookies([
    {
      name: 'tournament_session',
      value: accounts[index].token,
      url: 'http://localhost:3001',
      httpOnly: true,
      sameSite: 'Lax',
    },
    { name: 'portal_language', value: 'en', url: 'http://localhost:3001' },
  ]);
}
async function admin(context: BrowserContext, input: object) {
  const response = await context.request.post(`/api/admin/action?tournament=${slug}`, {
    headers: { Origin: 'http://localhost:3001' },
    data: input,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true });
  await db.tournament.create({
    data: {
      id: slug,
      slug,
      name: 'Shared Qualifiers Community Championship',
      acronym: 'SQC',
      description: '',
      published: true,
      format: 'SOLO',
      status: 'REGISTRATIONS_OPEN',
      settings: {
        create: {
          banner: '',
          gameplayScoring: 'SCORE_V2',
          matchRules: rules,
          socialLinks: [],
          importantDates: [],
          navigation: [
            { href: '/', label: 'Home' },
            { href: '/teams', label: 'Teams' },
          ],
          footer: '',
        },
      },
    },
  });
  for (let index = 0; index < 4; index++) {
    const token = randomBytes(32).toString('base64url');
    const user = await db.user.create({
      data: {
        osuId: randomInt(1_830_000_000, 1_840_000_000),
        username: index ? `Player ${index}` : 'Qualifier Organizer',
        avatarUrl: 'https://a.ppy.sh/1',
        profileUrl: '',
        platformAdmin: !index,
        sessions: {
          create: {
            id: createHash('sha256').update(token).digest('hex'),
            expiresAt: new Date(Date.now() + 3600000),
          },
        },
      },
    });
    accounts.push({ ...user, token });
    if (index && index < 3)
      await db.participant.create({
        data: {
          osuId: user.osuId,
          username: user.username,
          avatarUrl: 'https://a.ppy.sh/1',
          country: 'IT',
        },
      });
    if (index && index < 3)
      await db.team.create({
        data: {
          tournamentId: slug,
          name: index === 1 ? 'Northern Lights Community' : 'Southern Stars Community',
          slug: `entrant-${index}`,
          status: 'APPROVED',
          published: true,
          format: 'INDIVIDUAL',
          members: { create: { osuId: user.osuId, captain: true, position: 0 } },
          registrationAnswers: { contact: 'Private captain answer' },
        },
      });
  }
  const role = await db.role.create({
    data: {
      tournamentId: slug,
      name: 'Qualifier referee',
      permissions: {
        create: ['matches.view', 'matches.manage'].map((permissionKey) => ({ permissionKey })),
      },
    },
  });
  await db.userRole.create({
    data: { tournamentId: slug, roleId: role.id, userId: accounts[0].id },
  });
  const beatmaps = await db.beatmap.findMany({ where: { mode: 'osu' }, take: 2 });
  for (let index = 0; index < 3; index++) {
    const stage = await db.tournamentStage.create({
      data: {
        tournamentId: slug,
        slug: `qualifier-${index}`,
        name:
          index === 2
            ? 'Imported qualifier stage'
            : index
              ? 'Second qualifier booking stage'
              : 'Shared Qualifiers',
        kind: 'QUALIFIERS',
        matchRules: rules,
        qualifierPolicy: policy,
      },
    });
    const pool = await db.mappool.create({ data: { tournamentId: slug, stageId: stage.id } });
    const revision = await db.mappoolRevision.create({
      data: {
        tournamentId: slug,
        mappoolId: pool.id,
        slots: {
          create: beatmaps.map((beatmap, position) => ({
            name: `NM${position + 1}`,
            category: 'NM',
            categoryName: 'No Mod',
            color: '#90bdf4',
            position,
            beatmapId: beatmap.id,
            metadata: beatmap.metadata!,
          })),
        },
      },
    });
    await db.mappool.update({
      where: { id: pool.id },
      data: { state: 'PUBLISHED', publishedRevisionId: revision.id },
    });
    if (index === 2) {
      externalStageId = stage.id;
      continue;
    }
    const lobby = await db.qualifierLobby.create({
      data: {
        tournamentId: slug,
        stageId: stage.id,
        code: index ? 'Booking session' : 'Empty shared session',
        poolRevisionId: revision.id,
        rules,
        policy,
        gameplayScoring: 'SCORE_V2',
        participants: [],
        scheduledAt: new Date(Date.now() + (index + 1) * 86400000),
        capacity: 2,
        assignments: { create: { userId: accounts[0].id } },
      },
    });
    if (index) bookingId = lobby.id;
    else lobbyId = lobby.id;
  }
  if (process.env.E2E_OSU_FIXTURE_DIR) {
    await mkdir(process.env.E2E_OSU_FIXTURE_DIR, { recursive: true });
    for (const user of accounts)
      await writeFile(
        `${process.env.E2E_OSU_FIXTURE_DIR}/user-${user.osuId}.json`,
        JSON.stringify({
          id: user.osuId,
          username: user.username,
          avatar_url: 'https://a.ppy.sh/1',
          country_code: 'IT',
          statistics: { global_rank: 5000 },
        }),
      );
    const events = [0, 0, 1, 0, 1].map((slot, index) => ({
      id: index + 1,
      game: {
        id: 990010 + index,
        beatmap_id: beatmaps[slot].id,
        start_time: new Date(Date.UTC(2026, 9, 20, 12, index * 3)).toISOString(),
        end_time: new Date(Date.UTC(2026, 9, 20, 12, index * 3 + 2)).toISOString(),
        mode: 'osu',
        scoring_type: 'scorev2',
        mods: ['NF'],
        scores: accounts.slice(1, 3).map((user, player) => ({
          user_id: user.osuId,
          score: index * 100000 + player * 10000,
          mods: [],
          match: { team: player ? 'red' : 'blue' },
        })),
      },
    }));
    await writeFile(
      `${process.env.E2E_OSU_FIXTURE_DIR}/match-990001.json`,
      JSON.stringify({
        match: { id: 990001, name: 'Shared external qualifier' },
        first_event_id: 1,
        events,
      }),
    );
  }
});
test.afterAll(async () => {
  const where = { tournamentId: slug };
  await db.qualifierStanding.deleteMany({ where });
  await db.qualifierLobby.deleteMany({ where });
  await db.refereeImport.deleteMany({ where });
  await db.team.deleteMany({ where });
  await db.mappool.updateMany({
    where,
    data: { draftRevisionId: null, publishedRevisionId: null },
  });
  await db.mappoolSlot.deleteMany({ where: { revision: where } });
  await db.mappoolRevision.deleteMany({ where });
  await db.mappool.deleteMany({ where });
  await db.tournamentStage.deleteMany({ where });
  await db.auditLog.deleteMany({ where });
  await db.role.deleteMany({ where });
  await db.tournament.deleteMany({ where: { id: slug } });
  await db.user.deleteMany({ where: { id: { in: accounts.map((user) => user.id) } } });
  await db.participant.deleteMany({
    where: { osuId: { in: accounts.slice(1).map((user) => user.osuId) } },
  });
  await db.$disconnect();
  if (process.env.E2E_OSU_FIXTURE_DIR)
    for (const user of accounts)
      await rm(`${process.env.E2E_OSU_FIXTURE_DIR}/user-${user.osuId}.json`, { force: true });
});
test.describe.configure({ mode: 'serial' });
test('opens an empty referee session, assigns entrants and records shared map scores inline', async ({
  page,
  context,
}) => {
  await login(context, 0);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${root}/admin/referee/qualifiers/${lobbyId}`);
  await expect(page.getByText('No entrants assigned yet')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Start qualifier lobby', exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: `${evidence}/empty-session.png`, fullPage: true });
  await page.getByRole('button', { name: 'Assign entrants', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Assign qualifier entrants' });
  await dialog.getByLabel('Select all source entrants').check();
  await dialog.getByRole('button', { name: /Assign 2 entrants/ }).click();
  await expect(dialog).toBeHidden();
  const lobby = await db.qualifierLobby.findUniqueOrThrow({ where: { id: lobbyId } });
  await admin(context, {
    type: 'qualifier.status',
    id: lobbyId,
    baseVersion: lobby.version,
    command: 'START',
    reason: 'Synthetic browser session start',
  });
  await page.reload();
  const board = page.getByRole('region', { name: 'Shared qualifier map scores' });
  await board.getByLabel('Score for Player 1', { exact: true }).fill('0');
  await board.getByLabel('Score for Player 2', { exact: true }).fill('123456');
  await board.getByRole('button', { name: 'Save map scores' }).click();
  await expect(board.getByRole('heading', { name: 'Run 1 · NM2' })).toBeVisible();
  await page.getByRole('button', { name: 'Select qualifier map NM1' }).click();
  await expect(board.getByText('2/2 entrants complete')).toBeVisible();
  expect(await db.qualifierScore.count({ where: { lobbyId, run: 1, slotName: 'NM1' } })).toBe(2);
  expect(
    (await db.qualifierScore.findFirstOrThrow({ where: { lobbyId, osuId: accounts[1].osuId } }))
      .raw,
  ).toBe(0);
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme as 'light' | 'dark', reducedMotion: 'reduce' });
    for (const width of [1920, 1366, 1024, 844, 768, 683, 390, 375, 320]) {
      await page.setViewportSize({ width, height: width === 844 ? 390 : 900 });
      await page.evaluate(() => {
        (document.activeElement as HTMLElement)?.blur();
        window.scrollTo(0, 0);
      });
      await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
      await page.screenshot({ path: `${evidence}/session-${theme}-${width}.png`, fullPage: true });
    }
  }
  await page.getByRole('button', { name: 'Select qualifier map NM2' }).click();
  await expect(board.getByRole('heading', { name: 'Run 1 · NM2' })).toBeVisible();
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.getByRole('button', { name: 'Select qualifier map NM1' }).click();
  await expect(board.getByRole('heading', { name: 'Run 1 · NM1' })).toBeVisible();
  await page.getByRole('button', { name: 'Next map', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Shared qualifier map scores' })
      .getByRole('heading', { name: 'Run 1 · NM2' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Interface language' }).click();
  await page.getByRole('menuitemradio', { name: 'Italiano' }).click();
  await page.getByRole('button', { name: 'Seleziona mappa delle qualifiche NM1' }).click();
  await expect(page.getByRole('heading', { name: /Valore della squadra: 123\.456/ })).toBeVisible();
  for (const width of [1366, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
    await page.screenshot({ path: `${evidence}/session-italian-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Seleziona mappa delle qualifiche NM2' }).click();
  expect(errors).toEqual([]);
});
test('lets a captain book and cancel an existing session without workspace permissions', async ({
  page,
  context,
}) => {
  await login(context, 1);
  await page.goto(`${root}/register`);
  await expect(
    page.getByRole('heading', { name: 'Registration and qualifiers', exact: true }),
  ).toBeVisible();
  const session = page.locator('article').filter({ hasText: 'Booking session' });
  await session.getByRole('button', { name: 'Reserve session' }).click();
  await expect(session.getByText('Your reservation', { exact: false })).toBeVisible();
  expect(await db.qualifierEntry.count({ where: { lobbyId: bookingId } })).toBe(1);
  await session.getByRole('button', { name: 'Cancel reservation' }).click();
  await expect(session.getByRole('button', { name: 'Reserve session' })).toBeVisible();
  expect(await db.userRole.count({ where: { userId: accounts[1].id } })).toBe(0);
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [1920, 1366, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
      await page.screenshot({ path: `${evidence}/captain-${theme}-${width}.png`, fullPage: true });
    }
  }
  await page.goto(`${root}/teams`);
  await expect(
    page.getByRole('link', { name: 'Manage registration and qualifier booking' }),
  ).toHaveAttribute('href', `${root}/register`);
  await expect(page.locator('body')).not.toContainText('Private captain answer');
});
test('edits existing sessions inline and deletes single/bulk sessions without erasing history', async ({
  page,
  context,
}) => {
  await login(context, 0);
  const ids: string[] = [];
  for (const code of ['Session A', 'Session B', 'Session C']) {
    const result = await admin(context, {
      type: 'qualifier.create',
      code,
      stageId: externalStageId,
      teamIds: [],
      refereeIds: [],
      scheduledAt: null,
    });
    ids.push(result.id);
  }
  await page.goto(`${root}/admin/referee/qualifiers`);
  const row = page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: 'Session A', exact: true }) });
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await admin(context, {
    type: 'qualifier.edit',
    id: ids[0],
    baseVersion: 1,
    code: 'Session A',
    notes: 'Refreshed notes from another organizer',
  });
  await expect(page.getByLabel('Notes', { exact: true }).first()).toHaveValue(
    'Refreshed notes from another organizer',
    { timeout: 10000 },
  );
  await page.getByLabel('Lobby code', { exact: true }).fill('Renamed session');
  page.once('dialog', (dialog) => dialog.dismiss());
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel('Lobby code', { exact: true })).toHaveValue('Renamed session');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Renamed session', exact: true })).toBeVisible();
  await expect(
    page.getByText(
      'A selected lobby changed or is no longer scheduled. Close and review the selection.',
      { exact: true },
    ),
  ).toHaveCount(0);
  await page.goto(`${root}/admin/referee/qualifiers/${ids[0]}`);
  await page.getByText('Session settings and deletion', { exact: true }).click();
  await page.getByRole('button', { name: 'Delete sessions', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete qualifier sessions' });
  await confirmation.getByLabel('Reason', { exact: true }).fill('Remove unused session');
  await confirmation.getByRole('button', { name: 'Delete sessions', exact: true }).click();
  await expect(
    page.getByText('Deleted session. Scores and referee histories are preserved.', { exact: true }),
  ).toBeVisible();
  await page.goto(`${root}/admin/referee/qualifiers`);
  await expect(page.getByRole('link', { name: 'Renamed session', exact: true })).toHaveCount(0);
  for (const code of ['Session B', 'Session C'])
    await page.getByLabel(`Select qualifier ${code}`, { exact: true }).check();
  await page
    .getByRole('toolbar', { name: 'Qualifier bulk actions' })
    .getByRole('button', { name: 'Delete sessions', exact: true })
    .click();
  await confirmation.getByLabel('Reason', { exact: true }).fill('Remove unused session batch');
  await confirmation.getByRole('button', { name: 'Delete sessions', exact: true }).click();
  await expect(confirmation).toBeHidden();
  expect(
    await db.qualifierLobby.count({ where: { id: { in: ids }, deletedAt: { not: null } } }),
  ).toBe(3);
  expect(
    await db.qualifierEvent.count({ where: { lobbyId: { in: ids }, kind: 'qualifier.delete' } }),
  ).toBe(3);
  await page.getByLabel('Filter qualifier lobbies').selectOption('deleted');
  await expect(page.getByRole('link', { name: 'Renamed session', exact: true })).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [1920, 1366, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
      await page.screenshot({
        path: `${evidence}/session-list-${theme}-${width}.png`,
        fullPage: true,
      });
    }
  }
});
test('reviews individual Freemod exceptions in bulk and automatically completes an eligible run', async ({
  page,
  context,
}) => {
  test.skip(!process.env.E2E_OSU_FIXTURE_DIR, 'Requires the explicit synthetic osu! provider.');
  await login(context, 0);
  const beatmap = await db.beatmap.findFirstOrThrow({ where: { mode: 'osu' } });
  const fmRules = inheritedRules(
    { teamSize: 1, multiplierMode: 'NONE', freeModRequiredHD: 0, freeModRequiredHR: 0 },
    'SCORE_V2',
  );
  const stage = await db.tournamentStage.create({
    data: {
      tournamentId: slug,
      slug: 'exceptions',
      name: 'Qualifier exception review',
      kind: 'QUALIFIERS',
      matchRules: fmRules,
      qualifierPolicy: policy,
    },
  });
  const pool = await db.mappool.create({ data: { tournamentId: slug, stageId: stage.id } });
  const revision = await db.mappoolRevision.create({
    data: {
      tournamentId: slug,
      mappoolId: pool.id,
      slots: {
        create: [
          {
            name: 'FM1',
            category: 'FM',
            categoryName: 'FreeMod',
            color: '#f2a6cf',
            position: 0,
            beatmapId: beatmap.id,
            metadata: beatmap.metadata!,
          },
        ],
      },
    },
  });
  await db.mappool.update({
    where: { id: pool.id },
    data: { state: 'PUBLISHED', publishedRevisionId: revision.id },
  });
  await writeFile(
    `${process.env.E2E_OSU_FIXTURE_DIR}/match-990002.json`,
    JSON.stringify({
      match: { id: 990002, name: 'Individual Freemod exceptions' },
      first_event_id: 1,
      events: [
        {
          id: 1,
          game: {
            id: 9900021,
            beatmap_id: beatmap.id,
            start_time: '2026-10-20T12:00:00Z',
            end_time: '2026-10-20T12:03:00Z',
            mode: 'osu',
            scoring_type: 'scorev2',
            mods: ['NF'],
            scores: [
              { user_id: accounts[1].osuId, score: 100, mods: ['HD'] },
              { user_id: accounts[2].osuId, score: 200, mods: ['DT'] },
            ],
          },
        },
      ],
    }),
  );
  const previewResponse = await context.request.post(
    `/api/admin/qualifier-import?tournament=${slug}`,
    {
      headers: { Origin: 'http://localhost:3001' },
      data: { stageId: stage.id, links: ['https://osu.ppy.sh/mp/990002'] },
    },
  );
  expect(previewResponse.ok(), await previewResponse.text()).toBe(true);
  const preview = await previewResponse.json();
  const appliedResponse = await context.request.post(
    `/api/admin/qualifier-import?tournament=${slug}`,
    {
      headers: { Origin: 'http://localhost:3001' },
      data: {
        stageId: stage.id,
        jobId: preview.jobId,
        fingerprint: preview.fingerprint,
        apply: true,
      },
    },
  );
  expect(appliedResponse.ok(), await appliedResponse.text()).toBe(true);
  const applied = await appliedResponse.json();
  const id = applied.sessions[0];
  await page.goto(`${root}/admin/referee/qualifiers/${id}`);
  const exceptions = page.getByRole('region', { name: 'Qualifier exceptions' });
  await expect(
    exceptions.getByText('This mod is not allowed in FreeMod.', { exact: true }),
  ).toBeVisible();
  for (const width of [1366, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
    await page.screenshot({ path: `${evidence}/exceptions-${width}.png`, fullPage: true });
  }
  await exceptions.getByLabel('Select all excluded scores', { exact: true }).check();
  await exceptions
    .getByLabel('Override reason', { exact: true })
    .fill('Organizer reviewed and accepted individual exception');
  await exceptions.getByRole('button', { name: 'Include 1 selected scores', exact: true }).click();
  await expect(
    page.getByText(
      'Complete eligible run verified. Optional runs can still synchronize. IRC stays open; official seedings are finalized separately.',
      { exact: true },
    ),
  ).toBeVisible();
  expect(await db.qualifierScore.count({ where: { lobbyId: id, eligible: true } })).toBe(2);
  const providerFile = `${process.env.E2E_OSU_FIXTURE_DIR}/match-990002.json`;
  const providerHistory = JSON.parse(await readFile(providerFile, 'utf8'));
  providerHistory.events.push({
    id: 2,
    game: {
      ...providerHistory.events[0].game,
      id: 9900022,
      start_time: new Date(Date.now() + 60000).toISOString(),
      end_time: null,
      scores: [],
    },
  });
  await writeFile(providerFile, JSON.stringify(providerHistory));
  await page.reload();
  await page.getByText('Session settings and deletion', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete sessions', exact: true })).toBeDisabled();
  const pendingLobby = await db.qualifierLobby.findUniqueOrThrow({ where: { id } });
  const blockedDelete = await context.request.post(`/api/admin/action?tournament=${slug}`, {
    headers: { Origin: 'http://localhost:3001' },
    data: {
      type: 'qualifier.delete',
      lobbies: [{ id, baseVersion: pendingLobby.version }],
      confirm: true,
      reason: 'Do not strand optional-run scores',
    },
  });
  expect(blockedDelete.status()).toBe(409);
  providerHistory.events[1].game.end_time = new Date(Date.now() + 120000).toISOString();
  providerHistory.events[1].game.scores = providerHistory.events[0].game.scores.map(
    (score: { user_id: number }, index: number) => ({
      user_id: score.user_id,
      score: 300 + index * 100,
      mods: index ? ['HR'] : ['HD'],
    }),
  );
  await writeFile(providerFile, JSON.stringify(providerHistory));
  await page.reload();
  await page.getByText('Session settings and deletion', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete sessions', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Delete sessions', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete qualifier sessions' });
  await confirmation
    .getByLabel('Reason', { exact: true })
    .fill('Remove completed session from operations');
  await confirmation.getByRole('button', { name: 'Delete sessions', exact: true }).click();
  await expect(
    page.getByText('Deleted session. Scores and referee histories are preserved.', { exact: true }),
  ).toBeVisible();
  expect(await db.qualifierScore.count({ where: { lobbyId: id } })).toBe(4);
  expect(await db.qualifierGame.count({ where: { lobbyId: id } })).toBe(2);
});
test('operates qualifier map, mods and player controls through the existing IRC gateway', async ({
  page,
  context,
}) => {
  test.skip(
    process.env.IRC_ENABLED !== 'true',
    'Synthetic IRC integration requires IRC_ENABLED=true.',
  );
  await login(context, 0);
  if (!process.env.E2E_OSU_FIXTURE_DIR)
    await page.route('**/api/admin/qualifier-multiplayer*', (route) =>
      route.fulfill({ json: { complete: true, imported: 0, skipped: 0 } }),
    );
  const secret = process.env.IRC_GATEWAY_SECRET!;
  const mock = mockBancho();
  mock.server.listen(0, '127.0.0.1');
  await once(mock.server, 'listening');
  const gateway = createGateway({
    origin: 'http://localhost:3001',
    secret,
    host: '127.0.0.1',
    port: (mock.server.address() as AddressInfo).port,
    async rpc(identity, operation, extra) {
      const body = JSON.stringify({ identity, operation, ...extra });
      const response = await fetch('http://localhost:3001/api/internal/irc', {
        method: 'POST',
        headers: rpcHeaders(body, secret),
        body,
      });
      if (!response.ok) throw Error(`Qualifier IRC authorization failed: ${response.status}`);
      return response.json();
    },
  });
  gateway.server.listen(0, '127.0.0.1');
  await once(gateway.server, 'listening');
  try {
    await page.routeWebSocket('**/api/irc/socket', (route) => {
      const socket = new WebSocket(
        `ws://127.0.0.1:${(gateway.server.address() as AddressInfo).port}/api/irc/socket`,
        { origin: 'http://localhost:3001' },
      );
      route.onMessage((message) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(message);
        else socket.once('open', () => socket.send(message));
      });
      socket.on('message', (data) => route.send(data.toString()));
      socket.on('close', () => route.close());
      socket.on('error', () => route.close());
      route.onClose(() => socket.close());
    });
    await page.goto(`${root}/admin/referee/qualifiers/${lobbyId}`);
    const panel = page
      .locator('details')
      .filter({ has: page.locator('summary').filter({ hasText: 'Bancho IRC' }) });
    await panel.locator('summary').click();
    await panel.getByRole('button', { name: 'Open IRC', exact: true }).click();
    await panel.getByRole('checkbox').check();
    await panel
      .getByLabel('Separate osu! IRC password', { exact: true })
      .fill('separate-test-irc-password');
    await panel.getByRole('button', { name: 'Connect to Bancho', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText(/· connected$/);
    await panel.getByRole('button', { name: 'Create lobby', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Link to qualifier session' })).toBeVisible();
    if (process.env.E2E_OSU_FIXTURE_DIR) {
      const lobby = await db.qualifierLobby.findUniqueOrThrow({
        where: { id: lobbyId },
        include: { poolRevision: { include: { slots: true } } },
      });
      const slot = lobby.poolRevision.slots.find((slot) => slot.name === 'NM2')!;
      await writeFile(
        `${process.env.E2E_OSU_FIXTURE_DIR}/match-101.json`,
        JSON.stringify({
          match: { id: 101, name: 'Website shared qualifier' },
          first_event_id: 1,
          events: [
            {
              id: 1,
              game: {
                id: 990100,
                beatmap_id: slot.beatmapId,
                start_time: new Date(Date.now() - 1000).toISOString(),
                end_time: new Date().toISOString(),
                mode: 'osu',
                scoring_type: 'scorev2',
                mods: ['NF'],
                scores: [
                  { user_id: accounts[1].osuId, score: 345000, mods: [] },
                  { user_id: accounts[2].osuId, score: 0, mods: [] },
                ],
              },
            },
          ],
        }),
      );
    }
    await panel.getByRole('button', { name: 'Link to qualifier session' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await db.qualifierLobby.findUniqueOrThrow({ where: { id: lobbyId } })).lobbyUrl,
      )
      .toContain('/101');
    if (process.env.E2E_OSU_FIXTURE_DIR) {
      await expect
        .poll(() =>
          db.qualifierScore.count({
            where: { lobbyId, slotName: 'NM2', run: 1, source: 'OSU_API' },
          }),
        )
        .toBe(2);
      expect(
        (
          await db.qualifierScore.findFirstOrThrow({
            where: { lobbyId, osuId: accounts[2].osuId, slotName: 'NM2', run: 1 },
          })
        ).raw,
      ).toBe(0);
    }
    await panel.getByRole('button', { name: 'Join lobby', exact: true }).click();
    await panel.getByRole('button', { name: 'Load map and mods', exact: true }).click();
    await expect
      .poll(() => mock.lines.some((line) => line.includes('PRIVMSG #mp_101 :!mp map ')))
      .toBe(true);
    await expect
      .poll(() => mock.lines.some((line) => line.includes('PRIVMSG #mp_101 :!mp mods ')))
      .toBe(true);
    await panel
      .getByLabel('Player to invite', { exact: true })
      .selectOption(String(accounts[1].osuId));
    await panel.getByRole('button', { name: 'Invite selected player', exact: true }).click();
    await expect
      .poll(() => mock.lines.some((line) => line.endsWith(`!mp invite #${accounts[1].osuId}`)))
      .toBe(true);
    await panel
      .getByRole('button', { name: 'Remove selected player from lobby', exact: true })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect
      .poll(() => mock.lines.some((line) => line.endsWith(`!mp kick #${accounts[1].osuId}`)))
      .toBe(true);
    await page.screenshot({ path: `${evidence}/qualifier-irc.png`, fullPage: true });
  } finally {
    await gateway.close();
    await mock.close();
  }
});
test('registers through the real website API and publishes organizer rejection reasons', async ({
  page,
  context,
  browser,
}) => {
  test.skip(!process.env.E2E_OSU_FIXTURE_DIR, 'Requires the explicit synthetic osu! provider.');
  await login(context, 3);
  await page.goto(`${root}/register`);
  await page.getByLabel('Entry name', { exact: true }).fill('New Native Solo Entrant');
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  await page.getByText('Roster and registration details', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save registration', exact: true })).toBeVisible();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  const team = await db.team.findFirstOrThrow({
    where: { tournamentId: slug, members: { some: { osuId: accounts[3].osuId } } },
  });
  expect(team.status).toBe('APPROVED');
  expect(team.published).toBe(true);
  expect(await db.userRole.count({ where: { userId: accounts[3].id } })).toBe(0);
  const organizer = await browser.newContext({ baseURL: 'http://localhost:3001' });
  try {
    await login(organizer, 0);
    await admin(organizer, {
      type: 'team.status',
      id: team.id,
      baseVersion: team.version,
      status: 'REJECTED',
      published: true,
      rejectionReason: 'Public eligibility decision',
    });
    await db.team.update({
      where: { id: team.id },
      data: { adminNotes: 'Never public administrative note' },
    });
  } finally {
    await organizer.close();
  }
  await page.goto(`${root}/teams`);
  await expect(
    page.getByText('Rejected: Public eligibility decision', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Never public administrative note');
  await page.screenshot({ path: `${evidence}/public-rejection.png`, fullPage: true });
});
test('previews actual provider histories, imports both runs and safely reimports after a correction', async ({
  page,
  context,
}) => {
  test.skip(!process.env.E2E_OSU_FIXTURE_DIR, 'Requires the explicit synthetic osu! provider.');
  await login(context, 0);
  await page.goto(`${root}/admin/qualifier-results`);
  await page.getByLabel('Qualifier stage', { exact: true }).selectOption(externalStageId);
  await page
    .getByRole('button', { name: 'Import qualifier multiplayer links', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Import qualifier multiplayer links' });
  await dialog
    .getByLabel('Multiplayer links (one per line)', { exact: true })
    .fill('https://osu.ppy.sh/mp/990001');
  await dialog.getByLabel('Warmup games per link', { exact: true }).fill('1');
  await dialog.getByRole('button', { name: 'Import available scores', exact: true }).click();
  await expect(dialog.getByText('Shared external qualifier', { exact: true })).toBeVisible();
  await expect(dialog.getByText('8 scores imported; 0 unchanged.', { exact: true })).toBeVisible();
  const lobby = await db.qualifierLobby.findFirstOrThrow({
    where: { tournamentId: slug, stageId: externalStageId, code: { startsWith: 'MP-' } },
  });
  expect(await db.qualifierScore.count({ where: { lobbyId: lobby.id } })).toBe(8);
  await admin(context, {
    type: 'qualifier.score',
    id: lobby.id,
    baseVersion: lobby.version,
    osuId: accounts[1].osuId,
    slotName: 'NM1',
    run: 1,
    raw: 777777,
    mods: ['NF'],
    reason: 'Website browser audit correction',
  });
  await dialog.getByRole('button', { name: 'Refresh import preview' }).click();
  await expect(dialog.getByRole('button', { name: 'Import reviewed histories' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Import reviewed histories' }).click();
  await expect(dialog.getByText('0 scores imported; 8 unchanged.', { exact: true })).toBeVisible();
  expect(
    (
      await db.qualifierScore.findFirstOrThrow({
        where: { lobbyId: lobby.id, osuId: accounts[1].osuId, slotName: 'NM1', run: 1 },
      })
    ).raw,
  ).toBe(777777);
  await page.screenshot({ path: `${evidence}/bulk-import-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 320, height: 900 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 320);
  await dialog.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: `${evidence}/bulk-import-mobile.png`, fullPage: true });
  const automaticSync = page.waitForResponse(
    (response) =>
      response.url().includes('/api/admin/qualifier-multiplayer') &&
      response.request().postDataJSON()?.sync === true,
  );
  await page.goto(`${root}/admin/referee/qualifiers/${lobby.id}`);
  const synced = await automaticSync;
  expect(synced.ok()).toBe(true);
  expect(await synced.json()).toMatchObject({ complete: true, imported: 0, rejected: [] });
  await page.getByRole('button', { name: 'Capture from osu!', exact: true }).click();
  const capture = page.getByRole('dialog', { name: 'Review qualifier capture', exact: true });
  await expect(capture.getByRole('option', { name: /Already imported/ })).toHaveCount(4);
  await expect(capture).not.toContainText('Game predates');
  await expect(capture.getByText('games need manual review', { exact: false })).toHaveCount(0);
  expect(await db.qualifierScore.count({ where: { lobbyId: lobby.id } })).toBe(8);
});
test('configures qualifier stages, finalizes actual imported standings and publishes a responsive public result', async ({
  page,
  context,
}) => {
  test.skip(!process.env.E2E_OSU_FIXTURE_DIR, 'Requires the explicit synthetic osu! provider.');
  await login(context, 0);
  await page.goto(`${root}/admin/mappools?view=stages`);
  await page
    .getByRole('button', {
      name: 'Edit advanced settings for Imported qualifier stage',
      exact: true,
    })
    .click();
  const settings = page.getByRole('dialog', { name: 'Stage settings', exact: true });
  await settings.getByLabel('Playthroughs', { exact: true }).selectOption('1');
  await expect(settings.getByLabel('Run selection', { exact: true })).toHaveCount(0);
  await settings.getByLabel('Playthroughs', { exact: true }).selectOption('2');
  await expect(settings.getByLabel('Run selection', { exact: true })).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [1920, 1366, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await settings.getByLabel('Pool aggregation', { exact: true }).scrollIntoViewIfNeeded();
      await expect(settings.getByLabel('Playthroughs', { exact: true })).toBeInViewport();
      await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
      await page.screenshot({
        path: `${evidence}/stage-policy-${theme}-${width}.png`,
        fullPage: true,
      });
    }
  }
  page.once('dialog', (dialog) => dialog.accept());
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(settings).toBeHidden();
  await page.goto(`${root}/admin/qualifier-results`);
  await page.getByLabel('Qualifier stage', { exact: true }).selectOption(externalStageId);
  await page.getByRole('button', { name: 'Calculate standings', exact: true }).click();
  await expect(page.getByText('Provisional standings saved.', { exact: true })).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [1920, 1366, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
      await page.screenshot({
        path: `${evidence}/standings-${theme}-${width}.png`,
        fullPage: true,
      });
    }
  }
  await page
    .getByLabel('Reviewed source scores, run selection and final seed order', { exact: true })
    .check();
  await page.getByRole('button', { name: 'Finalize seedings', exact: true }).click();
  await expect(page.getByText('Qualifier seedings finalized.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Publish standings', exact: true }).click();
  await expect(page.getByText('Standings published.', { exact: true })).toBeVisible();
  await page.goto(`${root}/qualifiers`);
  await expect(page.getByRole('rowheader', { name: /Northern Lights Community/ })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Private captain answer');
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [1920, 1366, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
      await page.screenshot({
        path: `${evidence}/public-standings-${theme}-${width}.png`,
        fullPage: true,
      });
      if (width === 320) {
        const scores = page.getByRole('region', { name: 'Qualifier standings table', exact: true });
        await scores.focus();
        for (let key = 0; key < 12; key++) {
          await page.keyboard.press('ArrowRight', { delay: 80 });
        }
        await expect(page.getByRole('cell', { name: '1,177,777', exact: true })).toBeInViewport({
          ratio: 1,
        });
        await page.screenshot({
          path: `${evidence}/public-score-column-${theme}-320.png`,
          fullPage: true,
        });
      }
    }
  }
  const imported = await db.qualifierLobby.findFirstOrThrow({
    where: { tournamentId: slug, stageId: externalStageId, code: { startsWith: 'MP-' } },
  });
  await page.goto(`${root}/admin/referee/qualifiers/${imported.id}`);
  await expect(
    page.getByText(
      'Official seedings are finalized. Source scores are locked; IRC room controls remain separate.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Capture from osu!', exact: true })).toHaveCount(0);
});
