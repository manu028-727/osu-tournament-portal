import { test, expect, type Page } from '@playwright/test';
import {
  cleanupSimulation,
  createTournament,
  db,
  login,
  openPhase,
  openWorkspace,
  setupSimulation,
  stagesOf,
  unique,
} from './helpers/simulation';

// These type the way a person does, one key at a time. Setting a whole value at once is what let
// fields that reject every keystroke go unnoticed.
const evidence = '.data/setup-simple-20261103';
test.setTimeout(300_000);
test.use({ actionTimeout: 20_000 });
test.beforeAll(setupSimulation);
test.afterAll(cleanupSimulation);

const typeInto = async (page: Page, name: string, keys: string) => {
  const input = page.getByRole('spinbutton', { name, exact: true });
  await input.click();
  await input.press('Control+a');
  await input.pressSequentially(keys);
  return input;
};
const newTournament = (page: Page, name: string) =>
  createTournament(page, unique(name), {
    template: /^Qualifiers, then bracket/,
    numbers: { 'Players per side': 2, 'Players on a roster': 3 },
    selects: { 'Entrants in the bracket': '16', 'Seeding method': 'Z-Sum' },
    doubleElimination: true,
  });

test('numbers can be cleared and retyped, and stages fill in by themselves', async ({
  page,
  context,
}) => {
  await login(context);
  const t = await newTournament(page, 'Grid');
  await openWorkspace(page, t, 'stages');
  await page.setViewportSize({ width: 1366, height: 900 });

  // Clearing a count leaves it empty while typing, instead of snapping back to 0.
  const dt = page.getByRole('spinbutton', { name: 'DT maps for Finals', exact: true });
  await dt.click();
  await dt.press('Control+a');
  await dt.press('Backspace');
  await expect(dt).toHaveValue('');
  await dt.pressSequentially('5');
  await expect(dt).toHaveValue('5');

  // Leaving a field empty puts back the last good value rather than saving a blank.
  await dt.press('Control+a');
  await dt.press('Backspace');
  await page.getByRole('spinbutton', { name: 'HR maps for Finals', exact: true }).click();
  await expect(dt).toHaveValue('5');

  // A match length has to be odd, so an even one moves up when you leave the field.
  const bestOf = await typeInto(page, 'Best of for Round of 16', '12');
  await page.getByRole('spinbutton', { name: 'Bans for Round of 16', exact: true }).click();
  await expect(bestOf).toHaveValue('13');
  // A pool still on the defaults follows the new match length.
  await expect(
    page.getByRole('spinbutton', { name: 'NM maps for Round of 16', exact: true }),
  ).toHaveValue('6');

  // One row can fill in the rest of the bracket in a click.
  await page.getByRole('button', { name: 'Copy Round of 16 to the stages below' }).click();
  await expect(
    page.getByRole('spinbutton', { name: 'Best of for Grand Finals', exact: true }),
  ).toHaveValue('13');
  await expect(
    page.getByRole('spinbutton', { name: 'DT maps for Finals', exact: true }),
  ).toHaveValue('4');

  // A pool too small for its match length says so, before anyone finds out in a match.
  await typeInto(page, 'NM maps for Semifinals', '0');
  await typeInto(page, 'HD maps for Semifinals', '0');
  await typeInto(page, 'HR maps for Semifinals', '0');
  await expect(
    page
      .getByTitle('This stage needs at least 17 maps')
      .or(page.getByTitle(/needs at least 1\d maps/))
      .first(),
  ).toBeVisible();
  await typeInto(page, 'NM maps for Semifinals', '6');
  await typeInto(page, 'HD maps for Semifinals', '3');
  await typeInto(page, 'HR maps for Semifinals', '3');

  await page.getByRole('button', { name: 'Save stages' }).click();
  await expect(page.getByText('Stages saved.')).toBeVisible();
  const stages = await db.tournamentStage.findMany({
    where: { tournamentId: t.id },
    include: { poolPlan: true },
  });
  const finals = stages.find((stage) => stage.name === 'Grand Finals')!;
  expect((finals.matchRules as { bestOf: number }).bestOf).toBe(13);

  // Any map type can be a column, and it saves like the others.
  await page.getByLabel('New map type').pressSequentially('rx');
  await expect(page.getByLabel('New map type')).toHaveValue('RX');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Map type added.')).toBeVisible();
  await typeInto(page, 'RX maps for Finals', '3');
  await page.getByRole('button', { name: 'Save stages' }).click();
  await expect(page.getByText('Stages saved.')).toBeVisible();
  const plan = await db.poolPlan.findFirstOrThrow({
    where: { tournamentId: t.id, stage: { name: 'Finals' } },
  });
  expect((plan.slots as { name: string }[]).map((slot) => slot.name)).toContain('RX3');
  await openWorkspace(page, t, 'stages');
  await expect(
    page.getByRole('spinbutton', { name: 'RX maps for Finals', exact: true }),
  ).toHaveValue('3');
  await page.screenshot({ path: `${evidence}/stages-1366.png`, fullPage: true });

  // The way into a stage's maps has to be readable against the card it sits on.
  const pool = page.getByRole('button', { name: /maps in draft|Add maps/ }).first();
  await expect(pool).toBeVisible();
  const contrast = await pool.evaluate((element) => {
    const channels = (value: string) => value.match(/[\d.]+/g)!.map(Number);
    const luminance = (value: string) => {
      const [r, g, b] = channels(value).map((channel) => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    let parent: Element | null = element;
    let background = 'rgb(255, 255, 255)';
    while (parent) {
      const color = getComputedStyle(parent).backgroundColor;
      if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
        background = color;
        break;
      }
      parent = parent.parentElement;
    }
    const [a, b] = [luminance(getComputedStyle(element).color), luminance(background)];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
});

test('a mappool slot plan takes typed counts for each mod', async ({ page, context }) => {
  await login(context);
  const t = await newTournament(page, 'Slots');
  await openWorkspace(page, t, 'stages');
  await page
    .locator('tr', { has: page.locator('input[value="Finals"]') })
    .getByRole('button', { name: /maps in draft|Add maps/ })
    .click();
  await page.getByRole('button', { name: 'Build slot plan' }).click();
  const nm = page.getByRole('spinbutton', { name: /^NM ·/ });
  await nm.click();
  await nm.press('Control+a');
  await nm.press('Backspace');
  await expect(nm).toHaveValue('');
  await nm.pressSequentially('12');
  await expect(nm).toHaveValue('12');
  await page.getByRole('button', { name: 'Create slots' }).click();
  await expect(page.getByText('Slot plan created.')).toBeVisible();
  await expect(page.locator('input[value="NM12"]')).toHaveCount(1);
});

test('the match preview runs once per change, not on its own', async ({ page, context }) => {
  await login(context);
  const t = await newTournament(page, 'Preview');
  let previews = 0;
  let writes = 0;
  page.on('request', (request) => {
    if (!request.url().includes('/api/admin/action') || request.method() !== 'POST') return;
    writes += 1;
    if (request.postData()?.includes('format.plan.preview')) previews += 1;
  });
  await openWorkspace(page, t, 'format');
  await expect(page.getByText(/matches would be created/)).toBeVisible();
  // Left alone, an open section asks for nothing further.
  await page.waitForTimeout(3000);
  expect(previews).toBe(1);
  expect(writes).toBe(1);

  // Quick edits in a row become one request.
  await openPhase(page, 'Main bracket');
  const name = page.getByRole('textbox', { name: 'Double elimination name' });
  await name.pressSequentially(' two');
  await page.waitForTimeout(1500);
  // A name does not change what the preview shows, so it does not ask again.
  expect(previews).toBe(1);
  const reset = page.getByRole('checkbox', { name: 'Grand Finals reset' });
  await reset.uncheck();
  await reset.check();
  await page.waitForTimeout(1500);
  expect(previews).toBeLessThanOrEqual(2);
});

test('every mod choice is a checkbox that saves', async ({ page, context }) => {
  await login(context);
  const t = await newTournament(page, 'Mods');
  await openWorkspace(page, t, 'scoring');
  const group = (name: string) => page.getByRole('group', { name, exact: true });

  // Values another section owns appear once, so the two can never disagree.
  const scoring = page.locator('details', { hasText: 'Save scoring and mods' }).first();
  for (const name of ['Players per side', 'Best of', 'Bans per team'])
    await expect(scoring.getByRole('spinbutton', { name, exact: true })).toHaveCount(0);
  await expect(scoring.getByRole('status').or(scoring.locator('output'))).toHaveCount(0);

  await group('Mods required on every map').getByRole('checkbox', { name: 'RX' }).check();
  await page.getByText('FreeMod', { exact: true }).click();
  await group('FreeMod categories').getByRole('checkbox', { name: 'TB' }).check();
  await group('Counted mods').first().getByRole('checkbox', { name: 'FL' }).check();
  await page.getByText('Lobby commands', { exact: true }).click();
  await group('DT lobby mods').getByRole('checkbox', { name: 'HT' }).check();
  await group('DT optional player mods').getByRole('checkbox', { name: 'HD' }).check();
  await group('HR allowed player mods').getByRole('checkbox', { name: 'HD' }).check();
  await page.screenshot({ path: `${evidence}/mods-1366.png`, fullPage: true });
  await page.getByRole('button', { name: 'Save scoring and mods' }).click();
  await expect(page.getByText('Scoring saved.')).toBeVisible();

  const { matchRules } = await db.tournamentSettings.findUniqueOrThrow({
    where: { tournamentId: t.id },
  });
  expect(matchRules).toMatchObject({
    requiredMods: ['RX'],
    enforceNoFail: false,
    categoryOptionalMods: { DT: ['HD'] },
    categoryAllowedMods: { HR: ['HD'] },
  });
  const rules = matchRules as {
    categoryMods: Record<string, string>;
    freeModCategories: string[];
    freeModQuotas: { satisfiedBy: string[] }[];
  };
  expect(rules.categoryMods.DT).toBe('DT HT');
  expect(rules.freeModCategories).toContain('TB');
  expect(rules.freeModQuotas.some((quota) => quota.satisfiedBy.includes('FL'))).toBe(true);

  // They read back ticked, and rules reach stages that already exist.
  await openWorkspace(page, t, 'scoring');
  await expect(
    group('Mods required on every map').getByRole('checkbox', { name: 'RX' }),
  ).toBeChecked();
  const stage = await db.tournamentStage.findFirstOrThrow({
    where: { tournamentId: t.id, name: 'Finals' },
  });
  expect((stage.matchRules as { requiredMods: string[] }).requiredMods).toEqual(['RX']);
});

test('a bracket shows every round and its stage, matched automatically', async ({
  page,
  context,
}) => {
  await login(context);
  const t = await newTournament(page, 'Rounds');
  const stages = await stagesOf(t);
  const idOf = (name: string) => stages.find((stage) => stage.name === name)!.id;
  await openWorkspace(page, t, 'format');

  // Folded, a bracket still says which stages it uses, with no single-stage control.
  const bracket = page.locator('details[aria-label="Main bracket"]');
  await expect(bracket.locator('summary')).toContainText(
    'Round of 16, Quarterfinals, Semifinals, Finals, Grand Finals',
  );
  await openPhase(page, 'Main bracket');
  await expect(bracket.getByRole('combobox', { name: 'Stage', exact: true })).toHaveCount(0);

  const round = (name: string) => bracket.getByRole('combobox', { name: `Stage for ${name}` });
  await expect(round('Round of 16')).toHaveValue(idOf('Round of 16'));
  await expect(round('Quarterfinals')).toHaveValue(idOf('Quarterfinals'));
  await expect(round('Semifinals')).toHaveValue(idOf('Semifinals'));
  await expect(round('Winners final')).toHaveValue(idOf('Finals'));
  await expect(round('Losers round 1')).toHaveValue(idOf('Round of 16'));
  await expect(round('Grand Finals')).toHaveValue(idOf('Grand Finals'));
  await page.screenshot({ path: `${evidence}/rounds-1366.png`, fullPage: true });

  // Any round can be pointed elsewhere, and going back is one click.
  await round('Quarterfinals').selectOption(idOf('Semifinals'));
  await expect(
    bracket.getByRole('button', { name: 'Match stages automatically again' }),
  ).toBeVisible();
  await bracket.getByRole('button', { name: 'Match stages automatically again' }).click();
  await expect(round('Quarterfinals')).toHaveValue(idOf('Quarterfinals'));

  // A later round in an earlier stage is explained, and cannot be saved.
  await round('Winners final').selectOption(idOf('Round of 16'));
  await expect(page.getByText('a later round cannot use an earlier stage.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save format' })).toBeDisabled();
  await bracket.getByRole('button', { name: 'Match stages automatically again' }).click();

  // A smaller bracket starts at the right stage, its entrants follow, and an unused stage is named.
  await bracket.getByLabel('Winners bracket size').selectOption('8');
  await expect(round('Quarterfinals')).toHaveValue(idOf('Quarterfinals'));
  await expect(bracket.getByText('Not used by this bracket: Round of 16.')).toBeVisible();
  await expect(bracket.getByRole('spinbutton', { name: 'To rank' })).toHaveValue('8');
  await bracket.getByLabel('Winners bracket size').selectOption('16');
  await expect(round('Round of 16')).toHaveValue(idOf('Round of 16'));
  await expect(bracket.getByRole('spinbutton', { name: 'To rank' })).toHaveValue('16');

  // One choice can be kept while everything else stays automatic, and locking saves it too.
  await round('Winners final').selectOption(idOf('Grand Finals'));
  await page.getByRole('button', { name: 'Save and lock format' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Format locked. Its matches are reserved.')).toBeVisible();
  const rounds = await db.bracketRound.findMany({ where: { tournamentId: t.id } });
  const stageOf = (key: string) => rounds.find((item) => item.key === key)!.stageId;
  expect(stageOf('g1-r1')).toBe(idOf('Round of 16'));
  expect(stageOf('g1-r2')).toBe(idOf('Quarterfinals'));
  expect(stageOf('g1-r3')).toBe(idOf('Semifinals'));
  expect(stageOf('g1-r4')).toBe(idOf('Grand Finals'));
  expect(stageOf('g2-r1')).toBe(idOf('Round of 16'));
  expect(stageOf('g3-r1')).toBe(idOf('Grand Finals'));
  // The Losers bracket still reaches Finals, so all five stages stay in use.
  expect(new Set(rounds.map((item) => item.stageId)).size).toBe(5);
});

test('setup leads from one step to the next, and holds together at every width', async ({
  page,
  context,
}) => {
  await login(context);
  const t = await newTournament(page, 'Flow');
  await openWorkspace(page, t, 'stages');
  const next = page.getByRole('button', { name: /^Next:/ });
  await expect(next).toBeVisible();
  await next.click();
  await expect(next.or(page.locator('body')).first()).toBeVisible();

  for (const [width, height] of [
    [1920, 1080],
    [1366, 900],
    [768, 900],
    [390, 844],
    [320, 700],
  ] as const)
    for (const appearance of ['light', 'dark']) {
      await context.clearCookies();
      await login(context, 'en', appearance);
      await page.setViewportSize({ width, height });
      for (const section of ['stages', 'format', 'scoring']) {
        await openWorkspace(page, t, section);
        await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance);
        if (section === 'format') await openPhase(page, 'Main bracket');
        await page.waitForTimeout(500);
        if (section === 'stages' && width < 600) {
          // Scrolled sideways to the counts, a row still says which stage it is.
          const bestOf = page.getByRole('spinbutton', { name: 'Best of for Finals', exact: true });
          await bestOf.scrollIntoViewIfNeeded();
          await page
            .getByRole('spinbutton', { name: 'TB maps for Finals', exact: true })
            .scrollIntoViewIfNeeded();
          await expect(page.locator('input[value="Finals"]')).toBeInViewport();
          await expect(
            page.getByRole('spinbutton', { name: 'TB maps for Finals', exact: true }),
          ).toBeInViewport();
        }
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${section} at ${width}`).toBeLessThanOrEqual(1);
        await page.screenshot({
          path: `${evidence}/${section}-${appearance}-${width}.png`,
          fullPage: true,
        });
      }
    }
});
