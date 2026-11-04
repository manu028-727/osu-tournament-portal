import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { translator } from '../../src/lib/i18n';
import { tournamentRows } from '../helpers/tournament-rows';
import {
  cleanupSimulation,
  createPlayers,
  createTournament,
  db,
  login,
  loginAs,
  setupSimulation,
  unique,
} from './helpers/simulation';

const evidence = '.data/tournament-deletion-20261104';
const origin = 'http://localhost:3001';
const format = {
  template: /^Bracket only/,
  numbers: { 'Players per side': 2, 'Players on a roster': 3 },
};
test.setTimeout(300_000);
test.use({ actionTimeout: 20_000 });
test.beforeAll(async () => {
  await setupSimulation();
  await mkdir(evidence, { recursive: true });
});
test.afterAll(cleanupSimulation);

const acronymOf = async (id: string) =>
  (await db.tournament.findUniqueOrThrow({ where: { id } })).acronym;
const cardOf = (page: Page, name: string) => page.locator('article', { hasText: name });
const openDialog = async (page: Page, name: string, language: 'en' | 'it' = 'en') => {
  const tr = translator(language);
  await page.goto('/admin/tournaments');
  await cardOf(page, name)
    .getByRole('button', { name: tr('Delete'), exact: true })
    .click();
  return page.getByRole('dialog', { name: tr('Delete tournament') });
};
const uploadBanner = async (context: BrowserContext, slug: string) => {
  const buffer = await sharp({
    create: { width: 16, height: 16, channels: 3, background: '#cc6699' },
  })
    .png()
    .toBuffer();
  const response = await context.request.post(`/api/media?tournament=${slug}`, {
    headers: { Origin: origin },
    multipart: { file: { name: 'banner.png', mimeType: 'image/png', buffer } },
  });
  expect(response.status(), await response.text()).toBeLessThan(300);
  return ((await response.json()) as { id: string }).id;
};

test('a platform administrator downloads a copy, deletes the tournament and starts again at the same address', async ({
  page,
  context,
}) => {
  await login(context);
  const name = unique('Delete Me');
  const t = await createTournament(page, name, format);
  const acronym = await acronymOf(t.id);
  const mediaId = await uploadBanner(context, t.slug);
  const [captain] = await createPlayers(1);
  await db.team.create({
    data: {
      tournamentId: t.id,
      name: 'Doomed Team',
      slug: 'doomed-team',
      status: 'APPROVED',
      published: true,
      members: { create: { osuId: captain, captain: true, position: 0 } },
    },
  });
  await db.tournament.update({
    where: { id: t.id },
    data: { published: true, version: { increment: 1 } },
  });

  const dialog = await openDialog(page, name);
  await expect(dialog).toContainText(name);
  await expect(dialog).toContainText('Stages: 5. Entrants: 1. Matches: 0.');
  const confirm = dialog.getByRole('button', { name: 'Delete tournament', exact: true });
  const field = dialog.getByLabel(`Type ${acronym} to confirm`, { exact: true });

  // Only the acronym opens the button: not nothing, not the name, not a different case.
  await expect(confirm).toBeDisabled();
  for (const wrong of [name, `${acronym.toLowerCase()}x`, acronym.toLowerCase()]) {
    await field.fill(wrong);
    await expect(confirm).toBeDisabled();
  }

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export Tournament', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  expect(await tournamentRows(db, t.id)).not.toEqual({});

  await field.fill(acronym);
  await confirm.click();
  await expect(page.locator('.toast[role="status"]').last()).toContainText('Tournament deleted.');
  await expect(dialog).toBeHidden();
  await expect(cardOf(page, name)).toHaveCount(0);

  expect(await tournamentRows(db, t.id)).toEqual({});
  expect(await db.participant.count({ where: { osuId: captain } })).toBe(1);
  expect((await context.request.get(`/api/media/${mediaId}`)).status()).toBe(404);
  expect((await page.goto(`/t/${t.slug}`))!.status()).toBe(404);
  const receipt = await db.auditLog.findFirstOrThrow({
    where: { action: 'tournament.delete', entityId: t.id },
  });
  expect(receipt.details).toMatchObject({ name, acronym, slug: t.slug, teams: 1, files: 1 });

  const again = await createTournament(page, name, format);
  expect(again.slug).toBe(t.slug);
  expect(again.id).not.toBe(t.id);
  expect(await db.team.count({ where: { tournamentId: again.id } })).toBe(0);
});

test('a live match stops it with the reason, in either language, and changes nothing', async ({
  page,
  context,
}) => {
  await login(context);
  const name = unique('Live Cup');
  const t = await createTournament(page, name, format);
  const acronym = await acronymOf(t.id);
  const stage = await db.tournamentStage.findFirstOrThrow({ where: { tournamentId: t.id } });
  const match = await db.match.create({
    data: {
      tournamentId: t.id,
      code: unique('live'),
      stageId: stage.id,
      participants: {},
      rules: {},
      status: 'IN_PROGRESS',
    },
  });
  const before = await tournamentRows(db, t.id);

  const dialog = await openDialog(page, name);
  await dialog.getByLabel(`Type ${acronym} to confirm`, { exact: true }).fill(acronym);
  await dialog.getByRole('button', { name: 'Delete tournament', exact: true }).click();
  const refusal = page.locator('.toast[role="alert"]');
  await expect(refusal).toContainText(
    'Finish or cancel active matches and qualifier lobbies before deleting this tournament',
  );
  await expect(refusal).toContainText(String(match.matchNumber ?? match.code));
  await expect(dialog).toBeVisible();
  expect(await tournamentRows(db, t.id)).toEqual(before);
  // The reason has to be readable over the open dialog, on a phone too.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(refusal).toBeInViewport();
  await refusal.evaluate((toast) =>
    Promise.all(toast.getAnimations().map((animation) => animation.finished)),
  );
  await page.screenshot({ path: `${evidence}/refused-light-390.png` });

  await login(context, 'it');
  const italian = translator('it');
  const tradotto = await openDialog(page, name, 'it');
  await tradotto.getByLabel(italian('Type {0} to confirm', acronym), { exact: true }).fill(acronym);
  await tradotto.getByRole('button', { name: italian('Delete tournament'), exact: true }).click();
  await expect(page.locator('.toast[role="alert"]')).toContainText(
    'Termina o annulla gli incontri e le lobby di qualifica attivi',
  );

  await db.match.update({ where: { id: match.id }, data: { status: 'COMPLETED' } });
  await tradotto.getByRole('button', { name: italian('Delete tournament'), exact: true }).click();
  await expect(page.locator('.toast[role="status"]')).toContainText('Torneo eliminato.');
  expect(await tournamentRows(db, t.id)).toEqual({});
});

test('a tournament Owner is not offered it and cannot use it', async ({ page, context }) => {
  await login(context);
  const name = unique('Owned Cup');
  const t = await createTournament(page, name, format);
  const acronym = await acronymOf(t.id);
  const [osuId] = await createPlayers(1);
  await loginAs(context, osuId);
  const user = await db.user.findUniqueOrThrow({ where: { osuId } });
  const role = await db.role.findFirstOrThrow({
    where: { tournamentId: t.id, templateKey: 'Owner' },
  });
  await db.userRole.create({ data: { userId: user.id, roleId: role.id, tournamentId: t.id } });

  await page.goto('/admin/tournaments');
  const card = cardOf(page, name);
  await expect(card.getByRole('button', { name: 'Archive', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  const response = await context.request.post('/api/tournaments', {
    headers: { Origin: origin },
    data: { type: 'delete', id: t.id, baseVersion: 1, confirmation: acronym },
  });
  expect(response.status()).toBe(403);
  expect(await db.tournament.count({ where: { id: t.id } })).toBe(1);
});

test('the dialog and the list hold together at every width in both appearances', async ({
  page,
  context,
}) => {
  await login(context);
  // Long enough to wrap, since the name appears in the sentence that explains the delete.
  const name = unique('A Tournament With A Rather Long Name For Narrow Phone Screens');
  const t = await createTournament(page, name, format);
  const acronym = await acronymOf(t.id);
  const sizes = [
    [1920, 1080],
    [1366, 768],
    [768, 1024],
    [390, 844],
    [320, 700],
  ];
  for (const appearance of ['light', 'dark'])
    for (const [width, height] of sizes) {
      await context.addCookies([{ name: 'portal_appearance', value: appearance, url: origin }]);
      await page.setViewportSize({ width, height });
      const dialog = await openDialog(page, name);
      await dialog.getByLabel(`Type ${acronym} to confirm`, { exact: true }).fill(acronym);
      const confirm = dialog.getByRole('button', { name: 'Delete tournament', exact: true });
      await confirm.scrollIntoViewIfNeeded();
      await expect(confirm).toBeInViewport();
      const box = (await dialog.boundingBox())!;
      expect(box.x, `dialog at ${width}`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `dialog at ${width}`).toBeLessThanOrEqual(width);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `page at ${width}`).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `${evidence}/dialog-${appearance}-${width}.png` });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await cardOf(page, name).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${evidence}/card-${appearance}-${width}.png` });
    }

  // Deleting the last tournament leaves a platform administrator here, with the way forward.
  await page.route('**/api/tournaments', (route) =>
    route.fulfill({ json: { tournaments: [], users: [], platform: null } }),
  );
  await page.goto('/admin/tournaments');
  await expect(page.getByText('No tournaments yet.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create tournament', exact: true })).toBeVisible();
  await page.screenshot({ path: `${evidence}/empty-dark-320.png` });
});
