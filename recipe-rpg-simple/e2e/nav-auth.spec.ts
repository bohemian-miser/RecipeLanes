import { test, expect } from './utils/fixtures'; 
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';

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
