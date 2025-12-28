import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir } from './utils/screenshot';
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
      await expect(nodes).toHaveCount(3, { timeout: 15000 });
      await screenshot(page, dir, '01-graph-loaded');
      
      const node1 = nodes.first();
      
      // Tap (Click)
      await node1.click();
      await expect(node1).toHaveClass(/selected/);
      await screenshot(page, dir, '02-node-selected');
      
      // Tap Again -> Should select branch (if any)
      await node1.click();
      await expect(node1).toHaveClass(/selected/);
      await screenshot(page, dir, '03-branch-selected-logic');
    });
  }
});
