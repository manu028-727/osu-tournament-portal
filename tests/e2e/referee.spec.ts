import { test, expect, type BrowserContext } from '@playwright/test';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { matchRulesSchema } from '../../src/lib/match-rules';
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
const prefix = `refe2e-${Date.now()}`;
const accounts: { id: string; token: string; username: string }[] = [];
let stageId: string, teamAId: string, teamBId: string;
const extraStages: string[] = [],
  extraBeatmaps: number[] = [];
async function account(osuId: number, systemKey: string) {
  const role = await db.role.findUniqueOrThrow({ where: { systemKey } }),
    token = randomBytes(32).toString('base64url');
  const user = await db.user.create({
    data: {
      osuId,
      username: `${prefix}-${systemKey}-${osuId}`,
      avatarUrl: 'https://a.ppy.sh/1',
      profileUrl: `https://osu.ppy.sh/users/${osuId}`,
      roles: { create: { roleId: role.id } },
      sessions: {
        create: {
          id: createHash('sha256').update(token).digest('hex'),
          expiresAt: new Date(Date.now() + 3600000),
        },
      },
    },
  });
  const result = { id: user.id, token, username: user.username };
  accounts.push(result);
  return result;
}
async function login(context: BrowserContext, index: number) {
  await context.addCookies([
    {
      name: 'tournament_session',
      value: accounts[index].token,
      url: 'http://localhost:3001',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}
test.beforeAll(async () => {
  if (new URL(process.env.TEST_DATABASE_URL!).pathname !== '/tournament_platform_test')
    throw Error('Test database only.');
  await account(961000001, 'Owner');
  await account(961000002, 'Referee');
  await account(961000003, 'Referee');
  await account(961000004, 'Guest');
  await account(961000005, 'Admin');
  for (const osuId of [962000001, 962000002])
    await db.participant.create({
      data: { osuId, username: `Ref fixture ${osuId}`, avatarUrl: 'https://a.ppy.sh/1' },
    });
  teamAId = (
    await db.team.create({
      data: {
        name: `${prefix} red`,
        slug: `${prefix}-red`,
        format: 'INDIVIDUAL',
        status: 'APPROVED',
        members: { create: { osuId: 962000001, captain: true, position: 0 } },
      },
    })
  ).id;
  teamBId = (
    await db.team.create({
      data: {
        name: `${prefix} blue`,
        slug: `${prefix}-blue`,
        format: 'INDIVIDUAL',
        status: 'APPROVED',
        members: { create: { osuId: 962000002, captain: true, position: 0 } },
      },
    })
  ).id;
  const rules = matchRulesSchema.parse({
    teamSize: 1,
    bestOf: 1,
    bansPerTeam: 0,
    enableTiebreaker: false,
    freeModRequiredHD: 0,
    freeModRequiredHR: 0,
  });
  const stage = await db.tournamentStage.create({
    data: { name: prefix, slug: prefix, matchRules: rules, mappool: { create: {} } },
    include: { mappool: true },
  });
  stageId = stage.id;
  const metadata = {
    id: 963000001,
    mode: 'osu',
    title: 'Referee workflow fixture',
    artist: 'Test artist',
    mapper: 'Test mapper',
    difficulty: 'Test difficulty',
    stars: 5.5,
    bpm: 180,
    length: 120,
    ar: 9,
    cs: 4,
    od: 8,
    hp: 6,
    cover: '/test-image.webp',
    url: 'https://osu.ppy.sh/beatmaps/963000001',
  };
  await db.beatmap.upsert({
    where: { id: metadata.id },
    create: { id: metadata.id, mode: 'osu', metadata },
    update: { metadata, fetchedAt: new Date() },
  });
  const revision = await db.mappoolRevision.create({
    data: {
      mappoolId: stage.mappool!.id,
      slots: {
        create: {
          name: 'NM1',
          category: 'NM',
          categoryName: 'No Mod',
          color: '#90bdf4',
          position: 0,
          beatmapId: metadata.id,
          metadata,
        },
      },
    },
  });
  await db.mappool.update({
    where: { id: stage.mappool!.id },
    data: { state: 'PUBLISHED', publishedRevisionId: revision.id, draftRevisionId: revision.id },
  });
});
test.afterAll(async () => {
  await db.qualifierLobby.deleteMany({ where: { code: { startsWith: prefix } } });
  if (new URL(process.env.TEST_DATABASE_URL!).pathname !== '/tournament_platform_test') return;
  await db.match.deleteMany({ where: { code: { startsWith: prefix } } });
  if (stageId)
    await db.tournamentStage.deleteMany({ where: { id: { in: [stageId, ...extraStages] } } });
  await db.team.deleteMany({ where: { id: { in: [teamAId, teamBId].filter(Boolean) } } });
  await db.mediaAsset.deleteMany({ where: { name: { startsWith: prefix } } });
  await db.participant.deleteMany({ where: { osuId: { in: [962000001, 962000002] } } });
  await db.user.deleteMany({ where: { id: { in: accounts.map((a) => a.id) } } });
  await db.beatmap.deleteMany({ where: { id: { in: extraBeatmaps } } });
  await db.$disconnect();
});

test('guided BO9 completes protects, Blue-first ABBA, corrections, refresh and a tiebreaker entirely in the browser', async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(15000);
  await login(context, 0);
  const rules = matchRulesSchema.parse({
    bestOf: 9,
    teamSize: 1,
    banOrder: 'ABBA',
    bansPerTeam: 2,
    protectsPerTeam: 1,
    protectOrder: 'ABAB',
    pickOrder: 'ABAB',
    freeModRequiredHD: 0,
    freeModRequiredHR: 0,
  });
  const stage = await db.tournamentStage.create({
    data: {
      name: `${prefix} BO9`,
      slug: `${prefix}-bo9`,
      matchRules: rules,
      mappool: { create: {} },
    },
    include: { mappool: true },
  });
  extraStages.push(stage.id);
  const names = [
    'NM1',
    'NM2',
    'NM3',
    'NM4',
    'NM5',
    'NM6',
    'NM7',
    'NM8',
    'HD1',
    'HD2',
    'HR1',
    'HR2',
    'DT1',
    'DT2',
    'FM1',
    'FM2',
    'TB',
  ];
  const slots = [];
  for (const [position, name] of names.entries()) {
    const id = 964000000 + position,
      metadata = {
        id,
        mode: 'osu',
        title: `Workflow ${name}`,
        artist: 'Test fixture',
        mapper: 'Fixture',
        difficulty: 'Verification',
        stars: 5,
        bpm: 180,
        length: 120,
        ar: 9,
        cs: 4,
        od: 8,
        hp: 6,
        cover: '/test-image.webp',
        url: `https://osu.ppy.sh/beatmaps/${id}`,
      };
    await db.beatmap.create({ data: { id, mode: 'osu', metadata } });
    extraBeatmaps.push(id);
    slots.push({
      name,
      category: name.replace(/\d+$/, ''),
      categoryName: name.replace(/\d+$/, ''),
      color: '#90bdf4',
      position,
      beatmapId: id,
      metadata,
    });
  }
  const rev = await db.mappoolRevision.create({
    data: { mappoolId: stage.mappool!.id, slots: { create: slots } },
  });
  await db.mappool.update({
    where: { id: stage.mappool!.id },
    data: { state: 'PUBLISHED', draftRevisionId: rev.id, publishedRevisionId: rev.id },
  });
  await page.goto('/t/test-cup/admin/stages');
  await page.getByRole('button', { name: `Edit ${stage.name}`, exact: true }).click();
  for (const order of ['AB', 'ABAB', 'ABBA']) {
    await page.getByLabel('Ban order', { exact: true }).selectOption(order);
    await expect(
      page.getByText(
        order
          .split('')
          .map((s) => `${s} bans`)
          .join(' → '),
        { exact: true },
      ),
    ).toBeVisible();
  }
  await page.getByRole('button', { name: 'Save stage', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Stage settings saved');
  const created = await context.request.post('/api/admin/action', {
    headers: { Origin: 'http://localhost:3001' },
    data: {
      type: 'match.create',
      code: `${prefix}-bo9`,
      stageId: stage.id,
      teamAId,
      teamBId,
      refereeIds: [accounts[1].id],
    },
  });
  expect(created.ok()).toBe(true);
  const { id } = await created.json();
  const referee = await browser.newContext(),
    observer = await browser.newContext();
  await referee.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(referee, 1);
  await login(observer, 2);
  try {
    const ref = await referee.newPage(),
      watch = await observer.newPage();
    const errors: string[] = [];
    ref.on('pageerror', (e) => errors.push(e.message));
    await ref.goto(`/t/test-cup/admin/referee/${id}`);
    await watch.goto(`/t/test-cup/admin/referee/${id}`);
    await ref.getByRole('button', { name: 'Start match', exact: true }).click();
    await expect(ref.getByTestId('current-phase')).toHaveText('Roll phase');
    await ref.getByLabel('Team Red roll', { exact: true }).fill('50');
    await ref.getByLabel('Team Blue roll', { exact: true }).fill('50');
    await expect(
      ref.getByText('Tied rolls. Enter the reroll results.', { exact: true }),
    ).toBeVisible();
    await expect(ref.getByRole('button', { name: 'Confirm roll', exact: true })).toBeDisabled();
    await ref.getByLabel('Team Red roll', { exact: true }).fill('80');
    await ref.getByLabel('Team Blue roll', { exact: true }).fill('20');
    await ref.getByLabel('First ban', { exact: true }).selectOption('B');
    await ref.getByRole('button', { name: 'Confirm roll', exact: true }).click();
    const choose = async (kind: string, slot: string) => {
      await ref.getByLabel('Available map slot', { exact: true }).selectOption(slot);
      const before = await db.match.findUniqueOrThrow({ where: { id } });
      await ref.getByRole('button', { name: `Confirm ${kind}`, exact: true }).click();
      await expect(ref.getByRole('status')).toContainText('Draft action recorded');
      await expect(
        ref.getByText(`Saved version ${before.version + 1}`, { exact: true }),
      ).toBeVisible();
    };
    await choose('protect', 'NM1');
    await choose('protect', 'HD1');
    await choose('ban', 'HD2');
    await ref.getByText('Match administration', { exact: true }).click();
    await ref.getByRole('button', { name: 'Undo last action', exact: true }).click();
    await ref.getByLabel('Reason', { exact: true }).fill('Correct test ban before continuing');
    await ref
      .getByRole('dialog')
      .getByRole('button', { name: 'Undo last action', exact: true })
      .click();
    await expect(ref.getByRole('status')).toContainText('Match updated');
    await ref.getByText('Match administration', { exact: true }).click();
    for (const [side, slot] of [
      ['B', 'HD2'],
      ['A', 'HR2'],
      ['A', 'DT2'],
      ['B', 'FM2'],
    ]) {
      await expect(ref.getByLabel('Current action')).toContainText(
        `Team ${side === 'A' ? 'Red' : 'Blue'}`,
      );
      await choose('ban', slot);
    }
    await ref.reload();
    await expect(ref.getByTestId('current-phase')).toHaveText('pick');
    await expect(ref.getByLabel('Available map slot').locator('option[value="HD2"]')).toHaveCount(
      0,
    );
    for (const [device, viewport] of [
      ['desktop', { width: 1920, height: 1080 }],
      ['laptop', { width: 1366, height: 768 }],
      ['mobile', { width: 390, height: 844 }],
    ] as const) {
      await ref.setViewportSize(viewport);
      expect(await ref.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (device !== 'mobile') {
        const box = await ref
          .getByRole('button', { name: 'Confirm pick', exact: true })
          .boundingBox();
        expect(box!.y + box!.height).toBeLessThan(viewport.height);
      }
      await ref.screenshot({
        path: `test-results/guided-referee-${device}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
    await ref.setViewportSize({ width: 1366, height: 768 });
    for (const [index, slot] of [
      'NM1',
      'HD1',
      'HR1',
      'DT1',
      'FM1',
      'NM2',
      'NM3',
      'NM4',
    ].entries()) {
      await choose('pick', slot);
      await expect(ref.getByTestId('current-phase')).toHaveText(`Now playing - ${slot}`);
      if (index === 0) {
        for (const [label, expected] of [
          ['ID', '964000000'],
          ['map command', '!mp map 964000000 0'],
          ['mod command', '!mp mods NF'],
        ]) {
          await ref
            .getByLabel('Current action')
            .getByRole('button', { name: `Copy NM1 ${label}`, exact: true })
            .click();
          await expect
            .poll(() => ref.evaluate(() => navigator.clipboard.readText()))
            .toBe(expected);
        }
        await ref.getByRole('button', { name: 'Record incident', exact: true }).click();
        await ref.getByLabel('Affected team', { exact: true }).selectOption('A');
        await ref
          .getByLabel('Incident notes', { exact: true })
          .fill('Requested timeout on the first Red pick');
        await ref.getByRole('button', { name: 'Save incident', exact: true }).click();
        await expect(ref.getByRole('status')).toContainText('Incident recorded');
        expect((await db.match.findUniqueOrThrow({ where: { id } })).timerKind).toBe('TIMEOUT');
      }
      const winner = index % 2 ? 'Red' : 'Blue';
      await ref.getByRole('button', { name: `${winner} wins ${slot}`, exact: true }).click();
      await expect(ref.getByRole('status')).toContainText('Map winner saved');
      expect((await db.match.findUniqueOrThrow({ where: { id } })).timerStartedAt).toBeNull();
      await expect(ref.getByLabel('Match score', { exact: true })).toHaveText(
        `${Math.floor((index + 1) / 2)} : ${Math.ceil((index + 1) / 2)}`,
      );
    }
    await expect(ref.getByTestId('current-phase')).toHaveText('Tiebreaker');
    await expect(ref.getByLabel('Available map slot').locator('option')).toHaveCount(2);
    await choose('pick', 'TB');
    await ref.getByRole('button', { name: 'Blue wins TB', exact: true }).click();
    await expect(ref.getByLabel('Match score', { exact: true })).toHaveText('4 : 5');
    await expect(watch.getByLabel('Match score', { exact: true })).toHaveText('4 : 5', {
      timeout: 10000,
    });
    await expect(
      watch.getByRole('button', { name: 'Review & submit result', exact: true }),
    ).toHaveCount(0);
    await ref.getByRole('button', { name: 'Review & submit result', exact: true }).click();
    await ref.getByLabel('Final match notes').fill('BO9 verified through the browser, manual only');
    await ref.getByRole('button', { name: 'Submit result', exact: true }).click();
    await expect(ref.getByRole('status')).toContainText('submitted for confirmation');
    await page.goto(`/t/test-cup/admin/referee/${id}`);
    await page.getByRole('button', { name: 'Confirm result', exact: true }).click();
    await page.getByLabel('Reason', { exact: true }).fill('All nine map winners and ABBA verified');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirm result', exact: true })
      .click();
    await expect(page.getByRole('status')).toContainText('Match updated');
    await page.getByRole('tab', { name: 'discord', exact: true }).click();
    await expect(page.getByLabel('Discord result preview')).toContainText('NM1');
    await expect(
      page.getByRole('button', { name: 'Copy Discord Result', exact: true }),
    ).toBeEnabled();
    const discord = await page.getByLabel('Discord result preview').innerText();
    await page.getByRole('button', { name: 'Copy Discord Result', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(discord.replaceAll('\n', '\r'));
    await expect(page.getByRole('button', { name: 'Confirm pick', exact: true })).toHaveCount(0);
    expect(await db.matchMapResult.count({ where: { matchId: id, voided: false } })).toBe(9);
    expect(await db.matchMapAction.count({ where: { matchId: id, voided: false } })).toBe(15);
    expect(errors).toEqual([]);
  } finally {
    await referee.close();
    await observer.close();
  }
});
test('Referees see all matches, observe live updates and cannot edit other assignments', async ({
  page,
  context,
  browser,
}) => {
  const admin = await browser.newContext();
  const second = await browser.newContext();
  try {
    await login(admin, 4);
    await login(second, 2);
    await login(context, 1);
    const post = async (client: BrowserContext, body: object) =>
      client.request.post('/api/admin/action', {
        headers: { Origin: 'http://localhost:3001' },
        data: body,
      });
    const created = [] as { id: string; code: string }[];
    for (const [i, refereeIds] of [
      [0, [accounts[1].id]],
      [1, [accounts[2].id]],
      [2, []],
    ] as const) {
      const code = prefix + '-observe-' + i;
      const response = await post(admin, {
        type: 'match.create',
        code,
        stageId,
        teamAId,
        teamBId,
        scheduledAt: `2074-08-0${i + 1}T13:00:00.000Z`,
        refereeIds,
        bestOf: 1,
      });
      expect(response.status()).toBe(200);
      created.push({ ...(await response.json()), code });
    }
    await page.goto('/t/test-cup/admin/referee');
    await expect(page.getByLabel('Assigned referee', { exact: true })).toHaveValue('');
    for (const m of created)
      await expect(
        page.getByRole('link', { name: 'Open match ' + m.code, exact: true }),
      ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Assign ' + created[0].code, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Assign ' + created[1].code, exact: true }),
    ).toHaveCount(0);
    await page.getByLabel('Assigned referee', { exact: true }).selectOption('me');
    await expect(
      page.getByRole('link', { name: 'Open match ' + created[1].code, exact: true }),
    ).toHaveCount(0);
    await page.getByLabel('Assigned referee', { exact: true }).selectOption('');
    await page.getByRole('link', { name: 'Open match ' + created[1].code, exact: true }).click();
    await expect(page.getByText('Viewing match · Read only', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start match', exact: true })).toHaveCount(0);
    expect(
      (await post(context, { type: 'match.start', id: created[1].id, baseVersion: 1 })).status(),
    ).toBe(403);
    expect(
      (await post(admin, { type: 'match.start', id: created[1].id, baseVersion: 1 })).status(),
    ).toBe(200);
    await expect(page.getByText('In progress', { exact: true }).first()).toBeVisible({
      timeout: 10000,
    });
    expect(
      (
        await post(second, {
          type: 'match.lobby',
          id: created[1].id,
          baseVersion: 2,
          lobbyUrl: 'https://osu.ppy.sh/community/matches/12345',
        })
      ).status(),
    ).toBe(200);
    await page.getByText('Lobby & clipboard commands', { exact: true }).click();
    await expect(
      page.getByRole('link', { name: 'Open multiplayer lobby', exact: true }),
    ).toHaveAttribute('href', 'https://osu.ppy.sh/community/matches/12345', { timeout: 10000 });
    const assigned = await second.newPage();
    await assigned.goto('/t/test-cup/admin/referee/' + created[1].id);
    await expect(
      assigned.getByText('Editing match · Assigned referee', { exact: true }),
    ).toBeVisible();
    await assigned.goto('/t/test-cup/admin/referee/' + created[2].id);
    await expect(assigned.getByText('Viewing match · Read only', { exact: true })).toBeVisible();
    expect(
      (await post(second, { type: 'match.start', id: created[2].id, baseVersion: 1 })).status(),
    ).toBe(403);
    await page.getByRole('tab', { name: 'history', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Result revisions', exact: true }),
    ).toBeVisible();
  } finally {
    await admin.close();
    await second.close();
  }
});
test('Owner schedules a match; assigned referees collaborate, submit and review a confirmed result', async ({
  browser,
  page,
  context,
  request,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(context, 0);
  await page.goto('/t/test-cup/admin/matches');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Match management');
  await page.getByRole('button', { name: 'New match', exact: true }).click();
  await page.getByLabel('Match code', { exact: true }).fill(prefix);
  await page.getByLabel('Tournament stage', { exact: true }).selectOption(stageId);
  await page.getByLabel('Team A / red', { exact: true }).selectOption(teamAId);
  await page.getByLabel('Team B / blue', { exact: true }).selectOption(teamBId);
  await page.getByLabel('Scheduled time (your timezone)', { exact: true }).fill('2070-02-01T13:00');
  await page.getByRole('checkbox', { name: accounts[1].username, exact: true }).check();
  await page.getByRole('checkbox', { name: accounts[2].username, exact: true }).check();
  await page.getByRole('button', { name: 'Save match', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Match scheduled');
  const match = await db.match.findFirstOrThrow({ where: { tournamentId: 'main', code: prefix } });
  expect((await request.get(`/api/admin/data?section=match&id=${match.id}`)).status()).toBe(401);
  expect((await request.get(`/api/public/teams?slug=${prefix}-red`)).status()).toBe(404);
  const refContext = await browser.newContext(),
    refTwo = await browser.newContext(),
    guest = await browser.newContext();
  try {
    await login(refContext, 1);
    await login(refTwo, 2);
    await login(guest, 3);
    expect((await guest.request.get(`/api/admin/data?section=match&id=${match.id}`)).status()).toBe(
      403,
    );
    expect((await refContext.request.get('/api/admin/data?section=users')).status()).toBe(403);
    expect((await refContext.request.get('/api/admin/data?section=matches')).status()).toBe(403);
    const ref = await refContext.newPage(),
      observer = await refTwo.newPage();
    ref.on('pageerror', (e) => errors.push(e.message));
    observer.on('pageerror', (e) => errors.push(e.message));
    await ref.goto('/admin');
    await expect(ref).toHaveURL('http://localhost:3001/admin/tournaments');
    await ref.goto('/t/test-cup/admin/referee');
    await expect(
      ref
        .getByRole('navigation', { name: 'Administration' })
        .getByRole('link', { name: 'Users', exact: true }),
    ).toHaveCount(0);
    await ref.getByRole('link', { name: `Open match ${prefix}`, exact: true }).click();
    await observer.goto(`/t/test-cup/admin/referee/${match.id}`);
    await ref.getByRole('button', { name: 'Start match', exact: true }).click();
    await expect(ref.getByRole('status')).toContainText('Match started');
    await ref.getByLabel('Team Red roll', { exact: true }).fill('80');
    await ref.getByLabel('Team Blue roll', { exact: true }).fill('20');
    await ref.getByRole('button', { name: 'Confirm roll', exact: true }).click();
    await expect(ref.getByRole('status')).toContainText('Roll recorded');
    await ref.getByLabel('Available map slot', { exact: true }).selectOption('NM1');
    await ref.getByRole('button', { name: 'Confirm pick', exact: true }).click();
    await expect(ref.getByRole('status')).toContainText('Draft action recorded');
    await expect(
      observer.getByRole('button', { name: 'Enter scores NM1', exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await ref.getByRole('button', { name: 'Enter scores NM1', exact: true }).click();
    await ref.getByLabel(`${prefix} red score`, { exact: true }).fill('1000');
    await ref.getByLabel(`${prefix} blue score`, { exact: true }).fill('900');
    await observer.getByRole('button', { name: 'Reset timer', exact: true }).click();
    await expect(
      ref.getByText('Another referee changed this match.', { exact: false }),
    ).toBeVisible({ timeout: 10000 });
    await expect(ref.getByLabel(`${prefix} red score`, { exact: true })).toHaveValue('1000');
    await expect(ref.getByRole('button', { name: 'Save map result', exact: true })).toBeDisabled();
    ref.once('dialog', (dialog) => void dialog.accept());
    await ref.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await ref.getByRole('button', { name: 'Enter scores NM1', exact: true }).click();
    await ref.getByLabel(`${prefix} red score`, { exact: true }).fill('1000');
    await ref.getByLabel(`${prefix} blue score`, { exact: true }).fill('900');
    await ref.getByRole('button', { name: 'Save map result', exact: true }).click();
    await expect(ref.getByRole('status')).toContainText('Map result saved');
    await expect(observer.getByLabel('Match score', { exact: true })).toHaveText('1 : 0', {
      timeout: 10000,
    });
    await ref.getByRole('button', { name: 'Review & submit result', exact: true }).click();
    await ref.getByLabel('Final match notes').fill('Verified manual result');
    await ref.getByRole('button', { name: 'Submit result', exact: true }).click();
    await expect(ref.getByRole('status')).toContainText('submitted for confirmation');
    await expect(ref.getByRole('button', { name: 'Confirm result', exact: true })).toHaveCount(0);
    await page.goto(`/t/test-cup/admin/referee/${match.id}`);
    await page.getByRole('button', { name: 'Confirm result', exact: true }).click();
    await page.getByLabel('Reason', { exact: true }).fill('Referee result checked');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirm result', exact: true })
      .click();
    await expect(page.getByRole('status')).toContainText('Match updated');
    expect((await db.match.findUniqueOrThrow({ where: { id: match.id } })).status).toBe(
      'COMPLETED',
    );
    await ref.getByRole('tab', { name: 'history', exact: true }).click();
    await expect(ref.getByRole('heading', { name: 'Result revisions', exact: true })).toBeVisible();
    await ref.getByRole('button', { name: 'View revision', exact: true }).first().click();
    await expect(ref.getByRole('dialog')).toContainText('winnerSide');
    await ref.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await ref.setViewportSize({ width: 390, height: 844 });
    await ref.getByRole('tab', { name: 'match', exact: true }).click();
    await ref.evaluate(() => {
      (document.activeElement as HTMLElement)?.blur();
      scrollTo(0, 0);
    });
    expect(await ref.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await ref.screenshot({
      path: 'test-results/referee-mobile.png',
      fullPage: true,
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: 'test-results/referee-desktop.png',
      fullPage: true,
      animations: 'disabled',
    });
    expect(errors).toEqual([]);
  } finally {
    await refContext.close();
    await refTwo.close();
    await guest.close();
  }
});

test('qualifier lobby persists scores, commands, observing and a confirmed result', async ({
  page,
  browser,
}) => {
  await login(page.context(), 0);
  const upload = await page.request.post('/api/media', {
    headers: { Origin: 'http://localhost:3001' },
    multipart: {
      file: {
        name: `${prefix}-qualifier-logo.webp`,
        mimeType: 'image/webp',
        buffer: await readFile('public/test-image.webp'),
      },
    },
  });
  expect(upload.status()).toBe(200);
  const asset = await upload.json();
  await db.team.update({ where: { id: teamAId }, data: { logoImageId: asset.id } });
  await page.goto('/t/test-cup/admin/referee/qualifiers');
  await page.getByRole('button', { name: 'Create qualifier lobby', exact: true }).click();
  await page.getByLabel('Qualifier lobby code', { exact: true }).fill(`${prefix}-Q1`);
  await page.getByLabel('Qualifier stage', { exact: true }).selectOption(stageId);
  await page.getByLabel('Qualifier start time', { exact: true }).fill('2079-01-01T15:00');
  await page.getByLabel(`${prefix} red`, { exact: true }).check();
  await page.getByLabel(`${prefix} blue`, { exact: true }).check();
  await page.getByLabel(accounts[1].username, { exact: true }).check();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Create qualifier lobby', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Qualifier lobby created');
  const lobby = await db.qualifierLobby.findFirstOrThrow({
    where: { tournamentId: 'main', code: `${prefix}-Q1` },
  });
  await db.team.update({ where: { id: teamAId }, data: { logoImageId: null } });
  const protectedAsset = await page.request.delete(`/api/media/${asset.id}`, {
    headers: { Origin: 'http://localhost:3001' },
  });
  expect(protectedAsset.status()).toBe(409);
  const refContext = await browser.newContext(),
    observerContext = await browser.newContext();
  try {
    await login(refContext, 1);
    await login(observerContext, 2);
    const ref = await refContext.newPage(),
      observer = await observerContext.newPage();
    await ref.goto(`/t/test-cup/admin/referee/qualifiers/${lobby.id}`);
    await observer.goto(`/t/test-cup/admin/referee/qualifiers/${lobby.id}`);
    await expect(
      observer.getByText('Viewing qualifier lobby · Read only', { exact: true }),
    ).toBeVisible();
    await expect(
      observer.getByRole('button', { name: 'Start qualifier lobby', exact: true }),
    ).toHaveCount(0);
    await expect(
      ref.getByRole('button', { name: 'Copy NM1 map command', exact: true }),
    ).toBeVisible();
    await ref.getByRole('button', { name: 'Start qualifier lobby', exact: true }).click();
    await ref.getByLabel('Qualifier status reason', { exact: true }).fill('All participants ready');
    await ref.getByRole('button', { name: 'Confirm qualifier action', exact: true }).click();
    await expect(ref.getByRole('status')).toContainText('Qualifier status saved');
    await ref.getByRole('button', { name: 'Edit multiplayer link', exact: true }).click();
    await ref
      .getByLabel('Qualifier multiplayer URL', { exact: true })
      .fill('https://osu.ppy.sh/community/matches/123456');
    await ref.getByRole('button', { name: 'Save multiplayer link', exact: true }).click();
    await expect(ref.getByRole('status')).toContainText('Multiplayer link saved');
    for (const osuId of [962000001, 962000002]) {
      await ref.getByRole('button', { name: 'Record qualifier score', exact: true }).click();
      await ref.getByLabel('Qualifier player', { exact: true }).selectOption(String(osuId));
      await ref.getByLabel('Qualifier raw score', { exact: true }).fill('123456');
      await ref
        .getByLabel('Qualifier score reason', { exact: true })
        .fill('Multiplayer score verified');
      await ref.getByRole('button', { name: 'Save qualifier score', exact: true }).click();
      await expect(ref.getByRole('status')).toContainText('Qualifier score saved');
    }
    await expect(
      observer.getByRole('table').last().getByText('123,456', { exact: true }),
    ).toHaveCount(4, { timeout: 10000 });
    await ref.getByRole('button', { name: 'Submit qualifier results', exact: true }).click();
    await ref.getByLabel('Qualifier status reason', { exact: true }).fill('Scores checked');
    await ref.getByRole('button', { name: 'Confirm qualifier action', exact: true }).click();
    await expect(ref.getByRole('status')).toContainText('Qualifier status saved');
    await page.goto(`/t/test-cup/admin/referee/qualifiers/${lobby.id}`);
    await page.getByRole('button', { name: 'Confirm qualifier results', exact: true }).click();
    await page
      .getByLabel('Qualifier status reason', { exact: true })
      .fill('Organizer checked results');
    await page.getByRole('button', { name: 'Confirm qualifier action', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Qualifier status saved');
    await expect(
      observer.getByRole('button', { name: 'Copy Discord Result', exact: true }),
    ).toBeEnabled({ timeout: 10000 });
    await expect(
      observer.locator('pre').filter({ hasText: '**Qualifiers:** Lobby' }),
    ).toContainText('MP Link: <https://osu.ppy.sh/community/matches/123456>');
    await ref.reload();
    expect(await db.qualifierScore.count({ where: { lobbyId: lobby.id } })).toBe(2);
    await observer.setViewportSize({ width: 390, height: 844 });
    expect(await observer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await observer.screenshot({
      path: 'test-results/qualifier-mobile.png',
      fullPage: true,
      animations: 'disabled',
    });
  } finally {
    await refContext.close();
    await observerContext.close();
  }
});

test('assigned referee records a no-show and an Owner confirms the forfeit', async ({
  page,
  context,
  browser,
}) => {
  await login(context, 0);
  const created = await context.request.post('/api/admin/action', {
    headers: { Origin: 'http://localhost:3001' },
    data: {
      type: 'match.create',
      code: prefix + '-forfeit',
      stageId,
      teamAId,
      teamBId,
      scheduledAt: '2070-02-02T13:00:00.000Z',
      refereeIds: [accounts[1].id],
      bestOf: 1,
    },
  });
  expect(created.status()).toBe(200);
  const match = await db.match.findFirstOrThrow({
    where: { tournamentId: 'main', code: prefix + '-forfeit' },
  });
  const referee = await browser.newContext();
  try {
    await login(referee, 1);
    const ref = await referee.newPage();
    await ref.goto(`/t/test-cup/admin/referee/${match.id}`);
    await ref.getByText('Match administration', { exact: true }).click();
    await ref.getByRole('button', { name: 'Record forfeit', exact: true }).click();
    await ref.getByLabel('Winning team', { exact: true }).selectOption('B');
    await ref
      .getByLabel('Reason', { exact: true })
      .fill('Team A did not arrive within the agreed allowance');
    await ref
      .getByRole('dialog')
      .getByRole('button', { name: 'Record forfeit', exact: true })
      .click();
    await expect(ref.getByText('Win by forfeit', { exact: false })).toBeVisible();
    expect(await db.matchMapResult.count({ where: { matchId: match.id } })).toBe(0);
    expect(await db.match.findUniqueOrThrow({ where: { id: match.id } })).toMatchObject({
      status: 'AWAITING_CONFIRMATION',
      forfeitSide: 'A',
      scoreA: 0,
      scoreB: 1,
    });
    await page.goto(`/t/test-cup/admin/referee/${match.id}`);
    await page.getByRole('button', { name: 'Confirm result', exact: true }).click();
    await page.getByLabel('Reason', { exact: true }).fill('No-show and decision verified');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirm result', exact: true })
      .click();
    await expect(page.getByRole('status')).toContainText('Match updated');
    expect(await db.match.findUniqueOrThrow({ where: { id: match.id } })).toMatchObject({
      status: 'COMPLETED',
      winnerSide: 'B',
    });
  } finally {
    await referee.close();
  }
});

test('organizer adds and replaces the visible MP link and permanently deletes a test match', async ({
  page,
  context,
  browser,
}) => {
  await login(context, 0);
  const create = async (code: string) => {
    const response = await context.request.post('/api/admin/action?tournament=test-cup', {
      headers: { Origin: 'http://localhost:3001' },
      data: { type: 'match.create', code, stageId, teamAId, teamBId, refereeIds: [] },
    });
    expect(response.ok()).toBe(true);
    return response.json() as Promise<{ id: string }>;
  };
  const code = `${prefix}-removable`,
    created = await create(code);
  await page.goto(`/t/test-cup/admin/referee/${created.id}`);
  await page.getByRole('button', { name: 'Add multiplayer link', exact: true }).click();
  await page
    .getByLabel('osu! multiplayer URL', { exact: true })
    .fill('https://osu.ppy.sh/community/matches/123456');
  await expect(page.getByLabel('Multiplayer match ID', { exact: true })).toHaveValue('123456');
  await page.getByRole('button', { name: 'Save lobby', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Lobby saved');
  await page.getByRole('button', { name: 'Edit multiplayer link', exact: true }).click();
  await page
    .getByLabel('osu! multiplayer URL', { exact: true })
    .fill('https://osu.ppy.sh/community/matches/654321');
  await expect(page.getByLabel('Multiplayer match ID', { exact: true })).toHaveValue('654321');
  await page.getByRole('button', { name: 'Save lobby', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Lobby saved');
  await page.reload();
  expect((await db.match.findUniqueOrThrow({ where: { id: created.id } })).multiplayerId).toBe(
    654321,
  );
  await expect(page.getByRole('button', { name: 'Start match', exact: true })).toBeEnabled();
  for (const [device, viewport] of [
    ['desktop', { width: 1440, height: 1000 }],
    ['mobile', { width: 390, height: 844 }],
  ] as const) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `test-results/match-controls-${device}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const viewer = await browser.newContext();
  try {
    await login(viewer, 1);
    expect(
      (
        await viewer.request.post('/api/admin/action?tournament=test-cup', {
          headers: { Origin: 'http://localhost:3001' },
          data: {
            type: 'match.delete',
            id: created.id,
            baseVersion: 3,
            confirmCode: code,
            reason: 'Unauthorized removal',
          },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await viewer.close();
  }
  await page.getByText('Match administration', { exact: true }).click();
  await page.getByRole('button', { name: 'Delete match', exact: true }).click();
  await page.getByLabel('Match code confirmation', { exact: true }).fill('wrong code');
  await page.getByLabel('Deletion reason', { exact: true }).fill('Remove test fixture');
  await expect(
    page.getByRole('button', { name: 'Permanently delete match', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('Match code confirmation', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Permanently delete match', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:3001/t/test-cup/admin/matches');
  expect(await db.match.findUnique({ where: { id: created.id } })).toBeNull();
  expect(await db.auditLog.count({ where: { entityId: created.id, action: 'match.delete' } })).toBe(
    1,
  );
  const secondCode = `${prefix}-remove-from-list`,
    second = await create(secondCode);
  await page.reload();
  await page.getByRole('button', { name: `Delete match ${secondCode}`, exact: true }).click();
  await page.getByLabel('Match code confirmation', { exact: true }).fill(secondCode);
  await page.getByLabel('Deletion reason', { exact: true }).fill('Remove unused schedule entry');
  await page.getByRole('button', { name: 'Permanently delete match', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Match permanently deleted.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: `Open match ${secondCode}`, exact: true }),
  ).toHaveCount(0);
  expect(await db.match.findUnique({ where: { id: second.id } })).toBeNull();
});
