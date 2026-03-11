import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';

test.describe('Smoke Tests (Consolidated)', () => {
  const desktop = deviceConfigs.find(d => d.name === 'desktop')!;
  const phone = deviceConfigs.find(d => d.name === 'phone')!;
  const smokeDevices = [desktop, phone];

  for (const device of smokeDevices) {
    test(`${device.name}: Basic Page Loads`, async ({ page }) => {
      const dir = screenshotDir('smoke-basic', device.name);
      await page.setViewportSize(device.viewport);
      
      // Home / Lanes
      await page.goto('/lanes');
      await expect(page).toHaveTitle(/Recipe Lanes/);
      
      // Gallery
      await page.goto('/gallery');
      await expect(page.locator('h1, h2').filter({ hasText: /Gallery|Collection/ })).toBeVisible();
      
      cleanupScreenshots(dir);
    });

    test(`${device.name}: Auth Flow & Nav Visibility`, async ({ page, login }) => {
      const dir = screenshotDir('smoke-auth', device.name);
      await page.setViewportSize(device.viewport);

      // 1. Guest Mode
      await page.goto('/lanes');
      const loginBtn = page.getByRole('button', { name: 'Login' });
      await expect(loginBtn).toBeVisible();
      await expect(page.getByTitle('My Recipes')).not.toBeVisible();

      // 2. Login
      const uid = `smoke-user-${device.name}`;
      const displayName = `Smoke Tester ${device.name}`;
      await login(uid, { displayName });
      
      const logoutBtn = page.getByTitle('Logout');
      await expect(logoutBtn).toBeVisible({ timeout: 15000 });
      
      // Profile check
      if (device.isMobile) {
          await expect(page.getByText(displayName)).toBeAttached();
      } else {
          await expect(page.getByText(displayName)).toBeVisible();
      }

      // Nav Links check
      await expect(page.getByTitle('My Recipes')).toBeVisible();
      await expect(page.getByTitle('Starred')).toBeVisible();

      // 3. Logout
      await logoutBtn.click();
      await expect(loginBtn).toBeVisible();
      await expect(page.getByTitle('My Recipes')).not.toBeVisible();
      
      cleanupScreenshots(dir);
    });
  }

  // Banner logic (Desktop only to avoid layout complexity)
  test('Desktop: Banner Logic (Guest & Notifications)', async ({ page, context }) => {
    const dir = screenshotDir('smoke-banners', desktop.name);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.setViewportSize(desktop.viewport);
    
    await page.goto('/lanes?new=true');
    await page.getByPlaceholder('Paste recipe here...').fill('Smoke Banner Test');
    await page.locator('button:has(svg.lucide-arrow-right)').click();
    
    // 1. Guest Warning Banner
    const guestBanner = page.locator('div').filter({ hasText: 'Recipe not saved to account' }).last();
    await expect(guestBanner).toBeVisible({ timeout: 15000 });
    await guestBanner.click({ position: { x: 5, y: 5 } });
    await expect(guestBanner).not.toBeVisible();

    // 2. Notification Banner (via Share)
    await expect(page.locator('.react-flow__viewport')).toBeVisible();
    await page.locator('button[title="Save & Copy Link"]').click();
    
    const notifyBanner = page.locator('div').filter({ hasText: 'Link copied to clipboard' }).last();
    await expect(notifyBanner).toBeVisible();
    await notifyBanner.click();
    await expect(notifyBanner).not.toBeVisible();

    cleanupScreenshots(dir);
  });

  test('Regression: Issue 34 - Hide Raw User ID', async ({ page, login }) => {
    const dir = screenshotDir('smoke-issue-34', desktop.name);
    await page.setViewportSize(desktop.viewport);
    
    const uid = 'user-no-name-' + Date.now();
    await page.goto('/lanes?new=true');
    await login(uid, { displayName: '' }); 
    
    await page.getByPlaceholder('Paste recipe here...').fill('Issue 34 test');
    await page.locator('button:has(svg.lucide-arrow-right)').click();
    await expect(page).toHaveURL(/id=/, { timeout: 20000 });
    
    const header = page.locator('header');
    const byLine = header.getByText(/by /);
    await expect(byLine).toBeVisible();
    const text = await byLine.innerText();
    
    // Should NOT show raw UID if it's long/ugly
    expect(text).not.toContain(uid); 
    cleanupScreenshots(dir);
  });
});
