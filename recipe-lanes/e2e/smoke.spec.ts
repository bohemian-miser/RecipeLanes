import { test, expect } from './utils/fixtures';

// Device fan-out is driven by Playwright projects (see playwright.config.ts):
// this suite runs once under the `desktop` project and once under the `mobile`
// project (real Pixel 5 device emulation — Issue #20). Mobile-awareness is
// derived from the active project rather than an in-spec viewport loop, so the
// tests exercise genuine touch/isMobile device emulation, not just a resized
// desktop viewport.
const isMobileProject = () => test.info().project.name === 'mobile';

test.describe('Smoke Tests (Consolidated)', () => {
  test('Basic Page Loads', async ({ page }) => {
    // Home / Lanes
    await page.goto('/lanes');
    await expect(page).toHaveTitle(/Recipe Lanes/);

    // Gallery
    await page.goto('/gallery');
    await expect(page.locator('h1, h2').filter({ hasText: /Gallery|Collection/ })).toBeVisible();
  });

  test('Auth Flow & Nav Visibility', async ({ page, login }) => {
    const device = test.info().project.name;

    // 1. Guest Mode
    await page.goto('/lanes');
    const loginBtn = page.getByRole('button', { name: 'Login' });
    await expect(loginBtn).toBeVisible();
    await expect(page.getByTitle('My Recipes')).not.toBeVisible();

    // 2. Login
    const uid = `smoke-user-${device}`;
    const displayName = `Smoke Tester ${device}`;
    await login(uid, { displayName });

    const logoutBtn = page.getByTitle('Logout');
    await expect(logoutBtn).toBeVisible({ timeout: 15000 });

    // Profile check
    if (isMobileProject()) {
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

  // Regression guard for Issue #20: the mobile project must apply *real* device
  // emulation (touch + isMobile), not just a resized desktop viewport. If the
  // mobile project is removed or degraded again, this fails on the mobile run.
  test('mobile: real device emulation is active', async ({ page }) => {
    test.skip(!isMobileProject(), 'mobile-project only');
    await page.goto('/lanes');
    const maxTouchPoints = await page.evaluate(() => navigator.maxTouchPoints);
    expect(maxTouchPoints).toBeGreaterThan(0);
  });

  // Banner logic (Desktop only to avoid layout complexity)
  test('Desktop: Banner Logic (Guest & Notifications)', async ({ page, context }) => {
    test.skip(isMobileProject(), 'desktop-only');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

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
    test.skip(isMobileProject(), 'desktop-only');

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
