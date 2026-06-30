import { test, expect } from './utils/fixtures';
import { deviceConfigs } from './utils/devices';

test.describe('Smoke Tests (Consolidated)', () => {
  const desktop = deviceConfigs.find(d => d.name === 'desktop')!;
  const phone = deviceConfigs.find(d => d.name === 'phone')!;
  const smokeDevices = [desktop, phone];

  for (const device of smokeDevices) {
    test(`${device.name}: Basic Page Loads`, async ({ page }) => {
      await page.setViewportSize(device.viewport);

      // Home / Lanes
      await page.goto('/lanes');
      await expect(page).toHaveTitle(/Recipe Lanes/);

      // Gallery
      await page.goto('/gallery');
      await expect(page.locator('h1, h2').filter({ hasText: /Gallery|Collection/ })).toBeVisible();
    });

    test(`${device.name}: Auth Flow & Nav Visibility`, async ({ page, login }) => {
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
    });
  }

  // Banner logic (Desktop only to avoid layout complexity)
  test('Desktop: Banner Logic (Guest & Notifications)', async ({ page, context }) => {
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
    // Wait for the graph to fully settle (rf-ready) and the loading screen to
    // clear before clicking Share — clicking while the diagram is still mounting
    // can swallow the action so the "Link copied" notification never fires.
    await expect(page.getByTestId('rf-ready')).toBeAttached({ timeout: 30000 });
    await expect(page.getByTestId('loading-screen')).not.toBeVisible({ timeout: 30000 });
    await page.locator('button[title="Save & Copy Link"]').click();

    const notifyBanner = page.locator('div').filter({ hasText: 'Link copied to clipboard' }).last();
    await expect(notifyBanner).toBeVisible({ timeout: 15000 });
    await notifyBanner.click();
    await expect(notifyBanner).not.toBeVisible();
  });

  test('Regression: Issue 34 - Hide Raw User ID', async ({ page, login }) => {
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
  });
});
