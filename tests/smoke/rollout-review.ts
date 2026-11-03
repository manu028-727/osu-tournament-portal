import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { db } from '../../src/lib/db';
import { createSession } from '../../src/lib/auth';

assert.equal(new URL(process.env.DATABASE_URL!).pathname, '/platform_visual_test');
assert.equal(process.env.ALLOW_ISOLATED_CONTAINER_TESTS, 'yes');
const origin = process.env.APP_URL!;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const root = '/t/visual-review',
  admin = root + '/admin';
const output = process.env.ROLLOUT_OUTPUT || '.data/visual/rollout';
const modes = process.env.ROLLOUT_MODE
  ? [process.env.ROLLOUT_MODE as 'dark' | 'light']
  : (['dark', 'light'] as const);
const widths = process.env.ROLLOUT_WIDTH ? [Number(process.env.ROLLOUT_WIDTH)] : [1366, 390, 320];
assert.ok(modes.every((mode) => ['dark', 'light'].includes(mode)));
assert.ok(widths.every((width) => [1366, 390, 320].includes(width)));
const reportSuffix = [process.env.ROLLOUT_MODE, process.env.ROLLOUT_WIDTH]
  .filter(Boolean)
  .join('-');
await mkdir(output, { recursive: true });
const user = await db.user.findUniqueOrThrow({ where: { osuId: 990200011 } });
assert.equal(user.platformAdmin, true);
const session = await createSession(user.id);
const tournament = await db.tournament.findUniqueOrThrow({ where: { slug: 'visual-review' } });
const team = await db.team.findFirstOrThrow({ where: { tournamentId: tournament.id } });
const match = await db.match.findFirstOrThrow({
  where: { tournamentId: tournament.id },
  orderBy: { code: 'asc' },
});
const browser = await chromium.launch();
const report: { name: string; mode: string; width: number; status?: number; overflow: boolean }[] =
  [];
const errors: string[] = [];
try {
  const setup = await browser.newContext();
  await setup.addCookies([{ name: 'tournament_session', value: session.raw, url: origin }]);
  let qualifier = await db.qualifierLobby.findFirst({
    where: { tournamentId: tournament.id, code: 'VISUAL-Q1' },
  });
  if (!qualifier) {
    const teams = await db.team.findMany({
      where: { tournamentId: tournament.id },
      orderBy: { position: 'asc' },
      take: 2,
    });
    const stage = await db.tournamentStage.findFirstOrThrow({
      where: { tournamentId: tournament.id, slug: 'quarterfinals' },
    });
    const response = await setup.request.post(
      origin + '/api/admin/action?tournament=visual-review',
      {
        headers: { Origin: origin },
        data: {
          type: 'qualifier.create',
          code: 'VISUAL-Q1',
          stageId: stage.id,
          teamIds: teams.map((team) => team.id),
          refereeIds: [],
          scheduledAt: null,
          notes: 'Synthetic visual-review qualifier',
        },
      },
    );
    assert.equal(response.status(), 200, await response.text());
    qualifier = await db.qualifierLobby.findFirstOrThrow({
      where: { tournamentId: tournament.id, code: 'VISUAL-Q1' },
    });
  }
  const routes = [
    ['directory', '/tournaments'],
    ['setup', '/setup'],
    ['home', root],
    ['mappool-index', root + '/mappools'],
    ['mappool', root + '/mappools/quarterfinals'],
    ['matches', root + '/matches'],
    ['schedule', root + '/schedule'],
    ['match-result', root + '/matches/' + match.code],
    ['teams', root + '/teams'],
    ['team', root + '/teams/' + team.slug],
    ['staff', root + '/staff'],
    ['rules', root + '/rules'],
    ['chooser', '/admin/tournaments'],
    ['tournament', admin],
    ['homepage-editor', admin + '/homepage'],
    ['website-info', admin + '/website?view=info'],
    ['website-appearance', admin + '/website?view=branding'],
    ['website-navigation', admin + '/website?view=navigation'],
    ['rules-editor', admin + '/rules'],
    ['settings', admin + '/settings'],
    ['pool-editor', admin + '/mappools'],
    ['stages', admin + '/stages'],
    ['teams-editor', admin + '/teams'],
    ['matches-editor', admin + '/matches'],
    ['referees', admin + '/referee'],
    ['referee', admin + '/referee/' + match.id],
    ['qualifiers', admin + '/referee/qualifiers'],
    ['qualifier', admin + '/referee/qualifiers/' + qualifier.id],
    ['staff-editor', admin + '/staff'],
    ['staff-access', admin + '/staff?view=access'],
    ['staff-roles', admin + '/staff?view=roles'],
    ['stage-settings', admin + '/mappools?view=stages'],
    ['settings-canonical-audit', admin + '/settings?view=audit'],
    ['media', admin + '/media'],
    ['roles', admin + '/roles'],
    ['users', admin + '/users'],
    ['audit', admin + '/audit'],
    ['sheet-data', admin + '/sheet-data'],
  ];
  for (const mode of modes)
    for (const width of widths) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: mode,
        hasTouch: width === 390,
        reducedMotion: 'reduce',
      });
      await context.addCookies([
        { name: 'tournament_session', value: session.raw, url: origin },
        { name: 'portal_appearance', value: mode, url: origin },
      ]);
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      for (const [name, route] of routes) {
        const response = await page.goto(origin + route, { waitUntil: 'networkidle' });
        await expect(page.locator('main')).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        );
        report.push({ name, mode, width, status: response?.status(), overflow });
        assert.equal(response?.status(), 200, route);
        assert.equal(overflow, false, `${name} ${mode} ${width}`);
        if (name === 'matches-editor' && width < 768) {
          const footer = page.locator('article[aria-label]').first().locator(':scope > div').last();
          const geometry = await footer.evaluate((element) => {
            const assignment = element.querySelector('p')!.getBoundingClientRect();
            const controls = element.lastElementChild!.getBoundingClientRect();
            return {
              width: assignment.width,
              assignmentBottom: assignment.bottom,
              controlsTop: controls.top,
              controlsRight: controls.right,
            };
          });
          assert.ok(geometry.width >= 100, 'Referee assignment is squeezed by match actions');
          assert.ok(
            geometry.controlsTop >= geometry.assignmentBottom,
            'Match actions overlap the assignment',
          );
          assert.ok(geometry.controlsRight <= width, 'Match actions extend beyond the viewport');
        }
        await expect(page.locator('html')).toHaveAttribute('data-appearance', mode);
        if (route.startsWith(root) && !route.startsWith(admin))
          await expect(
            page.getByRole('navigation', { name: 'Tournament navigation', exact: true }),
          ).toHaveCount(1);
        await page.screenshot({ path: `${output}/${name}-${mode}-${width}.png`, fullPage: true });
      }
      await page.goto(origin + admin + '/matches', { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'New match', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.screenshot({
        path: `${output}/match-create-${mode}-${width}.png`,
        fullPage: true,
      });
      await page.keyboard.press('Escape');
      await page.goto(origin + admin + '/website?view=branding', { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Preview appearance', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.screenshot({
        path: `${output}/appearance-preview-${mode}-${width}.png`,
        fullPage: true,
      });
      await page.keyboard.press('Escape');
      await page.goto(origin + admin + '/mappools?view=stages', { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'New stage', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.screenshot({ path: `${output}/new-stage-${mode}-${width}.png`, fullPage: true });
      await page.keyboard.press('Escape');
      await page.goto(origin + '/admin/tournaments', { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Import Tournament', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const error = dialog.getByRole('alert');
      await expect(error).toHaveCount(0);
      await page.screenshot({
        path: `${output}/import-dialog-${mode}-${width}.png`,
        fullPage: true,
      });
      await context.close();
    }
  const page = await setup.newPage();
  await page.goto(origin + '/admin/tournaments', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'System', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  assert.equal(
    await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgb(248, 245, 246)',
  );
  await page.emulateMedia({ colorScheme: 'dark' });
  assert.equal(
    await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgb(35, 31, 35)',
  );
  const baseline = JSON.parse(await readFile('.data/visual/profile-before/report.json', 'utf8'));
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin + root + '/mappools/quarterfinals', { waitUntil: 'networkidle' });
    const geometry = await page.locator('li[data-slot]').evaluateAll((elements) =>
      elements.map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          slot: el.getAttribute('data-slot'),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          x: Math.round(rect.x),
        };
      }),
    );
    assert.deepEqual(
      geometry,
      baseline.report.find(
        (row: { name: string; width: number }) => row.name === 'mappool' && row.width === width,
      ).geometry,
      'Final mappool geometry changed',
    );
    assert.equal(
      await page
        .locator('li[data-slot]')
        .first()
        .evaluate((el) => getComputedStyle(el).borderRadius),
      '12px',
    );
  }
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/report${reportSuffix ? '-' + reportSuffix : ''}.json`,
    JSON.stringify(
      { report, errors, systemPreference: true, mappoolGeometryUnchanged: true },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ pages: routes.length, checks: report.length, errors }));
} finally {
  await browser.close();
  await db.$disconnect();
}
