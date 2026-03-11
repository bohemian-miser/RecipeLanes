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

test.skip('[OLD] Ingredients Sidebar', () => {
  for (const device of deviceConfigs) {
    test(`${device.name}: Sidebar toggles and scales quantities`, async ({ page, login }) => {
      const dir = screenshotDir('ingredients-sidebar', device.name);
      await page.setViewportSize(device.viewport);

      await page.goto('/lanes?new=true');
      // Programmatic Login
      await login('tester-sidebar');

      await page.getByPlaceholder('Paste recipe here...').fill('test eggs');
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      await screenshot(page, dir, '01-graph-loaded');

      // Open Sidebar
      await page.getByTitle('Toggle Ingredients').click();
      
      const sidebar = page.locator('div.absolute.left-0.top-14');
      await screenshot(page, dir, '00-debug-before-sidebar-visible');
      await expect(sidebar).toBeVisible();
      await screenshot(page, dir, '02-sidebar-open');
      
      // Check initial serves
      const serveCount = sidebar.locator('span.font-mono');
      await screenshot(page, dir, '00-debug-before-serves-1');
      await expect(serveCount).toHaveText('1'); // Default 1

      // Check initial quantities
      const eggRow = sidebar.locator('div', { hasText: 'Eggs' }).last();
      await screenshot(page, dir, '00-debug-before-egg-row');
      await expect(eggRow).toBeVisible();
      await expect(eggRow).toContainText('2');
      
      const flourRow = sidebar.locator('div', { hasText: 'Flour' }).last();
      await screenshot(page, dir, '00-debug-before-flour-row');
      await expect(flourRow).toBeVisible();
      await expect(flourRow).toContainText('100');

      // Increase Serves to 2
      await sidebar.getByRole('button', { name: '+' }).click();
      await screenshot(page, dir, '00-debug-before-serves-2');
      await expect(serveCount).toHaveText('2');
      await screenshot(page, dir, '03-serves-increased');

      // Check scaled quantities in Sidebar
      await screenshot(page, dir, '00-debug-before-scaled-quantities');
      await expect(sidebar.locator('text=4').first()).toBeVisible();
      await expect(sidebar.locator('text=200').first()).toBeVisible();

      // Check Graph Nodes updated
      const eggNode = page.locator('.react-flow__node', { hasText: 'Eggs' });
      await screenshot(page, dir, '00-debug-before-egg-node-scaled');
      await expect(eggNode).toContainText('4');
      
      const flourNode = page.locator('.react-flow__node', { hasText: 'Flour' });
      await screenshot(page, dir, '00-debug-before-flour-node-scaled');
      await expect(flourNode).toContainText('200');

      // Close Sidebar
      await sidebar.getByRole('button').first().click(); 
      await expect(sidebar).not.toBeVisible();
      await screenshot(page, dir, '04-sidebar-closed');
      cleanupScreenshots(dir);
    });
  }
});