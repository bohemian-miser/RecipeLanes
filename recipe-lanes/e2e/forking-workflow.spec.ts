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

import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';

test.describe('Forking Workflow', () => {
  for (const device of deviceConfigs) {
    if (device.isMobile) continue;

    test(`${device.name}: Alice Copy Workflow`, async ({ page, login }) => {
      const dir = screenshotDir('forking-workflow', device.name);
      await page.setViewportSize(device.viewport);

      // 1. Login as Alice
      await page.goto('/lanes?new=true');
      await login('mock-alice');

      // 2. Create Recipe
      await page.getByPlaceholder('Paste recipe here...').fill('test eggs with alice');
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      
      // Wait for ID
      await screenshot(page, dir, 'debug-before-alice-id');
      await expect(page).toHaveURL(/id=/, { timeout: 15000 });
      const aliceUrl = page.url();
      const aliceId = new URL(aliceUrl).searchParams.get('id');
      console.log('Alice Recipe ID:', aliceId);
      await screenshot(page, dir, '01-alice-created');

      // 3. Login as Bob (Overrides session)
      await login('mock-bob');

      // 4. Bob visits Alice's recipe
      await page.goto(aliceUrl);
      // Wait for load
      await screenshot(page, dir, 'debug-before-bob-view-text');
      await expect(page.getByPlaceholder('Paste recipe here...')).toHaveValue('test eggs with alice', { timeout: 15000 });
      await screenshot(page, dir, '02-bob-views-alice');

      // 5. Bob Modifies
      await page.getByPlaceholder('Paste recipe here...').fill('test eggs with alice\nAdd salt.');
      // Click arrow (visualize)
      await page.locator('button.bg-yellow-500').click();
      
      // 6. Verify Fork
      // URL should change to new ID (wait for it)
      await screenshot(page, dir, 'debug-before-bob-fork-id');
      await expect(page).toHaveURL(new RegExp(`id=(?!${aliceId})`), { timeout: 15000 });
      const bobId = new URL(page.url()).searchParams.get('id');
      console.log('Bob Copy ID:', bobId);
      expect(bobId).not.toBe(aliceId);
      
      // Title should change (Assuming "Copy of..." logic works on title derived from text)
      // Note: Parse might title it "Alice Soup". Fork becomes "Copy of Alice Soup".
      // We check for "Copy of"
      await screenshot(page, dir, 'debug-before-bob-title');
      await expect(page.locator('h1').first()).toHaveText(/Copy of/);
      await screenshot(page, dir, '03-bob-forked');

      // 7. Bob visits Alice's recipe again
      await page.goto(aliceUrl);
      
      // 8. Verify Banner
      await screenshot(page, dir, 'debug-before-banner');
      const banner = page.getByText(/You have \d+ existing cop/);
      await expect(banner).toBeVisible();
      
      // Check buttons
      await screenshot(page, dir, 'debug-before-banner-buttons');
      await expect(page.getByRole('link', { name: /existing cop/ })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save another copy' })).toBeVisible();
      await screenshot(page, dir, '04-bob-banner');
      cleanupScreenshots(dir);
    });
  }
});