import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';

test.describe('Guest Forking', () => {
  for (const device of deviceConfigs) {
    if (device.isMobile) continue;

    test(`${device.name}: Guest Forking Workflow`, async ({ page, login }) => {
      const dir = screenshotDir('guest-fork', device.name);
      await page.setViewportSize(device.viewport);

      // 1. Login as Alice and create recipe
      await page.goto('/lanes?new=true');
      await login('mock-alice');
      await page.getByPlaceholder('Paste recipe here...').fill('Alice Recipe');
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      await screenshot(page, dir, '00-debug-before-alice-id');
      await expect(page).toHaveURL(/id=/, { timeout: 15000 });
      const aliceUrl = page.url();
      const aliceId = new URL(aliceUrl).searchParams.get('id');
      await screenshot(page, dir, '01-alice-created');
      
      // 2. Logout via UI
      await page.getByTitle('Logout').click();
      await screenshot(page, dir, '00-debug-before-login-button');
      await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
      await screenshot(page, dir, '02-logged-out');
      
      // 3. Visit as Guest
      await page.goto(aliceUrl);
      await screenshot(page, dir, '00-debug-before-guest-input');
      await expect(page.getByPlaceholder('Paste recipe here...')).toHaveValue('Alice Recipe');
      await screenshot(page, dir, '03-guest-view');
      
      // 4. Modify
      await page.getByPlaceholder('Paste recipe here...').fill('Alice Recipe Modified');
      await page.locator('button.bg-yellow-500').click();
      
      // 5. Verify Success (New ID)
      await screenshot(page, dir, '00-debug-before-guest-fork-id');
      await expect(page).toHaveURL(new RegExp(`id=(?!${aliceId})`), { timeout: 15000 });
      await screenshot(page, dir, '00-debug-before-guest-banner');
      await expect(page.locator('text=Recipe not saved to account')).toBeVisible(); // Guest banner
      await screenshot(page, dir, '04-guest-forked');
      cleanupScreenshots(dir);
    });
  }
});
