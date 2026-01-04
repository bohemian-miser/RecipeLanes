import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots} from './utils/screenshot';
import { deviceConfigs } from './utils/devices';

test.describe('Graph Persistence', () => {
  test.slow();

  const desktopDevices = deviceConfigs.filter(d => d.name === 'desktop');

  for (const device of desktopDevices) {
    test.skip(`${device.name}: delete node then move nodes and verify persistence`, async ({ page, login }) => {
      const dir = screenshotDir('move-node-save', device.name);

      await page.setViewportSize(device.viewport);
      await page.goto('/lanes');
      await screenshot(page, dir, 'initial-page');

      // Login to ensure we can save
      await login('user-owner', { displayName: 'Recipe Owner' });
      await screenshot(page, dir, 'logged-in');
      await expect(page.getByTitle('Logout')).toBeVisible({ timeout: 15000 });

      // Create complex graph
      await page.getByPlaceholder('Paste recipe here...').fill('test complex');
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      await screenshot(page, dir, 'recipe-created');

      const viewport = page.locator('.react-flow__viewport');
      await screenshot(page, dir, 'graph-visible-check');
      await expect(viewport).toBeVisible({ timeout: 30000 });

      // Wait for load
      await screenshot(page, dir, 'waiting-for-nodes');
      await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10000 });
      
      // Wait for icons to populate (indicates background process finished)
      // This prevents race conditions where background updates revert user edits during the test
      await expect(page.locator('img[alt=""]').first()).toBeVisible({ timeout: 20000 });
      await page.waitForTimeout(2000); 

      const getEdgeCount = async () => await page.locator('.react-flow__edge').count();
      const initialEdgeCount = await getEdgeCount();
      console.log('Initial Edge Count:', initialEdgeCount);
      expect(initialEdgeCount).toBe(9);

      // 1. Delete "Combine (Common)"
      const commonNode = page.locator('.react-flow__node').filter({ hasText: 'Combine (Common)' }).first();
      await screenshot(page, dir, 'common-node-before-delete');
      await expect(commonNode).toBeVisible();
      
      await commonNode.click();
      await commonNode.hover();
      const deleteBtn = commonNode.getByRole('button', { name: /Delete Step/i });
      await screenshot(page, dir, 'delete-btn-visible');
      await expect(deleteBtn).toBeVisible();
      await deleteBtn.click({ force: true });
      
      await screenshot(page, dir, 'node-deleted');
      await expect(commonNode).not.toBeVisible();

      // Verify edge count preserved (Bridging Logic)
      const edgesAfterDelete = await getEdgeCount();
      console.log('Edges after delete:', edgesAfterDelete);
      expect(edgesAfterDelete).toBe(9); 

      // 2. Move "Ingredient A"
      const nodeA = page.locator('.react-flow__node').filter({ hasText: 'Ingredient A' }).first();
      const boxA = await nodeA.boundingBox();
      const moveAX = 150;
      const moveAY = 100;

      // Touch away from A
      await page.mouse.click(boxA!.x - boxA!.width , boxA!.y);
      await screenshot(page, dir, 'background-clicked');
      // Expect the others to not be selected.
      
      await nodeA.hover();
      await page.mouse.down();
      await page.mouse.move(boxA!.x + boxA!.width / 2 + moveAX, boxA!.y + boxA!.height / 2 + moveAY, { steps: 10 });
      await page.mouse.up();
      
      await screenshot(page, dir, 'node-a-moved');
      
      // Check edges again
      const edgesAfterMoveA = await getEdgeCount();
      console.log('Edges after Move A:', edgesAfterMoveA);
      expect(edgesAfterMoveA).toBe(9);

      // 3. Move "Process B"
      const nodeB = page.locator('.react-flow__node').filter({ hasText: 'Process B' }).first();
      const boxB = await nodeB.boundingBox();
      const moveBX = -150;
      const moveBY = 50;

      await nodeB.hover();
      await page.mouse.down();
      await page.mouse.move(boxB!.x + boxB!.width / 2 + moveBX, boxB!.y + boxB!.height / 2 + moveBY, { steps: 10 });
      await page.mouse.up();

      await screenshot(page, dir, 'node-b-moved');

      // Check edges again
      const edgesAfterMoveB = await getEdgeCount();
      console.log('Edges after Move B:', edgesAfterMoveB);
      expect(edgesAfterMoveB).toBe(9);

      // 4. Wait 3 seconds
      console.log('Waiting 3 seconds for stability/save...');
      await page.waitForTimeout(3000);
      await screenshot(page, dir, 'after-wait');

      // Check edges after wait (did background update kill them?)
      const edgesAfterWait = await getEdgeCount();
      console.log('Edges after Wait:', edgesAfterWait);
      expect(edgesAfterWait).toBe(9);

      // 5. Verify positions BEFORE reload
      // Re-measure A
      const boxA_AfterWait = await nodeA.boundingBox();
      const tolerance = 40;
      
      // Expect it to be at new position
      expect(Math.abs(boxA_AfterWait!.x - (boxA!.x + moveAX))).toBeLessThan(tolerance);
      expect(Math.abs(boxA_AfterWait!.y - (boxA!.y + moveAY))).toBeLessThan(tolerance);

      // Re-measure B
      const boxB_AfterWait = await nodeB.boundingBox();
      expect(Math.abs(boxB_AfterWait!.x - (boxB!.x + moveBX))).toBeLessThan(tolerance);
      expect(Math.abs(boxB_AfterWait!.y - (boxB!.y + moveBY))).toBeLessThan(tolerance);

      // 6. Reload
      await page.reload();
      await screenshot(page, dir, 'after-reload');
      await expect(viewport).toBeVisible({ timeout: 30000 });
      await screenshot(page, dir, 'after-reload');
      await expect(page.locator('.react-flow__node').first()).toBeVisible();
      await screenshot(page, dir, 'after-reload');

      // 7. Verify positions AFTER reload
      const nodeA_Reload = page.locator('.react-flow__node').filter({ hasText: 'Ingredient A' }).first();
      const boxA_Reload = await nodeA_Reload.boundingBox();
      
      // Expect it to be where it was moved to.
      expect(Math.abs(boxA_Reload!.x - (boxA!.x + moveAX))).toBeLessThan(tolerance);
      expect(Math.abs(boxA_Reload!.y - (boxA!.y + moveAY))).toBeLessThan(tolerance);

      const nodeB_Reload = page.locator('.react-flow__node').filter({ hasText: 'Process B' }).first();
      const boxB_Reload = await nodeB_Reload.boundingBox();
      
      expect(Math.abs(boxB_Reload!.x - (boxB!.x + moveBX))).toBeLessThan(tolerance);
      expect(Math.abs(boxB_Reload!.y - (boxB!.y + moveBY))).toBeLessThan(tolerance);

      // 8. Verify Edges After Reload
      const edgesAfterReload = await getEdgeCount();
      console.log('Edges after Reload:', edgesAfterReload);
      expect(edgesAfterReload).toBe(9);

      cleanupScreenshots(dir);
    });
  }
});
