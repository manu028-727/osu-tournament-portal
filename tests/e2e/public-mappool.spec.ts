import { test, expect, type Page } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
const slug = `public-grid-${Date.now()}`;
const names = [
  'NM1',
  'NM2',
  'NM3',
  'NM9',
  'NM10',
  'NM11',
  'HD1',
  'HD2',
  'HD10',
  'HR1',
  'HR2',
  'DT1',
  'DT2',
  'FM1',
  'FM2',
  'FM10',
  'EZ1',
  'TB1',
  'TB2',
];
const baseId = 970000000 + randomInt(1000000);
const colors: Record<string, string> = {
  NM: '#8bbdff',
  HD: '#f0cc74',
  HR: '#f395ad',
  DT: '#b6a0e5',
  FM: '#83d8c0',
  EZ: '#88ff66',
  TB: '#ffaf82',
};
const longTitle =
  'A very long tournament beatmap title with enough words to exceed the card width '.repeat(3);
const unbrokenTitle = 'UnbrokenTitle'.repeat(30);
let stageId: string;
let poolId: string;

test.beforeAll(async () => {
  if (new URL(process.env.TEST_DATABASE_URL!).pathname !== '/tournament_platform_test')
    throw new Error('Test database only.');
  const maps = names.map((name, index) => ({
    id: baseId + index,
    mode: 'osu',
    title:
      index === 0 || index === 2
        ? longTitle
        : index === names.length - 1
          ? unbrokenTitle
          : `Track ${name}`,
    artist: 'Test artist',
    mapper: index === names.length - 1 ? 'LongMapper'.repeat(20) : 'Test mapper',
    difficulty: index === 0 ? 'Very long difficulty name '.repeat(8) : 'Insane',
    stars: 5.82,
    bpm: 180,
    length: 125,
    ar: 9,
    cs: 4,
    od: 8,
    hp: 6,
    cover: '/test-image.webp',
    url: `https://osu.ppy.sh/beatmaps/${baseId + index}`,
  }));
  await db.beatmap.createMany({
    data: maps.map((metadata) => ({ id: metadata.id, mode: 'osu', metadata })),
  });
  const stage = await db.tournamentStage.create({
    data: { tournamentId: 'main', name: 'Grid QA', slug, position: 999 },
  });
  stageId = stage.id;
  const pool = await db.mappool.create({ data: { tournamentId: 'main', stageId } });
  poolId = pool.id;
  const revision = await db.mappoolRevision.create({
    data: {
      tournamentId: 'main',
      mappoolId: poolId,
      notes: 'Public grid browser test',
      slots: {
        create: [...names].reverse().map((name, position) => {
          const index = names.indexOf(name);
          const category = name.replace(/\d+$/, '');
          return {
            name,
            category,
            categoryName: category,
            categoryPriority: category === 'EZ' ? 6 : null,
            color: colors[category],
            position,
            beatmapId: maps[index].id,
            metadata: maps[index],
          };
        }),
      },
    },
  });
  const draft = await db.mappoolRevision.create({
    data: { tournamentId: 'main', mappoolId: poolId, notes: 'PRIVATE DRAFT NOT FOR VISITORS' },
  });
  await db.mappool.update({
    where: { id: poolId },
    data: { state: 'PUBLISHED', publishedRevisionId: revision.id, draftRevisionId: draft.id },
  });
});
test.afterAll(async () => {
  if (poolId)
    await db.mappool.update({
      where: { id: poolId },
      data: { draftRevisionId: null, publishedRevisionId: null },
    });
  if (stageId) await db.tournamentStage.delete({ where: { id: stageId } });
  await db.beatmap.deleteMany({ where: { id: { gte: baseId, lt: baseId + names.length } } });
  await db.$disconnect();
});

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [1920, 1366, 768, 390, 320]) {
  test(`public mappool grid and details at ${width}px`, async ({ browser }, testInfo) => {
    const touch = width <= 768;
    const context = await browser.newContext({
      viewport: { width, height: width >= 1366 ? 900 : 844 },
      hasTouch: touch,
      isMobile: touch,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`http://localhost:3001/mappools/${slug}`);
    const grid = page.getByRole('group', { name: 'Mappool', exact: true });
    const cards = grid.locator('li');
    await expect(cards).toHaveCount(names.length);
    expect(
      await cards.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-slot'))),
    ).toEqual(names);
    await expect(page.getByText('PRIVATE DRAFT NOT FOR VISITORS')).toHaveCount(0);
    const columns = width >= 1100 ? 3 : width >= 640 ? 2 : 1;
    const categories = ['NM', 'HD', 'HR', 'DT', 'FM', 'EZ', 'TB'];
    await expect(grid.getByRole('region')).toHaveCount(categories.length);
    expect(
      await grid
        .getByRole('region')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label'))),
    ).toEqual(categories.map((category) => `Categoria ${category}`));
    for (const category of categories) {
      const section = grid.getByRole('region', { name: `Categoria ${category}`, exact: true });
      await expect(section.getByRole('heading')).toHaveCount(0);
      expect(
        await section.evaluate((node) =>
          getComputedStyle(node).getPropertyValue('--mod-color').trim(),
        ),
      ).toBe(colors[category]);
      expect(await section.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(
        'rgba(0, 0, 0, 0)',
      );
      const shade = section.locator('li > div[aria-hidden="true"]').first();
      expect(await shade.evaluate((node) => getComputedStyle(node, '::after').content)).toBe(
        'none',
      );
      const list = section.getByRole('list', { name: `Mappe ${category}`, exact: true });
      const frame = await section.evaluate((node) => {
        const outer = node.getBoundingClientRect();
        const inner = node.querySelector('ul')!.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          insets: [
            inner.left - outer.left,
            inner.top - outer.top,
            outer.right - inner.right,
            outer.bottom - inner.bottom,
          ],
          border: style.borderTopWidth,
          borderStyle: style.borderTopStyle,
          radius: style.borderRadius,
        };
      });
      expect(frame.insets).toEqual([11, 11, 11, 11]);
      expect(frame.border).toBe('1px');
      expect(frame.borderStyle).toBe('solid');
      expect(frame.radius).toBe('16px');
      const layout = await list.evaluate((node) => ({
        left: node.getBoundingClientRect().left,
        width: node.getBoundingClientRect().width,
        cards: [...node.querySelectorAll('li')].map((card) => {
          const box = card.getBoundingClientRect();
          return { left: box.left, right: box.right, width: box.width, top: box.top };
        }),
      }));
      for (let start = 0; start < layout.cards.length; start += columns) {
        const row = layout.cards.slice(start, start + columns);
        expect(
          Math.abs((row[0].left + row.at(-1)!.right) / 2 - (layout.left + layout.width / 2)),
        ).toBeLessThan(1);
        for (const card of row) {
          expect(Math.abs(card.width - (layout.width - (columns - 1) * 10) / columns)).toBeLessThan(
            1,
          );
          expect(card.top).toBe(row[0].top);
        }
      }
      expect(
        await list
          .locator('li')
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-slot'))),
      ).toEqual(names.filter((name) => name.replace(/\d+$/, '') === category));
    }
    const gaps = await grid
      .getByRole('region')
      .evaluateAll((nodes) =>
        nodes
          .slice(1)
          .map(
            (node, index) =>
              node.getBoundingClientRect().top - nodes[index].getBoundingClientRect().bottom,
          ),
      );
    for (const gap of gaps) expect(gap).toBe(12);
    for (const box of await cards.evaluateAll((rows) =>
      rows.map((row) => ({
        height: row.getBoundingClientRect().height,
        width: row.getBoundingClientRect().width,
      })),
    )) {
      expect(box.height).toBe(width < 640 ? 72 : 64);
      expect(box.width).toBeGreaterThan(200);
    }
    await grid.scrollIntoViewIfNeeded();
    await expect(cards.first().locator('img')).toHaveJSProperty('complete', true);
    expect(
      await cards
        .first()
        .locator('img')
        .evaluate((img) => (img as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(0);
    const firstTitle = cards.first().locator('a span span').first();
    expect(await firstTitle.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`grid-${width}.png`), fullPage: true });

    if (!touch) {
      for (const index of [0, 2, names.length - 1]) {
        const card = cards.nth(index);
        await card.scrollIntoViewIfNeeded();
        const positions = () =>
          cards.evaluateAll((rows) =>
            rows.map((row) => {
              const box = row.getBoundingClientRect();
              return [box.x + scrollX, box.y + scrollY, box.width, box.height];
            }),
          );
        const before = await positions();
        await card.getByRole('link').hover();
        const preview = page.getByRole('tooltip', { name: `Anteprima ${names[index]}` });
        await expect(preview).toBeVisible();
        const box = (await preview.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
        expect(await positions()).toEqual(before);
        await expect(preview).toContainText('5.82');
        await expect(preview).toContainText('180');
        await expect(preview).toContainText('2:05');
        await expect(preview).toContainText(String(baseId + index));
        await noOverflow(page);
        await page.screenshot({ path: testInfo.outputPath(`hover-${width}-${index}.png`) });
        await page.mouse.move(0, 0);
        await expect(preview).not.toBeVisible();
      }
    }

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            (window as unknown as { copiedId: string }).copiedId = value;
          },
        },
      });
    });
    for (const index of [0, names.length - 1]) {
      const button = cards.nth(index).getByRole('button', { name: `Dettagli ${names[index]}` });
      await button.scrollIntoViewIfNeeded();
      expect((await button.boundingBox())!.width).toBeGreaterThanOrEqual(44);
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      if (touch) await button.tap();
      else await button.click();
      const panel = page.getByRole('dialog');
      await expect(panel).toBeVisible();
      await expect(panel.getByRole('heading')).toHaveText(
        `Test artist - ${index === 0 ? longTitle : unbrokenTitle}`,
      );
      await expect(panel).toContainText('Mapper');
      await expect(panel).toContainText('5.82');
      await expect(panel).toContainText('180');
      await expect(panel).toContainText('2:05');
      const box = (await panel.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
      expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await panel.evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
      await panel.getByRole('button', { name: 'Copia beatmap ID' }).click();
      await expect(panel.getByRole('status')).toHaveText('ID copiato');
      expect(await page.evaluate(() => (window as unknown as { copiedId: string }).copiedId)).toBe(
        String(baseId + index),
      );
      await page.screenshot({ path: testInfo.outputPath(`details-${width}-${index}.png`) });
      await panel.getByRole('button', { name: 'Chiudi', exact: true }).click();
      await expect(panel).not.toBeVisible();
      await expect(button).toBeFocused();
      await noOverflow(page);
      if (touch) await expect(page.getByRole('tooltip')).toHaveCount(0);
    }

    if (touch) {
      const info = cards.last().getByRole('button');
      await info.tap();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.touchscreen.tap(5, 5);
      await expect(page.getByRole('dialog')).not.toBeVisible();
      await page.mouse.wheel(0, -250);
      await noOverflow(page);
    }

    // Touching the actual card remains normal link navigation, not a details toggle.
    await context.route('https://osu.ppy.sh/beatmaps/**', (route) =>
      route.fulfill({ body: '<h1>Beatmap</h1>', contentType: 'text/html' }),
    );
    const link = cards.first().getByRole('link');
    await link.scrollIntoViewIfNeeded();
    const popupPromise = context.waitForEvent('page');
    if (touch) await link.tap();
    else await link.click();
    const popup = await popupPromise;
    await popup.waitForURL(`https://osu.ppy.sh/beatmaps/${baseId}`);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test('group colors stay behind the cards without tinting their pixels', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/mappools/${slug}`);
  const section = page.getByRole('region', { name: 'Categoria NM', exact: true });
  const card = section.locator('li').first();
  await card.getByRole('button', { name: 'Dettagli NM1', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  // Compare artwork, not the browser's subpixel focus-ring rasterization.
  await card.getByRole('button', { name: 'Dettagli NM1', exact: true }).blur();
  await page.mouse.move(0, 0);
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('img')).toHaveJSProperty('complete', true);
  await card.locator('img').evaluate(async (image) => {
    await (image as HTMLImageElement).decode();
  });
  await page.evaluate(() => document.fonts.ready);
  const box = (await card.boundingBox())!;
  const clip = { x: box.x + 12, y: box.y + 4, width: box.width - 24, height: box.height - 8 };
  const before = await page.screenshot({ clip });
  const original = await section.evaluate((node) =>
    (node as HTMLElement).style.getPropertyValue('--mod-color'),
  );
  try {
    await section.evaluate((node) =>
      (node as HTMLElement).style.setProperty('--mod-color', '#00ff00'),
    );
    const after = await page.screenshot({ clip });
    if (!after.equals(before)) {
      await testInfo.attach('card-before', { body: before, contentType: 'image/png' });
      await testInfo.attach('card-after', { body: after, contentType: 'image/png' });
    }
    expect(after.equals(before)).toBe(true);
  } finally {
    await section.evaluate(
      (node, color) => (node as HTMLElement).style.setProperty('--mod-color', color),
      original,
    );
  }
});

test('details support keyboard, outside dismissal, copy failure and tournament colors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`/t/test-cup/mappools/${slug}`);
  const info = page.getByRole('button', { name: 'Dettagli NM1', exact: true });
  // Wait for hydration before changing the fixture palette, avoiding a synthetic SSR mismatch.
  await info.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  // Portaled panels must inherit the current tournament, not the root/default palette.
  await info.evaluate((node) => {
    const wrapper = node.closest('main')!.parentElement!;
    wrapper.style.setProperty('--brand', '#32a9d1');
    wrapper.style.setProperty('--accent', '#d1a932');
  });
  await info.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('dialog');
  await expect(panel).toBeVisible();
  expect(
    await panel.evaluate((node) => getComputedStyle(node).getPropertyValue('--brand').trim()),
  ).toBe('#32a9d1');
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('Clipboard denied');
        },
      },
    }),
  );
  await panel.getByRole('button', { name: 'Copia beatmap ID' }).click();
  await expect(panel.getByRole('status')).toContainText('Impossibile copiare');
  await page.keyboard.press('Escape');
  await expect(panel).not.toBeVisible();
  await expect(info).toBeFocused();
  await info.click();
  await expect(panel).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(panel).not.toBeVisible();
  await expect(info).toBeFocused();
  expect(errors).toEqual([]);
});
