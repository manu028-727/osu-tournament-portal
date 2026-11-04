import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { translator } from '../../src/lib/i18n';
import {
  cleanupSimulation,
  createPlayers,
  createTournament,
  db,
  login,
  loginAs,
  setupSimulation,
  unique,
  type Tour,
} from './helpers/simulation';

// A public form that fails without a word gets clicked again and again. These read what a captain
// sees after each attempt, because a request that returns the right status proves nothing here.
const evidence = '.data/registration-feedback-20261104';
const sizes = [
  [1920, 1080],
  [1366, 768],
  [768, 1024],
  [390, 844],
  [320, 700],
];
const origin = 'http://localhost:3001';
test.setTimeout(300_000);
test.use({ actionTimeout: 20_000 });
test.beforeAll(async () => {
  await setupSimulation();
  await mkdir(evidence, { recursive: true });
});
test.afterAll(cleanupSimulation);

// Open for registration: two a side and three on a roster, with whatever limits a test needs.
async function openTournament(page: Page, context: BrowserContext, limits: object) {
  await login(context);
  const t = await createTournament(page, unique('Register'), {
    template: /^Bracket only/,
    numbers: { 'Players per side': 2, 'Players on a roster': 3 },
  });
  const where = { tournamentId: t.id };
  const { registrationPolicy } = await db.tournamentSettings.findUniqueOrThrow({ where });
  await db.tournamentSettings.update({
    where,
    data: { registrationPolicy: { ...(registrationPolicy as object), ...limits } },
  });
  await db.tournament.update({
    where: { id: t.id },
    data: { published: true, status: 'REGISTRATIONS_OPEN' },
  });
  return t;
}

async function takePlayer(t: Tour, osuId: number) {
  await db.team.create({
    data: {
      tournamentId: t.id,
      name: unique('Already entered'),
      slug: unique('already-entered'),
      status: 'APPROVED',
      published: true,
      format: 'TEAM',
      members: { create: { osuId, captain: true, position: 0 } },
    },
  });
}

async function fillRoster(
  page: Page,
  name: string,
  players: number[],
  language: 'en' | 'it' = 'en',
) {
  const tr = translator(language);
  const entry = page.getByLabel(tr('Entry name'), { exact: true });
  await entry.clear();
  await entry.pressSequentially(name);
  for (const [index, osuId] of players.entries()) {
    await page.getByRole('button', { name: tr('Add player') }).click();
    await page
      .getByLabel(tr('Player osu! ID'), { exact: true })
      .nth(index)
      .pressSequentially(String(osuId));
  }
}

const submit = (page: Page, label = 'Register') =>
  page.getByRole('button', { name: label, exact: true }).click();
const refusal = (page: Page) => page.locator('.toast[role="alert"]');
const confirmation = (page: Page) => page.locator('.toast[role="status"]');
const teamOf = (t: Tour, osuId: number) =>
  db.team.findFirst({
    where: { tournamentId: t.id, members: { some: { osuId, captain: true } } },
    include: { members: { orderBy: { position: 'asc' } } },
  });

test('a captain learns why registration failed, fixes it and sees it succeed', async ({
  page,
  context,
}) => {
  page.on('dialog', (dialog) => void dialog.accept());
  const t = await openTournament(page, context, { maxPlayers: 3, maxSubstitutes: 0 });
  const [captain, mate, third, taken] = await createPlayers(4);
  await takePlayer(t, taken);
  await loginAs(context, captain);
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/registration'))
      posts.push(request.url());
  });
  await page.goto(`/t/${t.slug}/register`);

  // A substitute could never be accepted here, so it is not offered.
  await fillRoster(page, 'Feedback Team', [taken, third]);
  await expect(page.getByLabel('Substitute')).toHaveCount(0);

  // A display name never leaves the browser, and the field says what belongs in it.
  const usernames = page.getByLabel('Discord username (optional)', { exact: true });
  const discord = usernames.first();
  await discord.pressSequentially('Manu 028');
  await submit(page);
  await expect(discord).toBeFocused();
  await expect(discord).toHaveAttribute(
    'title',
    'Use a Discord username, not a display name or numeric ID.',
  );
  expect(await discord.evaluate((input: HTMLInputElement) => input.validity.patternMismatch)).toBe(
    true,
  );
  expect(posts).toHaveLength(0);

  // Neither does a name where an osu! number belongs.
  const player = page.getByLabel('Player osu! ID', { exact: true }).first();
  await player.clear();
  await player.pressSequentially('somebody');
  await discord.clear();
  await discord.pressSequentially('@Manu028');
  await submit(page);
  await expect(player).toBeFocused();
  expect(posts).toHaveLength(0);

  // The server keeps the same rule for anything that skips the form, and explains it.
  for (const discordUsername of ['Manu 028', '123456789012345678', 'everyone']) {
    const direct = await context.request.post(`/api/registration?tournament=${t.slug}`, {
      headers: { Origin: origin },
      data: {
        type: 'registration.save',
        baseVersion: 0,
        policyToken: 'a'.repeat(64),
        name: 'Skipping the form',
        format: 'TEAM',
        members: [{ osuId: captain, substitute: false, discordUsername }],
      },
    });
    expect(direct.status(), discordUsername).toBe(400);
    expect((await direct.json()).error).toContain(
      'Use a Discord username, not a display name or numeric ID.',
    );
  }

  // A numeric ID looks fine to the field, so the server's reason has to reach the page.
  await player.clear();
  await player.pressSequentially(String(taken));
  await discord.clear();
  await discord.pressSequentially('123456789012345678');
  await submit(page);
  await expect(refusal(page)).toContainText(
    'Use a Discord username, not a display name or numeric ID.',
  );
  expect(posts).toHaveLength(1);
  await discord.clear();
  await discord.pressSequentially('@Manu028');

  // What only the server can know reaches the page, and nothing typed is lost.
  await submit(page);
  await expect(refusal(page)).toContainText(
    'A player already belongs to another registration in this tournament.',
  );
  expect(posts).toHaveLength(2);
  expect(await teamOf(t, captain)).toBeNull();
  await expect(discord).toHaveValue('@Manu028');
  await expect(page.getByLabel('Entry name', { exact: true })).toHaveValue('Feedback Team');

  // Fixed, it goes through and says so.
  await player.clear();
  await player.pressSequentially(String(mate));
  await usernames.nth(1).pressSequentially('theblueeight');
  await usernames.nth(2).pressSequentially('burjopore');
  await submit(page);
  await expect(confirmation(page)).toContainText('Registration saved and automatically approved.');
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  const team = (await teamOf(t, captain))!;
  expect(team.status).toBe('APPROVED');
  expect(team.members.map((member) => member.osuId)).toEqual([captain, mate, third]);
  expect(team.members.map((member) => member.discordUsername)).toEqual([
    'manu028',
    'theblueeight',
    'burjopore',
  ]);

  // An older roster can still clear a substitute the tournament no longer allows.
  await db.teamMember.update({
    where: { tournamentId_osuId: { tournamentId: t.id, osuId: third } },
    data: { substitute: true },
  });
  await page.reload();
  await page.getByText('Roster and registration details', { exact: true }).click();
  await expect(discord).toHaveValue('manu028');
  const substitute = page.getByLabel('Substitute');
  await expect(substitute).toBeChecked();
  // Once cleared it cannot be chosen again here, so the choice goes away with it.
  await substitute.click();
  await expect(substitute).toHaveCount(0);
  await submit(page, 'Save registration');
  await expect(confirmation(page)).toContainText('Registration saved.');
  await expect(
    db.teamMember.findUniqueOrThrow({
      where: { tournamentId_osuId: { tournamentId: t.id, osuId: third } },
    }),
  ).resolves.toMatchObject({ substitute: false });

  // An organizer edits the same username under the same rule.
  await login(context);
  await page.goto(`/t/${t.slug}/admin/teams`);
  await page.getByRole('button', { name: 'Edit Feedback Team', exact: true }).click();
  const editing = page.getByLabel(/^Discord username for /).first();
  await expect(editing).toHaveValue('manu028');
  await editing.clear();
  await editing.pressSequentially('Manu 028');
  await page.getByRole('button', { name: 'Save team', exact: true }).click();
  await expect(editing).toBeFocused();
  await editing.clear();
  await editing.pressSequentially('@Renamed.Captain');
  await page.getByRole('button', { name: 'Save team', exact: true }).click();
  await expect(confirmation(page)).toContainText('Team saved.');
  expect((await teamOf(t, captain))!.members[0].discordUsername).toBe('renamed.captain');

  for (const appearance of ['light', 'dark'])
    for (const [width, height] of sizes) {
      await context.addCookies([{ name: 'portal_appearance', value: appearance, url: origin }]);
      await page.setViewportSize({ width, height });
      await page.goto(`/t/${t.slug}/admin/teams`);
      await page.getByRole('button', { name: 'Edit Feedback Team', exact: true }).click();
      await expect(editing).toHaveValue('renamed.captain');
      await editing.scrollIntoViewIfNeeded();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `editor at ${width}`).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `${evidence}/editor-${appearance}-${width}.png` });
    }
});

test('an entry kept for review says so instead of claiming approval, in either language', async ({
  page,
  context,
}) => {
  page.on('dialog', (dialog) => void dialog.accept());
  const t = await openTournament(page, context, {
    maxPlayers: 3,
    maxSubstitutes: 1,
    maxRank: 5000,
    ineligible: 'REVIEW',
  });
  const players = await createPlayers(4, () => ({ rank: 100_000 }));
  await loginAs(context, players[0]);
  await page.goto(`/t/${t.slug}/register`);
  await fillRoster(page, 'Kept For Review', [players[1]]);
  // With substitutes allowed, the choice is there.
  await expect(page.getByLabel('Substitute')).toHaveCount(1);
  await submit(page);
  await expect(confirmation(page)).toContainText(
    'Registration saved. An organizer will review it.',
  );
  await expect(confirmation(page)).not.toContainText('approved');
  await expect(page.getByText('Pending', { exact: true })).toBeVisible();
  expect((await teamOf(t, players[0]))!.status).toBe('PENDING');

  await loginAs(context, players[2]);
  await context.addCookies([{ name: 'portal_language', value: 'it', url: origin }]);
  await page.goto(`/t/${t.slug}/register`);
  await fillRoster(page, 'In Revisione', [players[3]], 'it');
  await submit(page, translator('it')('Register'));
  await expect(confirmation(page)).toContainText(
    'Iscrizione salvata. Un organizzatore la esaminerà.',
  );
});

test('the form and its messages hold together at every width in both appearances', async ({
  page,
  context,
}) => {
  page.on('dialog', (dialog) => void dialog.accept());
  const t = await openTournament(page, context, { maxPlayers: 3, maxSubstitutes: 0 });
  const [captain, mate, taken] = await createPlayers(3);
  await takePlayer(t, taken);
  await loginAs(context, captain);
  for (const appearance of ['light', 'dark'])
    for (const [width, height] of sizes) {
      await context.addCookies([{ name: 'portal_appearance', value: appearance, url: origin }]);
      await page.setViewportSize({ width, height });
      await page.goto(`/t/${t.slug}/register`);
      await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance);
      await fillRoster(page, 'Every Width', [mate, taken]);
      await submit(page);
      await expect(refusal(page)).toBeInViewport();
      // It fades in, and a capture taken before that ends shows the page through it.
      await refusal(page).evaluate((toast) =>
        Promise.all(toast.getAnimations().map((animation) => animation.finished)),
      );
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `register at ${width}`).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `${evidence}/refused-${appearance}-${width}.png` });
      await page.screenshot({
        path: `${evidence}/form-${appearance}-${width}.png`,
        fullPage: true,
      });
    }
});
