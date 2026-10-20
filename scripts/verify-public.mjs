import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const origin = process.env.QA_URL;
if (!origin) throw new Error('Set QA_URL to the intended staging origin.');
const extra = JSON.parse(process.env.QA_EXTRA_PATHS || '[]');
const routes =
  process.env.QA_EMPTY === 'true'
    ? ['/', '/setup', '/tournaments']
    : ['/', '/tournaments', '/mappools', '/staff', '/rules', '/teams', '/matches', ...extra];
await mkdir('.data/qa', { recursive: true });
const b = await chromium.launch({ headless: true });
const results = [];
try {
  for (const width of [1440, 768, 390, 320]) {
    const p = await b.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    for (const route of routes) {
      const r = await p.goto(origin + route, { waitUntil: 'networkidle' });
      assert.equal(r?.status(), 200, route);
      const state = await p.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        brokenImages: [...document.images]
          .filter((i) => !i.complete || i.naturalWidth === 0)
          .map((i) => i.getAttribute('src')),
      }));
      assert.equal(state.overflow, false, route);
      assert.deepEqual(state.brokenImages, [], route);
      if (route.includes('/matches/') && process.env.QA_EXPECT_HISTORY === 'true')
        assert.ok((await p.locator('[data-history-sequence]').count()) > 0);
      results.push({ width, route, ...state });
    }
    assert.deepEqual(errors, []);
    await p.screenshot({ path: `.data/qa/public-${width}.png`, fullPage: true });
    await p.close();
  }
  await writeFile('.data/qa/public-results.json', JSON.stringify(results, null, 2), {
    mode: 0o600,
  });
  console.log(
    `Public browser checks passed: ${results.length} pages/viewports, no broken images, overflow or client exceptions.`,
  );
} finally {
  await b.close();
}
