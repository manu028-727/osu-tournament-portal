import { test as base, expect } from '@playwright/test';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { inheritedRules } from '../../src/lib/gameplay-scoring';
import { DEFAULT_COPY } from '../../src/lib/copy';
import { assertTestDatabase } from '../../src/lib/instance';
import { signMatchResultReview } from '../../src/lib/match-result-review';
import type { MultiplayerImportGame } from '../../src/lib/match-results-contract';
import type { MatchParticipants } from '../../src/lib/matches-types';

assertTestDatabase(process.env.TEST_DATABASE_URL);
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
const rules = inheritedRules(
  {
    teamSize: 1,
    bestOf: 3,
    bansPerTeam: 0,
    enableTiebreaker: false,
    freeModRequiredHD: 0,
    freeModRequiredHR: 0,
  },
  'SCORE_V2',
);
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const test = base.extend<{
  tournament: {
    id: string;
    root: string;
    matches: { id: string; matchNumber: number }[];
    targetStageId: string;
    refId: string;
    refName: string;
  };
}>({
  tournament: async ({ page, context, baseURL }, use) => {
    const id = `matches-browser-${randomUUID()}`,
      userIds: string[] = [],
      playerIds: number[] = [];
    const token = randomBytes(32).toString('base64url');
    try {
      const manager = await db.user.create({
        data: {
          osuId: randomInt(1_690_000_000, 1_700_000_000),
          username: id,
          avatarUrl: '',
          profileUrl: '',
          platformAdmin: true,
          sessions: {
            create: {
              id: createHash('sha256').update(token).digest('hex'),
              expiresAt: new Date(Date.now() + 3600000),
            },
          },
        },
      });
      userIds.push(manager.id);
      const ref = await db.user.create({
        data: {
          osuId: randomInt(1_700_000_000, 1_710_000_000),
          username: `${id}-ref`,
          avatarUrl: '',
          profileUrl: '',
        },
      });
      userIds.push(ref.id);
      await db.tournament.create({
        data: {
          id,
          slug: id,
          name: 'Schedule browser QA',
          acronym: 'QA',
          description: '',
          settings: {
            create: {
              gameplayScoring: 'SCORE_V2',
              matchRules: json(rules),
              copy: DEFAULT_COPY,
              socialLinks: [],
              importantDates: [],
              navigation: [],
              footer: '',
            },
          },
        },
      });
      const role = await db.role.create({
        data: {
          tournamentId: id,
          name: 'QA Referee',
          permissions: {
            create: ['matches.view_all', 'matches.manage_assigned'].map((permissionKey) => ({
              permissionKey,
            })),
          },
        },
      });
      await db.userRole.create({ data: { tournamentId: id, roleId: role.id, userId: ref.id } });
      const teams = [];
      for (let i = 0; i < 4; i++) {
        const osuId = randomInt(1_710_000_000, 1_720_000_000);
        playerIds.push(osuId);
        await db.participant.create({ data: { osuId, username: `Entrant ${i}`, avatarUrl: '' } });
        const team = await db.team.create({
          data: {
            tournamentId: id,
            name: `Entrant ${i}`,
            slug: `entrant-${i}`,
            format: 'INDIVIDUAL',
            status: 'APPROVED',
            members: { create: { osuId, captain: true, position: 0 } },
          },
        });
        teams.push({
          id: team.id,
          name: team.name,
          slug: team.slug,
          format: team.format,
          logoImageId: null,
          members: [
            { osuId, username: team.name, avatarUrl: '', captain: true, substitute: false },
          ],
        });
      }
      const map = await db.beatmap.findFirstOrThrow();
      const stages = [];
      for (let i = 0; i < 2; i++) {
        const stage = await db.tournamentStage.create({
          data: {
            tournamentId: id,
            name: i ? 'Finals' : 'Opening round',
            slug: `round-${i}`,
            kind: 'ELIMINATION',
            matchRules: json({ ...rules, bestOf: i ? 5 : 3 }),
            mappool: { create: {} },
          },
          include: { mappool: true },
        });
        const revision = await db.mappoolRevision.create({
          data: {
            tournamentId: id,
            mappoolId: stage.mappool!.id,
            slots: {
              create: Array.from({ length: 5 }, (_, position) => ({
                name: `NM${position + 1}`,
                category: 'NM',
                categoryName: 'No Mod',
                color: '#90bdf4',
                position,
                beatmapId: map.id,
                metadata: json(map.metadata),
              })),
            },
          },
        });
        await db.mappool.update({
          where: { id: stage.mappool!.id },
          data: { state: 'PUBLISHED', publishedRevisionId: revision.id },
        });
        stages.push({ id: stage.id, revisionId: revision.id });
      }
      const matches = [];
      for (let i = 0; i < 2; i++)
        matches.push(
          await db.match.create({
            data: {
              tournamentId: id,
              code: String(i + 1),
              stageId: stages[0].id,
              poolRevisionId: stages[0].revisionId,
              teamAId: teams[i * 2].id,
              teamBId: teams[i * 2 + 1].id,
              participants: json({ A: teams[i * 2], B: teams[i * 2 + 1] }),
              rules: json(rules),
              scheduledAt: new Date(`2030-06-12T0${i + 8}:00:00Z`),
              notes: 'Original note',
              source: { worksheet: 'Original fixture', provenance: { keep: true } },
            },
          }),
        );
      await context.addCookies([
        {
          name: 'tournament_session',
          value: token,
          url: baseURL!,
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await use({
        id,
        root: `/t/${id}/admin/matches`,
        matches,
        targetStageId: stages[1].id,
        refId: ref.id,
        refName: ref.username,
      });
      expect(errors).toEqual([]);
    } finally {
      await db.auditLog.deleteMany({ where: { tournamentId: id } });
      await db.match.deleteMany({ where: { tournamentId: id } });
      await db.tournamentStage.deleteMany({ where: { tournamentId: id } });
      await db.team.deleteMany({ where: { tournamentId: id } });
      await db.role.deleteMany({ where: { tournamentId: id } });
      await db.tournament.deleteMany({ where: { id } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      await db.participant.deleteMany({ where: { osuId: { in: playerIds } } });
    }
  },
});
test.afterAll(async () => db.$disconnect());

test('long participant and referee labels remain usable on a narrow Matches page', async ({
  page,
  tournament,
}, info) => {
  const match = await db.match.findUniqueOrThrow({ where: { id: tournament.matches[0].id } });
  const participants = match.participants as unknown as MatchParticipants;
  participants.A.name = 'LongParticipantName'.repeat(6);
  participants.B.name = 'AnotherLongParticipant'.repeat(5);
  await db.match.update({ where: { id: match.id }, data: { participants: json(participants) } });
  await db.user.update({
    where: { id: tournament.refId },
    data: { username: 'LongRefereeUsername'.repeat(4) },
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(tournament.root);
  await page
    .getByRole('button', { name: `Edit result for match ${match.matchNumber}`, exact: true })
    .click();
  await expect(page.getByRole('heading', { name: /Match.*Result/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Match.*Result/ })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(
    page.getByRole('link', { name: 'Skip to content', exact: true }),
  ).not.toBeInViewport();
  await page.screenshot({ path: info.outputPath('matches-long-labels-viewport.png') });
  await page.screenshot({
    path: info.outputPath('matches-long-labels-result.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Close result editor', exact: true }).click();
  await page
    .getByRole('article', { name: `Match ${match.matchNumber}`, exact: true })
    .getByRole('button', { name: `Edit referees for match ${match.matchNumber}`, exact: true })
    .click();
  await expect(
    page
      .getByRole('checkbox', { name: 'LongRefereeUsername'.repeat(4), exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: info.outputPath('matches-long-labels-inline.png'),
    fullPage: true,
  });
  await page
    .getByRole('article', { name: `Match ${match.matchNumber}`, exact: true })
    .getByRole('button', { name: 'Cancel inline edit', exact: true })
    .click();
});

test('match pagination keeps numeric order, searches all pages and clears hidden selections', async ({
  page,
  tournament,
}) => {
  const original = await db.match.findUniqueOrThrow({ where: { id: tournament.matches[0].id } });
  await db.match.createMany({
    data: Array.from({ length: 60 }, (_, index) => ({
      tournamentId: tournament.id,
      code: `position-${index + 3}`,
      stageId: original.stageId,
      teamAId: original.teamAId,
      teamBId: original.teamBId,
      participants: original.participants!,
      rules: original.rules!,
    })),
  });
  await page.goto(tournament.root);
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(50);
  await page.getByLabel('Select all visible matches', { exact: true }).check();
  await page
    .getByRole('navigation', { name: 'Pagination', exact: true })
    .getByRole('button', { name: 'Next', exact: true })
    .click();
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(12);
  await expect(page.getByLabel('Select all visible matches', { exact: true })).not.toBeChecked();
  const last = await db.match.findFirstOrThrow({
    where: { tournamentId: tournament.id },
    orderBy: { matchNumber: 'desc' },
  });
  await page.getByLabel('Search matches', { exact: true }).fill(`#${last.matchNumber}`);
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('table')).toContainText(`Match ${last.matchNumber}`);
  await db.team.update({
    where: { id: original.teamAId! },
    data: { name: 'Renamed registration' },
  });
  await page.getByLabel('Search matches', { exact: true }).fill('entrant 0');
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(50);
});

test('numeric match navigation, inline scheduling and organizer results work without referee mode', async ({
  page,
  context,
  tournament,
}, info) => {
  const number = tournament.matches[0].matchNumber,
    matchId = tournament.matches[0].id;
  await db.match.update({
    where: { id: matchId },
    data: { code: `B-${matchId}`, published: true },
  });
  await db.tournament.update({ where: { id: tournament.id }, data: { published: true } });
  await db.team.updateMany({ where: { tournamentId: tournament.id }, data: { published: true } });
  await page.goto(tournament.root);
  await expect(page.locator('main')).not.toContainText(`B-${matchId}`);
  const table = page.getByRole('table');
  await table.getByRole('button', { name: `Edit time for match ${number}`, exact: true }).click();
  await table
    .getByLabel(`Scheduled time for match ${number}`, { exact: true })
    .fill('2031-06-12T10:30');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Bracket', exact: true }).click();
  await expect(table.getByLabel(`Scheduled time for match ${number}`, { exact: true })).toHaveValue(
    '2031-06-12T10:30',
  );
  await table.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(table.getByLabel(`Scheduled time for match ${number}`, { exact: true })).toHaveCount(
    0,
  );
  await table
    .getByRole('button', { name: `Edit referees for match ${number}`, exact: true })
    .click();
  await table.getByRole('checkbox', { name: tournament.refName, exact: true }).check();
  await table.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(async () => db.matchAssignment.count({ where: { matchId, userId: tournament.refId } }))
    .toBe(1);
  await page.getByLabel('Search matches', { exact: true }).fill(`#${number}`);
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await page.getByLabel('Sort matches', { exact: true }).selectOption('schedule');
  await page.reload();
  await expect(page.getByLabel('Search matches', { exact: true })).toHaveValue(`#${number}`);
  await page.getByRole('button', { name: `Edit result for match ${number}`, exact: true }).click();
  const panel = page.getByRole('region', {
    name: `Result editor for match ${number}`,
    exact: true,
  });
  await expect(panel).toBeFocused();
  await panel.getByLabel('Score for Entrant 0', { exact: true }).fill('2');
  await panel.getByLabel('Score for Entrant 1', { exact: true }).fill('1');
  await panel
    .getByLabel('External referee credit (optional)', { exact: true })
    .fill('External tournament referee');
  await panel
    .getByLabel('Result reason / source', { exact: true })
    .fill('Reviewed the externally refereed score');
  await page.screenshot({ path: info.outputPath('manual-result-desktop.png'), fullPage: true });
  await panel.getByRole('button', { name: 'Save result', exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(await db.match.findUniqueOrThrow({ where: { id: matchId } })).toMatchObject({
    status: 'COMPLETED',
    scoreA: 2,
    scoreB: 1,
    winnerSide: 'A',
    source: { referee: 'External tournament referee' },
  });
  await expect(page).toHaveURL(/\/admin\/matches\?/);
  await page.getByRole('button', { name: `Edit result for match ${number}`, exact: true }).click();
  await panel.getByLabel('Forfeit (FF)', { exact: true }).selectOption('B');
  await panel
    .getByLabel('Result reason / source', { exact: true })
    .fill('Reviewed a correction to an external forfeit');
  await panel.getByRole('button', { name: 'Save result', exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(await db.matchResultRevision.count({ where: { matchId } })).toBe(2);
  await expect(
    page.getByRole('button', { name: `Edit result for match ${number}`, exact: true }),
  ).toBeFocused();
  const visitor = await context.browser()!.newContext({ baseURL: 'http://localhost:3001' });
  try {
    const publicPage = await visitor.newPage();
    await publicPage.goto(`/t/${tournament.id}/matches/${number}`);
    await expect(publicPage.getByText('2 : FF', { exact: true })).toBeVisible();
    await expect(
      publicPage.getByText('External tournament referee', { exact: true }),
    ).toBeVisible();
    await expect(publicPage.locator('main')).not.toContainText(matchId);
    await expect(publicPage.locator('main')).not.toContainText('Reviewed a correction');
  } finally {
    await visitor.close();
  }
});

test('reviewed multiplayer history imports, corrects and re-imports without duplicates from Matches', async ({
  page,
  tournament,
}, info) => {
  const matchId = tournament.matches[0].id,
    number = tournament.matches[0].matchNumber;
  const actor = await db.user.findFirstOrThrow({
    where: { username: tournament.id, platformAdmin: true },
  });
  const games: MultiplayerImportGame[] = [0, 1, 2, 3].map((n) => ({
    evidence: {
      eventId: n + 1,
      gameId: String(900 + n),
      beatmapId: 10000 + n,
      slotName: '',
      startTime: `2026-10-01T12:0${n}:00Z`,
      endTime: `2026-10-01T12:0${n}:30Z`,
      mode: 'osu',
      scoringType: 'scorev2',
      teamType: 'team-vs',
      mods: [],
      scores: [],
      issue: n ? 'Manual review required' : 'Warmup',
    },
    proposal: null,
  }));
  await page.route('**/api/admin/match-results**', async (route) => {
    const input = route.request().postDataJSON();
    if (input.type !== 'multiplayer') return route.continue();
    const stored = await db.multiplayerGame.findMany({ where: { matchId } });
    const decisions = games.map((game) => ({
      gameId: game.evidence.gameId,
      ...((
        stored.find((row) => row.gameId === game.evidence.gameId)?.proposal as
          { organizerReview: object } | undefined
      )?.organizerReview || { included: false, winnerSide: null, reason: '' }),
    }));
    const token = signMatchResultReview({
      actorId: actor.id,
      tournamentId: tournament.id,
      matchId,
      version: input.baseVersion,
      complete: true,
      metadata: { id: 876543, name: 'Synthetic official-API evidence' },
      games,
    });
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        token,
        metadata: { id: 876543, name: 'Synthetic official-API evidence' },
        complete: true,
        games,
        decisions,
      }),
    });
  });
  await db.tournament.update({ where: { id: tournament.id }, data: { published: true } });
  await db.team.updateMany({ where: { tournamentId: tournament.id }, data: { published: true } });
  await db.match.update({ where: { id: matchId }, data: { published: true } });
  await page.goto(tournament.root);
  const panel = page.getByRole('region', {
    name: `Result editor for match ${number}`,
    exact: true,
  });
  const fetch = async () => {
    await page
      .getByRole('button', { name: `Edit result for match ${number}`, exact: true })
      .click();
    await panel.getByRole('button', { name: 'Import mp results', exact: true }).click();
    await panel
      .getByLabel('osu! multiplayer link', { exact: true })
      .fill('https://osu.ppy.sh/community/matches/876543');
    await panel.getByRole('button', { name: 'Fetch games', exact: true }).click();
    await expect(
      panel.getByText('Synthetic official-API evidence', { exact: false }),
    ).toBeVisible();
  };
  await fetch();
  for (const [id, side] of [
    [901, 'A'],
    [902, 'B'],
    [903, 'A'],
  ] as const) {
    await panel.getByRole('checkbox', { name: `Include game ${id}`, exact: true }).check();
    await panel.getByLabel(`Winner of game ${id}`, { exact: true }).selectOption(side);
    await panel
      .getByLabel(`Game correction reason ${id}`, { exact: true })
      .fill('Reviewed against external player scores');
  }
  await panel
    .getByLabel('Result reason / source', { exact: true })
    .fill('Accepted the reviewed multiplayer history');
  await page.screenshot({
    path: info.outputPath('multiplayer-review-desktop.png'),
    fullPage: true,
  });
  await panel.getByRole('button', { name: 'Save result', exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(await db.multiplayerGame.count({ where: { matchId } })).toBe(4);
  expect(await db.matchMapAction.count({ where: { matchId } })).toBe(0);
  const version = (await db.match.findUniqueOrThrow({ where: { id: matchId } })).version;
  await fetch();
  await panel
    .getByLabel('Result reason / source', { exact: true })
    .fill('Reviewed the same multiplayer history');
  await panel.getByRole('button', { name: 'Save result', exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect((await db.match.findUniqueOrThrow({ where: { id: matchId } })).version).toBe(version);
  await fetch();
  await panel.getByLabel('Winner of game 903', { exact: true }).selectOption('B');
  await panel
    .getByLabel('Game correction reason 903', { exact: true })
    .fill('Corrected the external winner after review');
  await panel
    .getByLabel('Result reason / source', { exact: true })
    .fill('Reviewed the final map correction');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('multiplayer-review-mobile.png'), fullPage: true });
  await panel.getByRole('button', { name: 'Save result', exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(await db.match.findUniqueOrThrow({ where: { id: matchId } })).toMatchObject({
    scoreA: 1,
    scoreB: 2,
    winnerSide: 'B',
  });
  expect(await db.multiplayerGame.count({ where: { matchId } })).toBe(4);
  expect(await db.matchResultRevision.count({ where: { matchId } })).toBe(2);
  await page.goto(`/t/${tournament.id}/matches/${number}`);
  await expect(
    page
      .getByRole('region', { name: 'Imported multiplayer history', exact: true })
      .locator('tbody tr'),
  ).toHaveCount(3);
  await expect(page.locator('main')).not.toContainText(
    'Corrected the external winner after review',
  );
});

for (const appearance of ['light', 'dark'])
  test(`Matches organizer result controls fit responsive layouts in ${appearance}`, async ({
    page,
    context,
    tournament,
  }, info) => {
    test.setTimeout(120000);
    await context.addCookies([
      { name: 'portal_appearance', value: appearance, url: 'http://localhost:3001' },
    ]);
    await page.goto(tournament.root);
    for (const [width, height] of [
      [1920, 1080],
      [1366, 900],
      [1024, 768],
      [768, 1024],
      [390, 844],
      [375, 812],
      [320, 740],
      [844, 390],
      [683, 512],
    ]) {
      await page.setViewportSize({ width, height });
      await page
        .getByRole('button', {
          name: `Edit result for match ${tournament.matches[0].matchNumber}`,
          exact: true,
        })
        .click();
      await expect(page.getByRole('heading', { name: /Match.*Result/ })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: info.outputPath(`matches-result-${appearance}-${width}.png`),
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Close result editor', exact: true }).click();
    }
    await page
      .getByRole('button', {
        name: `Edit result for match ${tournament.matches[0].matchNumber}`,
        exact: true,
      })
      .click();
    await page.getByLabel('Score for Entrant 0', { exact: true }).fill('2');
    await page
      .getByLabel('Result reason / source', { exact: true })
      .fill('Authored source note stays unchanged');
    await page.getByRole('button', { name: 'Interface language', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Italiano', exact: true }).click();
    await expect(page.getByLabel('Punteggio di Entrant 0', { exact: true })).toHaveValue('2');
    await expect(page.getByLabel('Motivo / fonte del risultato', { exact: true })).toHaveValue(
      'Authored source note stays unchanged',
    );
    await page.screenshot({
      path: info.outputPath(`matches-result-italian-${appearance}.png`),
      fullPage: true,
    });
    await page.getByRole('button', { name: "Lingua dell'interfaccia", exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'English', exact: true }).click();
    await expect(page.getByLabel('Score for Entrant 0', { exact: true })).toHaveValue('2');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Close result editor', exact: true }).click();
  });

test('edits stage, staff, referee, and notes in one atomic bulk save', async ({
  page,
  tournament,
}, testInfo) => {
  await page.goto(tournament.root);
  await page.getByLabel('Select all visible matches', { exact: true }).check();
  await page.getByRole('button', { name: 'Bulk schedule / assign', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: tournament.refName, exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'Stage', exact: true }).check();
  await dialog.getByLabel('Target stage', { exact: true }).selectOption(tournament.targetStageId);
  await dialog.getByRole('checkbox', { name: 'Streamer', exact: true }).check();
  await dialog.getByRole('textbox', { name: 'Streamer', exact: true }).fill('Stream QA');
  await dialog.getByRole('checkbox', { name: 'Commentators', exact: true }).check();
  await dialog
    .getByRole('textbox', { name: 'Commentators, one per line', exact: true })
    .fill('Caster One\nCaster Two');
  await dialog.getByRole('checkbox', { name: 'Notes', exact: true }).check();
  await dialog.getByLabel('Match notes', { exact: true }).fill('Saved in the real browser');
  await page.screenshot({ path: testInfo.outputPath('matches-bulk-desktop.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Apply to 2 matches', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const records = await db.match.findMany({
    where: { tournamentId: tournament.id },
    include: { assignments: true },
  });
  expect(records).toHaveLength(2);
  for (const record of records) {
    expect(record.stageId).toBe(tournament.targetStageId);
    expect(record.rules).toMatchObject({ bestOf: 5 });
    expect(record.notes).toBe('Saved in the real browser');
    expect(record.source).toMatchObject({
      worksheet: 'Original fixture',
      provenance: { keep: true },
      streamer: 'Stream QA',
      commentators: ['Caster One', 'Caster Two'],
    });
    expect(record.assignments.map((assignment) => assignment.userId)).toEqual([tournament.refId]);
  }
});

test('pastes and persists per-match times and referee patches on mobile', async ({
  page,
  tournament,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(tournament.root);
  await page.getByRole('button', { name: 'Paste schedule', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Schedule TSV or CSV')
    .fill(
      `match_number\tscheduled_at\treferee\n${tournament.matches[0].matchNumber}\t2030-06-12T10:00:00Z\t${tournament.refName}\n${tournament.matches[1].matchNumber}\t2030-06-12T11:00:00Z\t-`,
    );
  await dialog.getByRole('button', { name: 'Preview schedule', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('row')).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath('schedule-paste-mobile.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Apply 2 schedule rows', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const records = await db.match.findMany({
    where: { tournamentId: tournament.id },
    orderBy: { matchNumber: 'asc' },
    include: { assignments: true, events: true },
  });
  expect(records[0].scheduledAt?.toISOString()).toBe('2030-06-12T10:00:00.000Z');
  expect(records[1].scheduledAt?.toISOString()).toBe('2030-06-12T11:00:00.000Z');
  expect(records[0].assignments.map((assignment) => assignment.userId)).toEqual([tournament.refId]);
  expect(records[1].assignments).toEqual([]);
  expect(
    records.every((record) => record.events.some((event) => event.kind === 'batch.schedule')),
  ).toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Paste schedule', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
