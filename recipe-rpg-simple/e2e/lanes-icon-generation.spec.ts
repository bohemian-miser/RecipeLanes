import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';

test.describe('Lanes Icon Generation', () => {
  for (const device of deviceConfigs) {
    if (device.isMobile) continue;

    test(`${device.name}: Generates icons for recipe`, async ({ page, login }) => {
      const dir = screenshotDir('lanes-icon-gen', device.name);
      await page.setViewportSize(device.viewport);

      await page.goto('/lanes?new=true');

      await screenshot(page, dir, '01-load page');

      await login('lanes-tester');

      await screenshot(page, dir, '02-after-login');

      // 1. Enter Recipe
      const input = page.getByPlaceholder('Paste recipe here...');
      await input.fill('test eggs');
      await screenshot(page, dir, '03-text-entered');
      
      // 2. Visualize
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      
      // 3. Wait for Graph
      const viewport = page.locator('.react-flow__viewport');
      await expect(viewport).toBeVisible({ timeout: 15000 });
      await screenshot(page, dir, '04-graph-visible');
      
      // Check for Forging Progress Bar (indicates icon generation started)
      // It's a div with bg-yellow-500 style width...
      // Might be fast with mock, so we use a loose check or omit if it's too fast.
      // But we can check that icons appear.

      // 4. Verify Icons
      // We expect nodes to eventually have images.
      // Initially they might be text only or have default icons if generation is pending.
      // We wait for at least one img with a src (not empty).
      const imgs = page.locator('.react-flow__node img');
      
      // Wait for generation (it processes in batches)
      // Mock AI is fast, but we have batches of 3.
      await expect(imgs.first()).toBeVisible({ timeout: 30000 });
      
      // Check src
      const src = await imgs.first().getAttribute('src');
      console.log('First Node Icon URL:', src);
      expect(src).toBeTruthy();
      if (process.env.MOCK_AI === 'true') {
          expect(src).toContain('placehold.co');
      }

      await screenshot(page, dir, '05-icons-populated');
      
      // 5. Reload to check persistence
      const url = page.url();
      await page.reload();
      await screenshot(page, dir, '06-persistence-check');
      await expect(viewport).toBeVisible();
      await expect(imgs.first()).toBeVisible({ timeout: 10000 });
      await screenshot(page, dir, '07-persistence-check');
      cleanupScreenshots(dir);
    });
  }
});
