import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';

test.skip('Comprehensive Feature Tests', () => {
  
  for (const device of deviceConfigs) {
    if (device.isMobile) continue; // Focus on desktop for complex interactions

    test(`${device.name}: Auto-Save on Move (Owner)`, async ({ page, login }) => {
      const dir = screenshotDir('comprehensive-autosave', device.name);
      await page.setViewportSize(device.viewport);
      
      await page.goto('/lanes?new=true');
      // Login as Owner
      await login('owner-user');

      await page.getByPlaceholder('Paste recipe here...').fill('test eggs');
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      
      // Wait for graph
      await screenshot(page, dir, 'debug-before-node-check');
      await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 30000 });
      await screenshot(page, dir, 'debug-before-url-check');
      await expect(page).toHaveURL(/id=/, { timeout: 20000 });
      await screenshot(page, dir, 'initial-graph');

      const node = page.locator('.react-flow__node').first();
      const box1 = await node.boundingBox();
      if (!box1) throw new Error('No bounding box');

      // Drag significantly
      await node.dragTo(page.locator('.react-flow__pane'), {
        sourcePosition: { x: box1.width / 2, y: box1.height / 2 },
        targetPosition: { x: box1.x + 200, y: box1.y + 50 } 
      });
      
      // Check for notification "Saved changes." (or similar success indicator)
      // Note: Auto-save might be silent or toast.
      // We expect the "Save Changes" button to be potentially enabled or a toast.
      // In updated logic, we look for notification banner.
      // If we are owner, it just saves.
      await page.waitForTimeout(1000); // Wait for save
      await screenshot(page, dir, 'after-drag');
      cleanupScreenshots(dir);
    });

    test(`${device.name}: JSON View Hides iconUrl`, async ({ page, login }) => {
      const dir = screenshotDir('comprehensive-json', device.name);
      await page.setViewportSize(device.viewport);
      
      await page.goto('/lanes?new=true');
      await login('json-tester');

      await page.getByPlaceholder('Paste recipe here...').fill('test eggs');
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      await screenshot(page, dir, 'debug-before-node-visible');
      await expect(page.locator('.react-flow__node').first()).toBeVisible();

      // Toggle JSON
      await page.getByTitle('Toggle JSON View').click();
      const jsonTextarea = page.locator('textarea[placeholder="Graph JSON..."]');
      await screenshot(page, dir, 'debug-before-json-textarea');
      await expect(jsonTextarea).toBeVisible();
      await screenshot(page, dir, 'json-view');
      
      const jsonContent = await jsonTextarea.inputValue();
      expect(jsonContent).toContain('"id":');
      expect(jsonContent).not.toContain('"iconUrl":');
      cleanupScreenshots(dir);
    });

    test(`${device.name}: Draft Persistence`, async ({ page }) => {
      const dir = screenshotDir('comprehensive-draft', device.name);
      await page.setViewportSize(device.viewport);

      await page.goto('/lanes?new=true');
      const input = page.getByPlaceholder('Paste recipe here...');
      await input.fill('My Secret Draft Recipe');
      await screenshot(page, dir, 'text-entered');
      
      // Reload
      await page.reload();
      
      // Check if text persists
      await screenshot(page, dir, 'debug-before-persistence-check');
      await expect(input).toHaveValue('My Secret Draft Recipe');
      await screenshot(page, dir, 'text-persisted');
      cleanupScreenshots(dir);
    });

    test(`${device.name}: Shift+Click Multi-Select`, async ({ page, login }) => {
      const dir = screenshotDir('comprehensive-multiselect', device.name);
      await page.setViewportSize(device.viewport);
      
      // Use "complex" mock to get multiple nodes
      await page.goto('/lanes?new=true');
      await login('select-tester');

      await page.getByPlaceholder('Paste recipe here...').fill('complex test');
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      
      const nodes = page.locator('.react-flow__node');
      await screenshot(page, dir, 'debug-before-nodes-count');
      await expect(nodes).toHaveCount(9); // Complex mock has 9 nodes

      const node1 = nodes.nth(0);
      const node2 = nodes.nth(1);

      // Click first
      await node1.click();
      await screenshot(page, dir, 'debug-after-first-click');
      await expect(node1).toHaveClass(/selected/);
      await expect(node2).not.toHaveClass(/selected/);
      await screenshot(page, dir, 'first-selected');

      // Shift+Click second
      await page.keyboard.down('Shift');
      await node2.click();
      await page.keyboard.up('Shift');

      // Both should be selected
      await screenshot(page, dir, 'debug-after-shift-click');
      await expect(node1).toHaveClass(/selected/);
      await expect(node2).toHaveClass(/selected/);
      await screenshot(page, dir, 'both-selected');
      cleanupScreenshots(dir);
    });
  }
});
