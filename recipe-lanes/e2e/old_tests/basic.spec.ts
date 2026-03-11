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

test.describe('[OLD] Basic Sanity', () => {
  for (const device of deviceConfigs) {
    test(`${device.name}: has title and loads`, async ({ page }) => {
      const dir = screenshotDir('basic-sanity', device.name);
      await page.setViewportSize(device.viewport);
      
      await page.goto('/lanes');
      await screenshot(page, dir, 'debug-before-title-check');
      await expect(page).toHaveTitle(/Recipe Lanes/);
      await screenshot(page, dir, 'home-page');
      cleanupScreenshots(dir);
    });

    test(`${device.name}: loads gallery`, async ({ page }) => {
      const dir = screenshotDir('basic-gallery', device.name);
      await page.setViewportSize(device.viewport);

      await page.goto('/gallery');
      // Heading might be "Community Collection" or "Public Gallery" depending on impl
      await screenshot(page, dir, 'debug-before-gallery-check');
      await expect(page.locator('h1, h2').filter({ hasText: /Gallery|Collection/ })).toBeVisible();
      await screenshot(page, dir, 'gallery-page');
      cleanupScreenshots(dir);
    });
  }
});