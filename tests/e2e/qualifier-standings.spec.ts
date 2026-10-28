import { test as base, expect } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '../../src/generated/prisma/client';
import { DEFAULT_COPY } from '../../src/lib/copy';
import { qualifierPolicySchema } from '../../src/lib/qualifier-policy';
import { calculateQualifierStandings, qualifierSourceHash } from '../../src/lib/qualifier-seeding';
import type {
  QualifierStandingsData,
  QualifierStandingVersion,
} from '../../src/lib/qualifier-standings-contract';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/tournament_platform_test')
  throw new Error('Qualifier UI fixtures require tournament_platform_test.');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const test = base.extend<{
  qualifierUi: {
    root: string;
    payload: QualifierStandingsData;
    submissions: Record<string, unknown>[];
  };
}>({
  qualifierUi: async ({ context, page, baseURL }, use) => {
    const slug = `qualifier-ui-${randomUUID()}`,
      token = randomBytes(32).toString('base64url');
    const user = await db.user.create({
      data: {
        osuId: randomInt(1_720_000_000, 1_730_000_000),
        username: slug,
        avatarUrl: '',
        profileUrl: '',
        platformAdmin: true,
      },
    });
    let created = false;
    try {
      await db.tournament.create({
        data: {
          id: slug,
          slug,
          name: slug,
          acronym: 'QUI',
          description: '',
          settings: {
            create: {
              banner: '',
              gameplayScoring: 'SCORE_V2',
              socialLinks: [],
              importantDates: [],
              navigation: [],
              footer: '',
              copy: DEFAULT_COPY,
            },
          },
        },
      });
      created = true;
      await db.session.create({
        data: {
          id: createHash('sha256').update(token).digest('hex'),
          userId: user.id,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      const origin = new URL(baseURL!).origin;
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
      const stageId = 'qualifier-ui-stage';
      const calculation = calculateQualifierStandings({
        tournamentId: slug,
        stageId,
        gameplayScoring: 'SCORE_V2',
        policy: qualifierPolicySchema.parse({}),
        maps: [{ slotName: 'NM1', beatmapId: 1 }],
        participants: [
          { id: 'red', name: 'Red', roster: [1] },
          { id: 'blue', name: 'Blue', roster: [2] },
        ],
        scores: [100, 50].map((raw, index) => ({
          id: `score-${index}`,
          lobbyId: 'lobby',
          participantId: index === 0 ? 'red' : 'blue',
          osuId: index + 1,
          slotName: 'NM1',
          run: 1,
          raw,
          adjusted: raw,
          mods: [],
          actualScoring: 'SCORE_V2',
          representation: 'LEGACY',
          source: 'MANUAL',
          gameId: null,
          verified: true,
        })),
      });
      const now = new Date().toISOString();
      const final: QualifierStandingVersion = {
        id: 'standing-2',
        version: 2,
        published: true,
        sourceHash: calculation.sourceHash,
        createdAt: now,
        stale: false,
        snapshot: {
          state: 'FINALIZED',
          calculation,
          calculatedBy: user.id,
          calculatedAt: now,
          finalizedAt: now,
          cutoff: null,
          tieResolution: null,
          seeds: [
            { teamId: 'red', seed: 1, qualified: true },
            { teamId: 'blue', seed: 2, qualified: true },
          ],
        },
      };
      const payload: QualifierStandingsData = {
        stage: { id: stageId, name: 'Qualifiers' },
        preview: calculation,
        latest: final,
        versions: [final],
        locked: true,
        canManage: true,
        correctionImpact: {
          brackets: [
            {
              id: 'main',
              name: 'Main bracket',
              version: 3,
              published: false,
              sourceStandingId: final.id,
              sourceBracketId: null,
              nodes: [],
            },
          ],
          blockingMatches: [],
          impactHash: qualifierSourceHash('review-fixture'),
          canReopen: true,
        },
      };
      const submissions: Record<string, unknown>[] = [];
      await page.route(/\/api\/admin\/data(?:\?|$)/, async (route) => {
        const section = new URL(route.request().url()).searchParams.get('section');
        if (section === 'qualifier-stages')
          return route.fulfill({ json: [{ id: stageId, name: 'Qualifiers' }] });
        if (section === 'qualifier-standings') return route.fulfill({ json: payload });
        return route.continue();
      });
      await page.route(/\/api\/admin\/action(?:\?|$)/, async (route) => {
        const submitted = route.request().postDataJSON() as Record<string, unknown>;
        submissions.push(submitted);
        const reopened: QualifierStandingVersion = {
          ...final,
          id: 'standing-3',
          version: 3,
          published: false,
          snapshot: { ...final.snapshot, state: 'REOPENED', seeds: [], finalizedAt: null },
        };
        payload.latest = reopened;
        payload.versions = [reopened, { ...final, published: false, stale: true }];
        payload.locked = false;
        payload.correctionImpact = null;
        await route.fulfill({ json: { id: reopened.id, version: reopened.version } });
      });
      await use({ root: `/t/${slug}`, payload, submissions });
    } finally {
      if (created) await db.tournament.deleteMany({ where: { id: slug } });
      await db.user.deleteMany({ where: { id: user.id } });
    }
  },
});
test.afterAll(async () => {
  await db.$disconnect();
});

for (const colorScheme of ['light', 'dark'] as const)
  test(`reviews qualifier correction in ${colorScheme} appearance`, async ({
    page,
    qualifierUi,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(`${qualifierUi.root}/admin/qualifier-results`);
    await page.getByRole('button', { name: 'Review correction', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Reopen qualifier results' });
    await expect(dialog.getByRole('cell', { name: 'Main bracket', exact: true })).toBeVisible();
    const reopen = dialog.getByRole('button', { name: 'Reopen for correction', exact: true });
    await expect(reopen).toBeDisabled();
    await dialog
      .getByRole('textbox', { name: 'Correction reason' })
      .fill('Original game score was verified by the organizer.');
    await expect(reopen).toBeDisabled();
    await dialog.getByRole('checkbox').check();
    await expect(reopen).toBeEnabled();
    await page.screenshot({
      path: testInfo.outputPath(`qualifier-review-${colorScheme}.png`),
      fullPage: true,
    });
    await reopen.click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'Reopened for correction' }).first(),
    ).toBeVisible();
    expect(qualifierUi.submissions).toEqual([
      expect.objectContaining({
        type: 'qualifier.standings.reopen',
        baseVersion: 2,
        affectedBracketIds: ['main'],
        acknowledgeImpact: true,
        reason: 'Original game score was verified by the organizer.',
      }),
    ]);
  });

test('blocks qualifier correction for started downstream matches on mobile', async ({
  page,
  qualifierUi,
}, testInfo) => {
  qualifierUi.payload.correctionImpact!.canReopen = false;
  qualifierUi.payload.correctionImpact!.blockingMatches = [
    {
      id: 'match',
      code: 'Finals 1',
      matchNumber: 1,
      reason: 'The downstream match has started or progressed.',
    },
  ];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${qualifierUi.root}/admin/qualifier-results`);
  await page.getByRole('button', { name: 'Review correction', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Reopen qualifier results' });
  await expect(dialog.getByRole('alert')).toContainText('manual historical reconciliation');
  await dialog
    .getByRole('textbox', { name: 'Correction reason' })
    .fill('A reviewed correction request.');
  await dialog.getByRole('checkbox').check();
  await expect(
    dialog.getByRole('button', { name: 'Reopen for correction', exact: true }),
  ).toBeDisabled();
  expect(qualifierUi.submissions).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath('qualifier-review-blocked-mobile.png'),
    fullPage: true,
  });
});
