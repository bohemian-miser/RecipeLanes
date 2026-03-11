/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { test, expect } from '../utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots} from '../utils/screenshot';
import { deviceConfigs } from '../utils/devices';
import { create_recipe, wait_for_graph, get_node } from '../utils/actions';

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
      await create_recipe(page, 'test complex', dir);
      
      const viewport = page.locator('.react-flow__viewport');
      await screenshot(page, dir, 'graph-visible-check');
      await wait_for_graph(page, dir);
      
      // Wait for icons to populate (indicates background process finished)
      // This prevents race conditions where background updates revert user edits during the test
      await expect(page.locator('img[alt=""]').first()).toBeVisible({ timeout: 20000 });
      await page.waitForTimeout(2000); 

      const getEdgeCount = async () => await page.locator('.react-flow__edge').count();
      const initialEdgeCount = await getEdgeCount();
      console.log('Initial Edge Count:', initialEdgeCount);
      expect(initialEdgeCount).toBe(9);

      // 1. Delete "Combine (Common)"
      const commonNode = get_node(page, 'Combine (Common)');
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
      const nodeA = get_node(page, 'Ingredient A');
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
      const nodeB = get_node(page, 'Process B');
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
      await wait_for_graph(page, dir);

      // 7. Verify positions AFTER reload
      const nodeA_Reload = get_node(page, 'Ingredient A');
      const boxA_Reload = await nodeA_Reload.boundingBox();
      
      // Expect it to be where it was moved to.
      expect(Math.abs(boxA_Reload!.x - (boxA!.x + moveAX))).toBeLessThan(tolerance);
      expect(Math.abs(boxA_Reload!.y - (boxA!.y + moveAY))).toBeLessThan(tolerance);

      const nodeB_Reload = get_node(page, 'Process B');
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