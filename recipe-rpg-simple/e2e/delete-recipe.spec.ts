import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';

test.describe('Recipe Deletion', () => {
  for (const device of deviceConfigs) {
    if (device.isMobile) continue;

    test(`${device.name}: Create and Delete Recipe`, async ({ page, login }) => {
      const dir = screenshotDir('delete-recipe', device.name);
      await page.setViewportSize(device.viewport);

      // 1. Login
      await page.goto('/lanes?new=true');
      await login('mock-alice-delete');
      
      // 2. Create Recipe
      const recipeTitle = 'Recipe to Delete ' + Date.now();
      await page.getByPlaceholder('Paste recipe here...').pressSequentially('Ingredients for deletion');
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      await expect(page).toHaveURL(/id=/);
      
      // Set Explicit Title
      await page.locator('h1').click();
      await page.locator('input.bg-transparent').fill(recipeTitle);
      await page.locator('input.bg-transparent').press('Enter');
      await expect(page.locator('h1')).toHaveText(recipeTitle);

      await screenshot(page, dir, '01-created');

      // 3. Go to My Recipes
      await page.goto('/gallery?filter=mine');
      await screenshot(page, dir, '02-gallery-view');
      await expect(page.getByText(recipeTitle)).toBeVisible();

      // 4. Handle Dialog
      page.on('dialog', dialog => dialog.accept());

      // 5. Click Delete (hover first to show button)
      // The button appears on hover over the card. 
      // We can force click or hover then click.
      const card = page.locator('div').filter({ hasText: recipeTitle }).last(); // recipe-card outer div
      await card.hover();
      await screenshot(page, dir, '03-hover-card');
      
      const deleteBtn = card.locator('button[title="Delete Recipe"]');
      await expect(deleteBtn).toBeVisible();
      await deleteBtn.click();

      // 6. Verify Deletion
      await screenshot(page, dir, '04-deleted');
      await expect(card).not.toBeVisible();
      
      cleanupScreenshots(dir);
    });
  }
});
