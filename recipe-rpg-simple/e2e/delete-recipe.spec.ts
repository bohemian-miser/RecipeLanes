import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';

test.skip('Recipe Deletion', () => {
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
      await screenshot(page, dir, 'loaded');
      // await page.locator('header input').press('Enter');
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      await screenshot(page, dir, 'created');

      
      // await expect(page).toHaveURL(/id=/);
      
      // Set Explicit Title
      await page.locator('h1').click();

      await screenshot(page, dir, 'h1 clicked');
      await page.locator('header input').pressSequentially(recipeTitle);

      await screenshot(page, dir, 'title updated');
      await page.locator('header input').press('Enter');

      await screenshot(page, dir, 'pressed enter');
      await expect(page.locator('h1')).toHaveText(recipeTitle);

      await screenshot(page, dir, 'created');

      // 3. Go to My Recipes
      await page.goto('/gallery?filter=mine');
      await screenshot(page, dir, 'gallery-view');
      
      // TODO(https://github.com/bohemian-miser/RecipeLanes/issues/16)
      // await expect(page.getByText(recipeTitle)).toBeVisible();
      await expect(page.getByText("Mock Recipe")).toBeVisible();

      // 4. Handle Dialog
      page.on('dialog', dialog => dialog.accept());

      // 5. Click Delete (hover first to show button)
      // The button appears on hover over the card.
      // We can force click or hover then click.
      
      // TODO(https://github.com/bohemian-miser/RecipeLanes/issues/16)
      // const card = page.locator('div').filter({ hasText: recipeTitle }).last(); // recipe-card outer div
      const card = page.locator('div').filter({ hasText: "Mock Recipe" }).last(); // recipe-card outer div
      await card.hover();
      await screenshot(page, dir, 'hover-card');
      
      const deleteBtn = card.locator('button[title="Delete Recipe"]');
      await expect(deleteBtn).toBeVisible();
      await deleteBtn.click();

      // 6. Verify Deletion
      await screenshot(page, dir, 'deleted');
      await expect(card).not.toBeVisible();
      
      cleanupScreenshots(dir);
    });
  }
});
