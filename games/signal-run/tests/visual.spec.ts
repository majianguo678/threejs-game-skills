import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

type CanvasSample = {
  ok: boolean;
  range: number;
  colors: number;
};

async function sampleCanvas(page: import('@playwright/test').Page): Promise<CanvasSample> {
  const buffer = await page.locator('#game-canvas').screenshot();
  const png = PNG.sync.read(buffer);
  let min = 255;
  let max = 0;
  const buckets = new Set<string>();
  const stride = Math.max(1, Math.floor((png.width * png.height) / 8192));

  for (let pixel = 0; pixel < png.width * png.height; pixel += stride) {
    const offset = pixel * 4;
    const r = png.data[offset];
    const g = png.data[offset + 1];
    const b = png.data[offset + 2];
    min = Math.min(min, r, g, b);
    max = Math.max(max, r, g, b);
    buckets.add(`${r >> 4},${g >> 4},${b >> 4}`);
  }

  const range = max - min;
  return { ok: range > 35 && buckets.size > 18, range, colors: buckets.size };
}

test('active route renders and responds to the lane controls', async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.locator('#overlay')).toBeVisible();
  await expect(page.locator('#overlay-title')).toContainText('SIGNAL');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
  await page.evaluate(async () => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    if (!hooks) throw new Error('Visual checks require the game test hooks.');
    await hooks.seed(42);
    const result = await hooks.setState('active-play');
    if (result.state !== 'active-play') throw new Error(`Unexpected state: ${result.state}`);
  });

  const sample = await sampleCanvas(page);
  expect(sample, JSON.stringify(sample)).toMatchObject({ ok: true });

  const beforeX = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.position.x ?? 0);
  if (testInfo.project.name.includes('mobile')) {
    await expect(page.locator('#right-button')).toBeVisible();
    await page.locator('#right-button').click();
  } else {
    await page.keyboard.press('ArrowRight');
  }
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.position.x ?? 0))
    .toBeGreaterThan(beforeX + 1.8);

  if (testInfo.project.name.includes('mobile')) {
    await page.locator('#jump-button').click();
  } else {
    await page.keyboard.down('Space');
    await page.waitForTimeout(120);
    await page.keyboard.up('Space');
  }
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.position.y ?? 0))
    .toBeGreaterThan(0.55);

  await testInfo.attach(`${testInfo.project.name}-active-play`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
