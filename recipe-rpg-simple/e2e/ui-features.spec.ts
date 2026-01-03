import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';

test.describe('UI Features', () => {

  for (const device of deviceConfigs) {
    test(`${device.name}: Tap Select Branch`, async ({ page }) => {
      const dir = screenshotDir('ui-features-tap', device.name);
      await page.setViewportSize(device.viewport);
      
      await page.goto('/lanes?new=true');
      await page.getByPlaceholder('Paste recipe here...').fill('test eggs');
      await page.locator('button.bg-yellow-500').click();
      
      // Wait for nodes
      const nodes = page.locator('.react-flow__node');
      await expect(nodes.first()).toBeVisible({ timeout: 15000 });
      const count = await nodes.count();
      expect(count).toBeGreaterThan(0);
      
      await screenshot(page, dir, '01-graph-loaded');
      
      const node1 = nodes.first();
      
      // Tap (Click) -> Should select branch immediately
      await node1.click();
      await expect(node1).toHaveClass(/selected/);
      await screenshot(page, dir, '02-branch-selected');
      // No need to tap again
      cleanupScreenshots(dir);
    });
  }
});
