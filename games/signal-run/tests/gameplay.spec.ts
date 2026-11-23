import { expect, test } from '@playwright/test';

test('start, pause, resume, fail screen, and retry stay wired to the game state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Touch layout is covered in the mobile canvas pass.');
  await page.goto('/');
  await expect(page.locator('#overlay-title')).toContainText('SIGNAL');
  await page.locator('#primary-action').click();
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.state)).toBe('playing');

  await page.locator('#pause-button').click();
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.state)).toBe('paused');
  await page.locator('#primary-action').click();
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.state)).toBe('playing');

  await page.evaluate(() => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    if (!hooks) throw new Error('Gameplay checks require the game test hooks.');
    hooks.setState('fail');
  });
  await expect(page.locator('#overlay-title')).toContainText('LIGHTS');
  await page.locator('#primary-action').click();
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.state)).toBe('playing');
  await expect(page.locator('#overlay')).toBeHidden();

  await page.evaluate(() => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    if (!hooks) throw new Error('Gameplay checks require the game test hooks.');
    hooks.setState('win');
  });
  await expect(page.locator('#overlay-title')).toContainText('DELIVERED');
});

test('a missed hazard damages hull integrity during real play', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'One deterministic keyboard playthrough is sufficient.');
  test.setTimeout(45_000);
  await page.goto('/');
  await page.evaluate(async () => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    if (!hooks) throw new Error('Collision checks require the game test hooks.');
    await hooks.seed(12345);
    await hooks.setState('active-play');
  });

  await page.waitForFunction(
    () => (window.__THREE_GAME_DIAGNOSTICS__?.health ?? 3) < 3,
    { timeout: 30_000 },
  );
  const diagnostics = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  expect(diagnostics?.state).toBe('playing');
  expect(diagnostics?.health).toBeLessThan(3);
});
