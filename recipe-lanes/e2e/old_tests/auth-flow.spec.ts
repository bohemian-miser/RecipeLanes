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

// Important: Import 'test' from your custom fixtures, not '@playwright/test'
import { test, expect } from '../utils/fixtures'; 
import { screenshot, screenshotDir, cleanupScreenshots } from '../utils/screenshot';
import { deviceConfigs } from '../utils/devices';

test.describe('Authentication Flow', () => {
  for (const device of deviceConfigs) {
    test(`${device.name}: Login and Logout (Emulator)`, async ({ page, login }) => {
      const dir = screenshotDir('auth-flow', device.name);
      await page.setViewportSize(device.viewport);

      // 1. Start as Guest
      await page.goto('/lanes');
      
      // Verify Guest UI
      await screenshot(page, dir, 'start');
      const loginBtn = page.getByRole('button', { name: 'Login' });
      await expect(loginBtn).toBeVisible();
      await expect(page.getByTitle('Logout')).not.toBeVisible();

      // 2. Log In Programmatically
      // We use Chef Ramsay to verify profile data propagation
      await screenshot(page, dir, 'before-login');
      await login('user-ramsay', { displayName: 'Chef Ramsay' });
      
      // Wait for auth update
      const logoutBtn = page.getByTitle('Logout');
      await expect(logoutBtn).toBeVisible({ timeout: 15000 });
      
      // Name is hidden on mobile via CSS, so we check for attachment instead of visibility
      await screenshot(page, dir, 'after-login');
      if (device.isMobile) {
          await expect(page.getByText(/Chef Ramsay/)).toBeAttached();
      } else {
          await expect(page.getByText(/Chef Ramsay/)).toBeVisible();
      }

      // 3. Click Logout
      await logoutBtn.click();

      // 4. Verify Return to Guest UI
      await screenshot(page, dir, 'after-logout');
      await expect(loginBtn).toBeVisible();
      await expect(logoutBtn).not.toBeVisible();
      cleanupScreenshots(dir);
    });
  }
});