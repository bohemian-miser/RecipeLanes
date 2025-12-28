import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';

test.describe('Lanes Icon Generation', () => {
  for (const device of deviceConfigs) {
    if (device.isMobile) continue;

    test(`${device.name}: Guest generates icons for recipe`, async ({ page }) => {
      const dir = screenshotDir('lanes-icon-gen', device.name);
      await page.setViewportSize(device.viewport);
      
      page.on('console', msg => console.log(`[Browser Console] ${msg.text()}`));

      await page.goto('/lanes?new=true');

      await screenshot(page, dir, 'load-page');

      // 1. Enter Recipe as Guest
      const input = page.getByPlaceholder('Paste recipe here...');
      await input.fill('test eggs');
      await screenshot(page, dir, 'text-entered');
      
      // 2. Visualize
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      
      // 3. Wait for Graph
      const viewport = page.locator('.react-flow__viewport');
      await expect(viewport).toBeVisible({ timeout: 15000 });
      await screenshot(page, dir, 'graph-visible');

      // 4. Verify Icons
      const imgs = page.locator('.react-flow__node img');
      
      // Wait for generation (client-side loop)
      await expect(imgs.first()).toBeVisible({ timeout: 45000 }); // Increase timeout for batch processing
      
      // Check src
      const src = await imgs.first().getAttribute('src');
      console.log('First Node Icon URL:', src);
      expect(src).toBeTruthy();

      await screenshot(page, dir, 'icons-populated');
      
      // 5. Reload to check persistence (should persist for session if guest?)
      // Wait, guest recipes are saved to DB (no owner).
      // So reload ID should show icons.
      // But populateIcons logic: Guest creating recipe -> saves to DB.
      // So it should persist.
      
      // Check URL has ID
      await expect(page).toHaveURL(/id=/);
      const url = page.url();
      
      await page.reload();
      await screenshot(page, dir, 'persistence-check');
      await expect(viewport).toBeVisible();
      await expect(imgs.first()).toBeVisible({ timeout: 10000 });
      await screenshot(page, dir, 'persistence-check-done');
      cleanupScreenshots(dir);
    });
  }
});
