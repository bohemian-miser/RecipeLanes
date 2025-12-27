import { test, expect, devices, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const deviceConfigs = [
  { name: 'phone', viewport: devices['iPhone 12'].viewport!, isMobile: true },
  { name: 'desktop', viewport: { width: 1280, height: 720 }, isMobile: false },
];

const screenshotDir = (testName: string, deviceName: string) => {
  const dir = path.join('test_screenshots', testName, deviceName);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const screenshot = async (page: Page, dir: string, name: string) => {
  await page.screenshot({
    path: path.join(dir, `${name}.png`),
    fullPage: true,
  });
};

test.skip('Save and Share Functionality', () => {
  test.slow();

  for (const device of deviceConfigs) {
    test(`${device.name}: guest save and share flow`, async ({ page, context }) => {
      // Setup listener for save completion
      let saveResolved = false;
      const savePromise = new Promise<void>(resolve => {
          page.on('console', msg => {
              console.log(`[Browser Console] ${msg.text()}`);
              if (msg.text().includes('Save result:')) {
                  saveResolved = true;
                  resolve();
              }
          });
      });

      // Create a recipe
      await page.getByPlaceholder('Paste recipe here...').fill('test eggs');
      await page.locator('button.bg-yellow-500').click();
      
      // Wait for graph
      const viewport = page.locator('.react-flow__viewport');
      await expect(viewport).toBeVisible({ timeout: 15000 });
      
      // Wait for auto-save to complete
      await savePromise;
      await page.waitForTimeout(1000); // Allow router update

      // Auto-save check: URL should have ID immediately after generation
      await expect(page).toHaveURL(/id=/, { timeout: 20000 });
      const urlBefore = page.url();

      // 1. Test "Save" button (should warn guest)
      // Save button is the Check/Save icon in the panel.
      // It has title "Log in to save recipe" if !isLoggedIn.
      const saveBtn = page.locator('button[title="Log in to save recipe"]');
      // If it's not found, maybe isLoggedIn is true? (Should be false by default in E2E)
      await expect(saveBtn).toBeVisible();
      
      await saveBtn.click();
      await screenshot(page, dir, '04-save-clicked');
      
      // Check for notification
      // The notification banner is div with text "Log in to save recipe"
      const notification = page.locator('div.bg-green-500\/10').filter({ hasText: 'Log in to save recipe' });
      await expect(notification).toBeVisible();
      await screenshot(page, dir, '05-login-notification');

      // Wait a bit or click Share
      // 2. Test "Share" button (should save and copy link)
      // Share button has title "Save & Copy Link" or "Copied!"
      // Since it's already saved (auto-save), it might just copy link.
      const shareBtn = page.locator('button[title="Save & Copy Link"]');
      await expect(shareBtn).toBeVisible();
      
      await shareBtn.click();
      await screenshot(page, dir, '05-share-clicked');
      
      // Check notification "Link copied..."
      const shareNotification = page.locator('div.bg-green-500\/10').filter({ hasText: /Link copied/ });
      await expect(shareNotification).toBeVisible();
      await screenshot(page, dir, '06-share-notification');
      
      // Verify URL hasn't changed drastically (same ID)
      expect(page.url()).toBe(urlBefore);

      // 3. Test "New" button
      // New button is a Link with title "Create New"
      const newLink = page.locator('a[title="Create New"]');
      await newLink.click();
      
      // Wait for URL to clear ID
      await expect(page).not.toHaveURL(/id=/);
      
      // Verify input cleared
      await expect(page.getByPlaceholder('Paste recipe here...')).toHaveValue('');
      await expect(viewport).not.toBeVisible();
      
      await screenshot(page, dir, '07-new-clicked-cleared');
    });
  }
});
