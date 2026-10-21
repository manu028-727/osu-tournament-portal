import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { matchRulesSchema } from '../../src/lib/match-rules';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
const prefix = `archive-e2e-${Date.now()}`,
  raw = randomBytes(32).toString('base64url');
let ownerId: string;
const ids: string[] = [];
test.beforeAll(async () => {
  if (new URL(process.env.TEST_DATABASE_URL!).pathname !== '/tournament_platform_test')
    throw Error('Test DB only.');
  ownerId = (
    await db.user.create({
      data: {
        osuId: 988710001,
        username: prefix,
        avatarUrl: '/test-image.webp',
        profileUrl: '',
        platformAdmin: true,
        sessions: {
          create: {
            id: createHash('sha256').update(raw).digest('hex'),
            expiresAt: new Date(Date.now() + 3600000),
          },
        },
      },
    })
  ).id;
});
test.afterAll(async () => {
  for (const id of ids.reverse()) {
    await db.match.deleteMany({ where: { tournamentId: id } });
    await db.tournamentStage.deleteMany({ where: { tournamentId: id } });
    await db.page.updateMany({
      where: { tournamentId: id },
      data: { draftRevisionId: null, publishedRevisionId: null },
    });
    await db.role.deleteMany({ where: { tournamentId: id } });
    await db.auditLog.deleteMany({ where: { tournamentId: id } });
    const media = await db.mediaAsset.findMany({ where: { tournamentId: id } });
    await db.mediaAsset.deleteMany({ where: { tournamentId: id } });
    for (const asset of media) {
      expect(asset.key).toMatch(/^[a-f0-9-]+\.webp$/);
      await unlink(path.resolve('.data/test-uploads', asset.key)).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    await db.tournament.delete({ where: { id } });
  }
  await db.tournamentTransfer.deleteMany({ where: { initiatedBy: ownerId } });
  await db.user.delete({ where: { id: ownerId } });
  await db.$disconnect();
});
test('organizer downloads, previews and imports a new private tournament with its match history', async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.addCookies([
    { name: 'tournament_session', value: raw, url: 'http://localhost:3001' },
  ]);
  const origin = { Origin: 'http://localhost:3001' };
  const response = await context.request.post('/api/tournaments', {
    headers: origin,
    data: { type: 'create', name: prefix, acronym: 'QA', slug: prefix, gameMode: 'osu' },
  });
  expect(response.ok()).toBe(true);
  const created = await response.json();
  ids.push(created.id);
  const stage = await db.tournamentStage.create({
    data: { tournamentId: created.id, name: 'Finals', slug: 'finals', position: 0 },
  });
  const match = await db.match.create({
    data: {
      tournamentId: created.id,
      code: '1',
      stageId: stage.id,
      rules: matchRulesSchema.parse({ bestOf: 9 }),
      participants: { A: { name: 'Red', members: [] }, B: { name: 'Blue', members: [] } },
      scoreA: 5,
      scoreB: 3,
      status: 'COMPLETED',
      winnerSide: 'A',
      resultMode: 'SUMMARY',
      lobbyUrl: 'https://osu.ppy.sh/community/matches/12345',
    },
  });
  await db.matchMapAction.createMany({
    data: [
      { matchId: match.id, sequence: 1, kind: 'BAN', side: 'A', slotName: 'NM1', category: 'NM' },
      { matchId: match.id, sequence: 2, kind: 'PICK', side: 'B', slotName: 'HD1', category: 'HD' },
    ],
  });
  await page.goto(`/t/${prefix}/admin/settings`);
  let saves = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/admin/action') && request.method() === 'POST') saves++;
  });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Tournament', exact: true }).click();
  const downloaded = await download;
  const bytes = await readFile((await downloaded.path())!);
  expect(downloaded.suggestedFilename()).toBe(`${prefix}-tournament-v1.zip`);
  expect(saves).toBe(0);
  await page.goto('/admin/tournaments');
  await page.getByRole('button', { name: 'Import Tournament', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Tournament archive (.zip)')
    .setInputFiles({ name: 'tournament.zip', mimeType: 'application/zip', buffer: bytes });
  const previewResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/tournament-transfer/import') &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Preview archive', exact: true }).click();
  const preview = await (await previewResponse).json();
  expect(preview.counts.actions).toBe(2);
  expect(preview.slugConflict).toBe(true);
  await dialog.getByLabel('New tournament URL slug').fill(`${prefix}-imported`);
  await expect(
    dialog.getByRole('button', { name: 'Import as unpublished', exact: true }),
  ).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Import as unpublished', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Import complete', exact: true })).toBeVisible();
  const imported = await db.tournament.findUniqueOrThrow({ where: { slug: `${prefix}-imported` } });
  ids.push(imported.id);
  expect(imported.published).toBe(false);
  expect(await db.matchMapAction.count({ where: { match: { tournamentId: imported.id } } })).toBe(
    2,
  );
  expect(await db.match.count({ where: { tournamentId: created.id } })).toBe(1);
  const guest = await browser.newContext();
  try {
    expect((await guest.request.get(`/t/${imported.slug}`)).status()).toBe(404);
    expect(
      (
        await guest.request.post(`/api/tournament-transfer/export?tournament=${prefix}`, {
          headers: origin,
        })
      ).status(),
    ).toBe(401);
    expect(
      (await guest.request.post('/api/tournament-transfer/import', { headers: origin })).status(),
    ).toBe(401);
  } finally {
    await guest.close();
  }
  const duplicate = await context.request.post('/api/tournament-transfer/import', {
    headers: origin,
    multipart: {
      file: { name: 'tournament.zip', mimeType: 'application/zip', buffer: bytes },
      operation: 'import',
      slug: imported.slug,
      acknowledgement: 'NEW_UNPUBLISHED',
      fingerprint: preview.fingerprint,
    },
  });
  expect(duplicate.status()).toBe(409);
  expect(
    (
      await context.request.post(`/api/tournament-transfer/export?tournament=${prefix}`, {
        headers: { Origin: 'https://untrusted.example' },
      })
    ).status(),
  ).toBe(403);
  await dialog.getByRole('link', { name: 'Review unpublished tournament' }).click();
  await expect(page).toHaveURL(`http://localhost:3001/t/${imported.slug}/admin`);
  await page.goto(`/t/${imported.slug}/admin/matches`);
  await expect(page.getByRole('heading', { name: 'Matches', exact: true })).toBeVisible();
  await page.reload();
  expect(await db.matchMapAction.count({ where: { match: { tournamentId: imported.id } } })).toBe(
    2,
  );
  expect(errors).toEqual([]);
});
