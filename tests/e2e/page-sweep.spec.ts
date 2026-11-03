import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { DEFAULT_MATCH_RULES } from '../../src/lib/match-rules';

const url = process.env.TEST_DATABASE_URL!;
if (new URL(url).pathname !== '/tournament_platform_test')
  throw Error('Isolated test database required');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const evidence = '.data/page-sweep-20261103';
const slug = `sweep-${randomUUID()}`;
const emptySlug = `sweep-empty-${randomUUID()}`;
const users: string[] = [];
const participants: number[] = [];
const beatmaps: number[] = [];
let token = '';
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

const ADMIN_PAGES = [
  '',
  '/website?view=homepage',
  '/website?view=rules',
  '/website?view=info',
  '/website?view=branding',
  '/website?view=navigation',
  '/website?view=media',
  '/mappools?view=pools',
  '/mappools?view=pooling',
  '/mappools?view=stages',
  '/teams',
  '/matches',
  '/matches?view=bracket',
  '/qualifier-results',
  '/staff?view=listing',
  '/staff?view=access',
  '/staff?view=roles',
  '/settings?view=configuration',
  '/settings?view=audit',
  '/settings?view=sheet',
  '/referee',
  '/referee/qualifiers',
];
const PUBLIC_PAGES = [
  '',
  '/mappools',
  '/mappools/finals',
  '/teams',
  '/staff',
  '/rules',
  '/matches',
  '/brackets',
  '/qualifiers',
  '/register',
  '/qualifier-booking',
];
const SIZES = [
  [1920, 1080, 'light'],
  [1366, 900, 'light'],
  [1366, 900, 'dark'],
  [768, 900, 'light'],
  [390, 844, 'light'],
  [390, 844, 'dark'],
  [320, 700, 'light'],
] as const;
const nameOf = (route: string) =>
  route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';

async function seedTournament(id: string, populated: boolean) {
  await db.tournament.create({
    data: {
      id,
      slug: id,
      name: populated ? 'A rather long synthetic tournament name for layout' : 'Empty tournament',
      acronym: 'SWP',
      description: populated ? 'Synthetic tournament used to review every page.' : '',
      format: 'TEAMS',
      status: 'REGISTRATIONS_OPEN',
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
        },
      },
    },
  });
  for (const [position, acronym] of ['NM', 'HD', 'HR', 'DT', 'FM', 'TB'].entries())
    await db.modCategory.create({
      data: { tournamentId: id, acronym, name: acronym, color: '#a7d9bc', position },
    });
  if (!populated) return;
  const beatmapId = randomInt(1_800_000_000, 1_900_000_000);
  beatmaps.push(beatmapId);
  const metadata = {
    id: beatmapId,
    mode: 'osu',
    title: 'A very long synthetic map title that should wrap and never push the page wider',
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
  const stage = await db.tournamentStage.create({
    data: {
      tournamentId: id,
      name: 'Finals',
      slug: 'finals',
      kind: 'ELIMINATION',
      position: 0,
      startsAt: new Date('2026-12-01T18:00:00Z'),
    },
  });
  const pool = await db.mappool.create({ data: { tournamentId: id, stageId: stage.id } });
  const revision = await db.mappoolRevision.create({
    data: { tournamentId: id, mappoolId: pool.id },
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
  const teams: { id: string; name: string }[] = [];
  for (let index = 0; index < 8; index++) {
    const osuId = randomInt(1_700_000_000, 1_790_000_000);
    participants.push(osuId);
    await db.participant.create({
      data: { osuId, username: `Player number ${index + 1}`, avatarUrl: '', country: 'IT' },
    });
    const team = await db.team.create({
      data: {
        tournamentId: id,
        name: `Team with a fairly long name ${index + 1}`,
        slug: `team-${index + 1}`,
        status: 'APPROVED',
        published: true,
        format: 'TEAM',
      },
    });
    await db.teamMember.create({
      data: { tournamentId: id, teamId: team.id, osuId, position: 0, captain: true },
    });
    teams.push({ id: team.id, name: team.name });
  }
  await db.match.create({
    data: {
      tournamentId: id,
      code: '1',
      stageId: stage.id,
      poolRevisionId: revision.id,
      teamAId: teams[0].id,
      teamBId: teams[1].id,
      rules: json(DEFAULT_MATCH_RULES),
      participants: json(
        Object.fromEntries(
          (['A', 'B'] as const).map((side, index) => [
            side,
            {
              id: teams[index].id,
              name: teams[index].name,
              slug: `team-${index + 1}`,
              format: 'TEAM',
              logoImageId: null,
              members: [
                {
                  osuId: participants[participants.length - 8 + index],
                  username: `Player number ${index + 1}`,
                  avatarUrl: '',
                  captain: true,
                  substitute: false,
                },
              ],
            },
          ]),
        ),
      ),
    },
  });
  await db.staffMember.create({
    data: {
      tournamentId: id,
      osuId: randomInt(1_700_000_000, 1_790_000_000),
      username: 'Staff member',
      avatarUrl: '',
      profileUrl: '',
    },
  });
}

async function report(page: Page, label: string, problems: string[]) {
  const { overflow, offenders } = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return {
      overflow: document.documentElement.scrollWidth - width,
      offenders: [...document.querySelectorAll('body *')]
        .filter((element) => {
          for (let up = element.parentElement; up; up = up.parentElement)
            if (['auto', 'scroll', 'hidden'].includes(getComputedStyle(up).overflowX)) return false;
          return element.getBoundingClientRect().right > width + 1;
        })
        .slice(0, 4)
        .map((element) => `${element.tagName}.${String(element.className).slice(0, 60)}`),
    };
  });
  if (overflow > 1) problems.push(`${label}: overflow ${overflow}px: ${offenders.join(' | ')}`);
}

test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true });
  await seedTournament(slug, true);
  await seedTournament(emptySlug, false);
  token = randomBytes(32).toString('base64url');
  const user = await db.user.create({
    data: {
      osuId: randomInt(1_790_000_000, 1_800_000_000),
      username: `sweep-owner-${slug.slice(6, 14)}`,
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
  const where = { tournamentId: { in: [slug, emptySlug] } };
  await db.match.deleteMany({ where });
  await db.mappool.updateMany({
    where,
    data: { publishedRevisionId: null, draftRevisionId: null },
  });
  await db.mappoolSlot.deleteMany({ where: { revision: where } });
  await db.mappoolRevision.deleteMany({ where });
  await db.mappool.deleteMany({ where });
  await db.tournamentStage.deleteMany({ where });
  await db.team.deleteMany({ where });
  await db.staffMember.deleteMany({ where });
  await db.modCategory.deleteMany({ where });
  await db.auditLog.deleteMany({ where });
  await db.role.deleteMany({ where });
  await db.tournament.deleteMany({ where: { id: { in: [slug, emptySlug] } } });
  await db.participant.deleteMany({ where: { osuId: { in: participants } } });
  await db.beatmap.deleteMany({ where: { id: { in: beatmaps } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

for (const [kind, scope] of [
  ['populated', () => slug],
  ['empty', () => emptySlug],
] as const)
  test(`every page holds together when ${kind}`, async ({ page, context }) => {
    test.setTimeout(600_000);
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(`script error: ${error.message.slice(0, 160)}`));
    const routes = [
      ...ADMIN_PAGES.map((route) => `/t/${scope()}/admin${route}`),
      ...PUBLIC_PAGES.map((route) => `/t/${scope()}${route}`),
    ];
    for (const [width, height, appearance] of SIZES) {
      await context.clearCookies();
      await context.addCookies([
        { name: 'portal_appearance', value: appearance, url: 'http://localhost:3001' },
        {
          name: 'tournament_session',
          value: token,
          url: 'http://localhost:3001',
          httpOnly: true,
          sameSite: 'Lax',
        },
        { name: 'portal_language', value: 'en', url: 'http://localhost:3001' },
      ]);
      await page.setViewportSize({ width, height });
      for (const route of routes) {
        const label = `${kind} ${width} ${appearance} ${route.replace(scope(), '')}`;
        if (kind === 'empty' && route.endsWith('/mappools/finals')) continue;
        const response = await page.goto(route, { waitUntil: 'load' });
        if ((response?.status() ?? 500) >= 400) {
          problems.push(`${label}: status ${response?.status()}`);
          continue;
        }
        await page.waitForLoadState('networkidle').catch(() => {});
        if (await page.getByText(/Something went wrong|Unable to load this page/).count())
          problems.push(`${label}: error page`);
        await report(page, label, problems);
        if (width === 1366 && appearance === 'light')
          await page.screenshot({
            path: `${evidence}/${kind}-${nameOf(route.replace(`/t/${scope()}`, ''))}-1366.png`,
          });
        if (width === 390 && appearance === 'light')
          await page.screenshot({
            path: `${evidence}/${kind}-${nameOf(route.replace(`/t/${scope()}`, ''))}-390.png`,
          });
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
