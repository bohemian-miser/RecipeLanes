import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';

test.describe('Basic Sanity', () => {
  for (const device of deviceConfigs) {
    test(`${device.name}: has title and loads`, async ({ page }) => {
      const dir = screenshotDir('basic-sanity', device.name);
      await page.setViewportSize(device.viewport);
      
      await page.goto('/lanes');
      await screenshot(page, dir, 'debug-before-title-check');
      await expect(page).toHaveTitle(/Recipe Lanes/);
      await screenshot(page, dir, 'home-page');
      cleanupScreenshots(dir);
    });

    test(`${device.name}: loads gallery`, async ({ page }) => {
      const dir = screenshotDir('basic-gallery', device.name);
      await page.setViewportSize(device.viewport);

      await page.goto('/gallery');
      // Heading might be "Community Collection" or "Public Gallery" depending on impl
      await screenshot(page, dir, 'debug-before-gallery-check');
      await expect(page.locator('h1, h2').filter({ hasText: /Gallery|Collection/ })).toBeVisible();
      await screenshot(page, dir, 'gallery-page');
      cleanupScreenshots(dir);
    });
  }
});
