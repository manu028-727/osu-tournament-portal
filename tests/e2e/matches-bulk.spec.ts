import { test as base, expect } from '@playwright/test';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { inheritedRules } from '../../src/lib/gameplay-scoring';
import { DEFAULT_COPY } from '../../src/lib/copy';
import { assertTestDatabase } from '../../src/lib/instance';

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
