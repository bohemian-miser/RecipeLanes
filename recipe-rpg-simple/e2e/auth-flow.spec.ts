// Important: Import 'test' from your custom fixtures, not '@playwright/test'
import { test, expect } from './utils/fixtures'; 
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';

test.describe('Authentication Flow', () => {
  for (const device of deviceConfigs) {
    test(`${device.name}: Login and Logout (Emulator)`, async ({ page, login }) => {
      const dir = screenshotDir('auth-flow', device.name);
      await page.setViewportSize(device.viewport);

      // 1. Start as Guest
      await page.goto('/lanes');
      
      // Verify Guest UI
      await screenshot(page, dir, '01-start');
      const loginBtn = page.getByRole('button', { name: 'Login' });
      await expect(loginBtn).toBeVisible();
      await expect(page.getByTitle('Logout')).not.toBeVisible();

      // 2. Log In Programmatically
      // We use Chef Ramsay to verify profile data propagation
      await screenshot(page, dir, '02-before-login');
      await login('user-ramsay', { displayName: 'Chef Ramsay' });
      
      // Wait for auth update
      const logoutBtn = page.getByTitle('Logout');
      await expect(logoutBtn).toBeVisible({ timeout: 15000 });
      
      // Name is hidden on mobile via CSS, so we check for attachment instead of visibility
      await screenshot(page, dir, '03-after-login');
      if (device.isMobile) {
          await expect(page.getByText(/Chef Ramsay/)).toBeAttached();
      } else {
          await expect(page.getByText(/Chef Ramsay/)).toBeVisible();
      }

      // 3. Click Logout
      await logoutBtn.click();

      // 4. Verify Return to Guest UI
      await screenshot(page, dir, '04-after-logout');
      await expect(loginBtn).toBeVisible();
      await expect(logoutBtn).not.toBeVisible();
      cleanupScreenshots(dir);
    });
  }
});