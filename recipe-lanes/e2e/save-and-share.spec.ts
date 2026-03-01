import { test, expect, Page } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';
import { create_recipe, wait_for_graph } from './utils/actions';

test.describe('Save and Share Functionality', () => {
  test.slow();

  for (const device of deviceConfigs) {
    test(`${device.name}: guest save and share flow`, async ({ page }) => {
      const dir = screenshotDir('guest-save-share', device.name);
      
      // Create a recipe
      await page.goto('/lanes?new=true');
      await create_recipe(page, 'test eggs', dir);
      
      // Wait for graph
      await wait_for_graph(page, dir);
      
      // Auto-save check: URL should have ID immediately after generation
      await expect(page).toHaveURL(/id=/, { timeout: 20000 });

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
      await screenshot(page, dir, '03-new-clicked-cleared');
      cleanupScreenshots(dir);
    });

    if (!device.isMobile) {
      test(`${device.name}: authenticated save flow`, async ({ page, login }) => {
        const dir = screenshotDir('auth-save', device.name);
        await page.goto('/lanes?new=true');
        await login('save-tester');
        await create_recipe(page, 'test eggs', dir);
        
        await expect(page).toHaveURL(/id=/, { timeout: 20000 });
        await screenshot(page, dir, 'auth-graph-created');
        
        // Modify
        const node = page.locator('.react-flow__node').first();
        await node.dragTo(page.locator('.react-flow__pane'), { sourcePosition: { x: 10, y: 10 }, targetPosition: { x: 100, y: 100 } });
        
        // Explicit Save
        const saveBtn = page.locator('button[title="Save Changes"]');
        await saveBtn.click();
        
        // Expect success notification
        await expect(page.getByText('Saved changes.')).toBeVisible();
        await screenshot(page, dir, 'auth-saved');
        cleanupScreenshots(dir);
      });
    }
  }
});
