import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { inheritedRules } from '../../src/lib/gameplay-scoring';

const url = process.env.TEST_DATABASE_URL!;
if (new URL(url).pathname !== '/tournament_platform_test')
  throw Error('Isolated test database required');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const slug = `referee-rules-${randomUUID()}`;
const evidence = '.data/setup-workspace-20261103';
const token = randomBytes(32).toString('base64url');
const players = [0, 1].map(() => randomInt(1_650_000_000, 1_680_000_000));
const beatmapIds = [
  randomInt(1_680_000_001, 1_690_000_000),
  randomInt(1_680_000_001, 1_690_000_000),
];
let userId = '';
let matchId = '';

test.beforeAll(async () => {
  const user = await db.user.create({
    data: {
      osuId: randomInt(1_750_000_000, 1_790_000_000),
      username: `rules-${slug.slice(14, 22)}`,
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
  userId = user.id;
  const rules = inheritedRules(
    {
      teamSize: 1,
      bestOf: 3,
      bansPerTeam: 0,
      banOrder: 'ABAB',
      multiplierMode: 'NONE',
      freeModRequiredHD: 0,
      freeModRequiredHR: 0,
      replayAllowance: { scope: 'PLAYER', perMatch: 1 },
      timerExpiry: { pick: 'RANDOM_MAP', ban: 'NONE', ready: 'NONE', warnFirst: true },
    },
    'SCORE_V2',
  );
  await db.tournament.create({
    data: {
      id: slug,
      slug,
      name: 'Referee rules',
      acronym: 'REF',
      description: '',
      format: 'SOLO',
      settings: {
        create: {
          banner: '',
          gameplayScoring: 'SCORE_V2',
          matchRules: JSON.parse(JSON.stringify(rules)),
          socialLinks: [],
          importantDates: [],
          navigation: [],
          footer: '',
        },
      },
    },
  });
  const stage = await db.tournamentStage.create({
    data: { tournamentId: slug, name: 'Finals', slug: 'finals', kind: 'ELIMINATION', position: 0 },
  });
  const pool = await db.mappool.create({ data: { tournamentId: slug, stageId: stage.id } });
  const revision = await db.mappoolRevision.create({
    data: { tournamentId: slug, mappoolId: pool.id },
  });
  for (const [position, id] of beatmapIds.entries()) {
    const metadata = {
      id,
      mode: 'osu',
      title: `Map ${position + 1}`,
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
      cover: '/test-image.webp',
      url: `https://osu.ppy.sh/beatmaps/${id}`,
    };
    await db.beatmap.create({ data: { id, mode: 'osu', metadata } });
    await db.mappoolSlot.create({
      data: {
        revisionId: revision.id,
        name: `NM${position + 1}`,
        category: 'NM',
        categoryName: 'No Mod',
        color: '#90bdf4',
        position,
        beatmapId: id,
        metadata,
      },
    });
  }
  await db.mappool.update({
    where: { id: pool.id },
    data: { state: 'PUBLISHED', publishedRevisionId: revision.id, draftRevisionId: revision.id },
  });
  const side = (name: string, osuId: number) => ({
    id: name,
    name,
    slug: name.toLowerCase(),
    format: 'INDIVIDUAL',
    logoImageId: null,
    members: [
      { osuId, username: `${name} player`, avatarUrl: '', captain: true, substitute: false },
    ],
  });
  const match = await db.match.create({
    data: {
      tournamentId: slug,
      code: 'rules-1',
      stageId: stage.id,
      poolRevisionId: revision.id,
      status: 'IN_PROGRESS',
      startedAt: new Date(),
      rollA: 90,
      rollB: 10,
      firstPickSide: 'A',
      firstBanSide: 'A',
      published: true,
      rules: JSON.parse(JSON.stringify(rules)),
      participants: { A: side('Alpha', players[0]), B: side('Bravo', players[1]) },
      // The pick timer ran out a minute ago.
      timerKind: 'PICK',
      timerRemainingSeconds: 10,
      timerStartedAt: new Date(Date.now() - 60_000),
    },
  });
  matchId = match.id;
});
test.afterAll(async () => {
  await db.match.deleteMany({ where: { tournamentId: slug } });
  await db.mappool.updateMany({
    where: { tournamentId: slug },
    data: { publishedRevisionId: null, draftRevisionId: null },
  });
  await db.mappool.deleteMany({ where: { tournamentId: slug } });
  await db.tournamentStage.deleteMany({ where: { tournamentId: slug } });
  await db.auditLog.deleteMany({ where: { tournamentId: slug } });
  await db.tournament.deleteMany({ where: { id: slug } });
  await db.beatmap.deleteMany({ where: { id: { in: beatmapIds } } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

test('a referee is told what the rules ask for and records what they decided', async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: 'tournament_session',
      value: token,
      url: 'http://localhost:3001',
      httpOnly: true,
      sameSite: 'Lax',
    },
    { name: 'portal_language', value: 'en', url: 'http://localhost:3001' },
  ]);
  await page.goto(`/t/${slug}/admin/referee/${matchId}`);
  await page.getByText('Timers, replays and sanctions').click();

  // First overrun is a warning, the next is what the rules name, with the command to use.
  await expect(page.getByText('The rules ask for: Warning')).toBeVisible();
  await page.getByRole('button', { name: 'Record it' }).click();
  await expect(page.getByText('Sanction recorded.')).toBeVisible();
  await expect(page.getByText('The rules ask for: A random map is chosen')).toBeVisible();
  await expect(page.getByText('!roll 2')).toBeVisible();
  const event = await db.matchEvent.findFirstOrThrow({
    where: { matchId, kind: 'match.sanction' },
  });
  expect(event.side).toBe('A');

  // Nothing moved by itself: the same team is still picking, and the score is untouched.
  const match = await db.match.findUniqueOrThrow({ where: { id: matchId } });
  expect([match.scoreA, match.scoreB, match.status]).toEqual([0, 0, 'IN_PROGRESS']);
  await page.screenshot({ path: `${evidence}/referee-rules-1366.png`, fullPage: true });

  await db.matchMapAction.create({
    data: {
      matchId,
      sequence: 1,
      kind: 'PICK',
      side: 'A',
      slotName: 'NM1',
      category: 'NM',
      actorId: userId,
    },
  });
  await page.reload();
  await page.getByText('Timers, replays and sanctions').click();
  await page.getByLabel('Player', { exact: true }).selectOption(String(players[0]));
  await expect(page.getByText('0 of 1 replays used.')).toBeVisible();
  await page.getByLabel('Why this replay or draw').fill('Disconnected in the first quarter');
  await page.getByRole('button', { name: 'Record attempt' }).click();
  await expect(page.getByText('Attempt recorded.')).toBeVisible();
  await expect(page.getByText('1 of 1 replays used.')).toBeVisible();
  await expect(page.getByText('Recording this goes over the allowance.')).toBeVisible();
  await page.getByLabel('Why this replay or draw').fill('Referee allowed a second one');
  await page.getByRole('button', { name: 'Record attempt' }).click();
  await expect.poll(() => db.matchMapAttempt.count({ where: { matchId } })).toBe(2);
  const attempts = await db.matchMapAttempt.findMany({
    where: { matchId },
    orderBy: { createdAt: 'asc' },
  });
  expect(attempts.map((row) => row.beyondAllowance)).toEqual([false, true]);

  // Losing a map goes through the normal result, so the point is real and audited.
  await page.getByLabel('Sanction', { exact: true }).selectOption('MAP_LOSS');
  await page.getByLabel('Team').last().selectOption('A');
  await page.getByLabel('Why this sanction').fill('Refused to ready up');
  await page.getByRole('button', { name: 'Record sanction' }).click();
  await expect(page.getByText('Sanction recorded.')).toBeVisible();
  await expect
    .poll(async () => (await db.match.findUniqueOrThrow({ where: { id: matchId } })).scoreB)
    .toBe(1);
});
