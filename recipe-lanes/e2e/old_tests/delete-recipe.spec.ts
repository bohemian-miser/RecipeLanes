/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { test, expect } from '../utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from '../utils/screenshot';
import { deviceConfigs } from '../utils/devices';
import { create_recipe } from '../utils/actions';

test.skip('[OLD] Recipe Deletion', () => {
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
      await create_recipe(page, 'Ingredients for deletion', dir);

      
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