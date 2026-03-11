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
import { screenshot, screenshotDir, cleanupScreenshots } from '../utils/screenshot';
import { deviceConfigs } from '../utils/devices';

test.describe('[OLD] UI Features', () => {

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
      
      // Tap (Click)
      await node1.click();
      await expect(node1).toHaveClass(/selected/);
      await screenshot(page, dir, '02-node-selected');
      
      // Tap Again -> Should select branch (if any)
      await node1.click();
      await expect(node1).toHaveClass(/selected/);
      await screenshot(page, dir, '03-branch-selected-logic');
      cleanupScreenshots(dir);
    });
  }
});