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

test.describe('Save and Share Functionality', () => {
  test.slow();

  for (const device of deviceConfigs) {
    test(`${device.name}: guest save and share flow`, async ({ page, context }) => {
      const dir = screenshotDir('guest-save-share', device.name);
      
      // Create a recipe
      await page.goto('/lanes?new=true');
      await page.getByPlaceholder('Paste recipe here...').fill('test eggs');
      await page.locator('button.bg-yellow-500').click();
      
      // Wait for graph
      const viewport = page.locator('.react-flow__viewport');
      await expect(viewport).toBeVisible({ timeout: 15000 });
      
      // Auto-save check: URL should have ID immediately after generation
      await expect(page).toHaveURL(/id=/, { timeout: 20000 });
      const urlBefore = page.url();

      // 1. Test "Share" button (Guests CAN share/copy link)
      const shareBtn = page.locator('button[title="Save & Copy Link"]');
      await expect(shareBtn).toBeVisible();
      await shareBtn.click();
      
      // Should show "Copied!" tooltip/title on button
      await expect(page.locator('button[title="Copied!"]')).toBeVisible();
      await screenshot(page, dir, '01-share-clicked');

      // 2. Test "Save" button (Guests cannot explicit save)
      // First, make it dirty to enable the button
      const node = page.locator('.react-flow__node').first();
      await node.dragTo(page.locator('.react-flow__pane'), { sourcePosition: { x: 10, y: 10 }, targetPosition: { x: 50, y: 50 } });
      
      const saveBtn = page.locator('button[title="Save Changes"]');
      await expect(saveBtn).toBeVisible();
      await saveBtn.click();
      
      // Check for login warning notification
      const loginNotification = page.getByText('Log in to save recipe');
      await expect(loginNotification).toBeVisible();
      await screenshot(page, dir, '02-save-clicked-guest');

      // 3. Test "New" button
      const newBtn = page.locator('button[title="Create New"]');
      await newBtn.click();
      
      // Wait for URL to clear ID
      await expect(page).not.toHaveURL(/id=/);
      await expect(page.getByPlaceholder('Paste recipe here...')).toHaveValue('');
      await expect(viewport).not.toBeVisible();
      
      await screenshot(page, dir, '03-new-clicked-cleared');
    });
  }
});
