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
import { move_node, delete_node, click_undo, create_recipe, wait_for_graph, get_node } from '../utils/actions';

test.describe('Undo Persistence Interaction', () => {
  test.slow();

  const desktopDevices = deviceConfigs.filter(d => d.name === 'desktop');

  for (const device of desktopDevices) {
    test(`${device.name}: complex undo redo persistence check`, async ({ page, login }) => {
      const dir = screenshotDir('undo-persistence-complex', device.name);

      await page.setViewportSize(device.viewport);
      await page.goto('/lanes');
      
      await login('user-owner', { displayName: 'Recipe Owner' });
      await expect(page.getByTitle('Logout')).toBeVisible({ timeout: 15000 });

      await create_recipe(page, 'test complex', dir);
      await wait_for_graph(page, dir);
      
      // Wait for icons to populate
      await expect(page.locator('img[alt=""]').first()).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(1000); 

      const getNodeCount = async () => await page.locator('.react-flow__node').count();
      expect(await getNodeCount()).toBe(9);

      // 1. Delete "Combine (Common)"
      await delete_node(page, 'Combine (Common)', dir);
      expect(await getNodeCount()).toBe(8);

      // 2. Undo Delete
      await click_undo(page, dir);
      expect(await getNodeCount()).toBe(9);

      // 3. Move Restored Node (Common)
      const commonNode = get_node(page, 'Combine (Common)');
      const boxCommon = await commonNode.boundingBox();
      const moveCommonX = 200;
      await move_node(page, 'Combine (Common)', moveCommonX, 0, dir);

      // 4. Move Another Node (Ing A)
      const nodeA = get_node(page, 'Ingredient A');
      const boxA = await nodeA.boundingBox();
      const moveAX = -100;
      await move_node(page, 'Ingredient A', moveAX, 0, dir);

      // 5. Delete Node A
      await delete_node(page, 'Ingredient A', dir);
      expect(await getNodeCount()).toBe(8);

      // 6. Undo Delete Node A
      await click_undo(page, dir);
      await expect(nodeA).toBeVisible();
      expect(await getNodeCount()).toBe(9);
      
      const boxA_Restored = await nodeA.boundingBox();
      const tolerance = 25; 
      // Should be at Moved Position
      expect(Math.abs(boxA_Restored!.x - (boxA!.x + moveAX))).toBeLessThan(tolerance);

      // 7. Undo Move Node A
      await click_undo(page, dir);
      
      const boxA_Reverted = await nodeA.boundingBox();
      // Should be at Original Position
      expect(Math.abs(boxA_Reverted!.x - boxA!.x)).toBeLessThan(tolerance);

      // 8. Verify Common Node is Still Moved
      const boxCommon_Check = await commonNode.boundingBox();
      expect(Math.abs(boxCommon_Check!.x - (boxCommon!.x + moveCommonX))).toBeLessThan(tolerance);

      cleanupScreenshots(dir);
    });
  }
});