import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';
import { create_recipe } from './utils/actions';

test.describe('Mobile Recipe Deletion', () => {
  for (const device of deviceConfigs) {
    if (!device.isMobile) continue; // Only mobile

    test(`${device.name}: Delete Button Visibility`, async ({ page, login }) => {
      const dir = screenshotDir('delete-mobile', device.name);
      await page.setViewportSize(device.viewport);

      // 1. Login
      await page.goto('/lanes?new=true');
      await login('mobile-deleter');
      await expect(page.getByTitle('Logout')).toBeVisible();

      // 2. Create Recipe
      await create_recipe(page, 'Ingredients for deletion', dir);

      // Wait for URL change or Graph element
      await Promise.race([
        expect(page).toHaveURL(/id=/),
        expect(page.locator('.react-flow')).toBeVisible()
      ]);

      // 3. Go to My Recipes
      await page.goto('/gallery?filter=mine');
      await screenshot(page, dir, 'gallery-loaded');
      
      // 4. Check for Delete Button Visibility WITHOUT Hover
      // We look for the delete button within a recipe card
      // Wait for at least one card
      await expect(page.locator('.bg-zinc-900').first()).toBeVisible();
      
      const deleteBtn = page.locator('button[title="Delete Recipe"]').first();
      
      // This expectation should PASS now if the fix works
      await expect(deleteBtn).toBeVisible({ timeout: 5000 });
      await screenshot(page, dir, 'button-visible');

      // 5. Delete
      page.on('dialog', dialog => dialog.accept());
      await deleteBtn.click();
      
      // 6. Verify Gone
      await expect(deleteBtn).not.toBeVisible();
      
      cleanupScreenshots(dir);
    });
  }
});