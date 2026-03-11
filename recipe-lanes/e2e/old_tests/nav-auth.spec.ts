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

test.describe('Navigation Auth Visibility', () => {
  for (const device of deviceConfigs) {
    test(`${device.name}: Private links visibility toggle`, async ({ page, login }) => {
      const dir = screenshotDir('nav-auth', device.name);
      await page.setViewportSize(device.viewport);

      // 1. Start as Guest
      await page.goto('/lanes');
      
      // Verify Guest UI: Mine/Starred should be hidden
      await screenshot(page, dir, 'guest-mode');
      
      // Check for presence of Public link (should be visible)
      await expect(page.getByTitle('Public Gallery')).toBeVisible();
      
      // Check for absence of private links
      await expect(page.getByTitle('My Recipes')).not.toBeVisible();
      await expect(page.getByTitle('Starred')).not.toBeVisible();

      // 2. Log In
      await login('user-test-nav', { displayName: 'Nav Tester' });
      
      // Wait for login state to settle
      await expect(page.getByTitle('Logout')).toBeVisible({ timeout: 15000 });
      
      // Verify User UI: Mine/Starred should be visible
      await screenshot(page, dir, 'user-mode');
      
      await expect(page.getByTitle('Public Gallery')).toBeVisible();
      // On mobile, text might be hidden but icon/link is there. Title attribute is on the Link component.
      // We use .first() because sometimes multiple elements might match if we aren't strict, 
      // but here we expect exactly one in the header.
      await expect(page.getByTitle('My Recipes')).toBeVisible();
      await expect(page.getByTitle('Starred')).toBeVisible();

      // 3. Logout
      await page.getByTitle('Logout').click();
      
      // Verify return to hidden state
      await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
      await screenshot(page, dir, 'logout-mode');
      
      await expect(page.getByTitle('My Recipes')).not.toBeVisible();
      await expect(page.getByTitle('Starred')).not.toBeVisible();
      
      cleanupScreenshots(dir);
    });
  }
});