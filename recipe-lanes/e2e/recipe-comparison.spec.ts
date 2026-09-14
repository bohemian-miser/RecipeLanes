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

// Gallery multi-recipe comparison table: signed-in users tick recipes and get
// an ingredient table (recipes as columns, ingredients as rows, totals on the
// right) that can be rearranged by drag-and-drop or the arrow keys. Guests
// never see the tick boxes.

import { test, expect } from './utils/fixtures';
import { create_recipe, wait_for_graph, goto_with_retry } from './utils/actions';

test.describe('Gallery: multi-recipe comparison table', () => {

  test('signed-in user compares two recipes, reorders rows and columns, guest sees no toggles', async ({ page, login, browser }) => {
    test.slow();
    const uid = `compare-user-${Date.now()}`;

    // 1. Two recipes with overlapping ingredients. The mock parser turns
    //    "test eggs" into "2 Eggs" + "100g Flour"; the "with butter" variant
    //    adds an unquantified "butter" line.
    await page.goto('/lanes?new=true');
    await login(uid);
    await create_recipe(page, 'test eggs');
    await wait_for_graph(page);
    const idA = new URL(page.url()).searchParams.get('id')!;

    await page.goto('/lanes?new=true');
    await create_recipe(page, 'test eggs with butter');
    await wait_for_graph(page);
    const idB = new URL(page.url()).searchParams.get('id')!;
    expect(idB).not.toBe(idA);

    // 2. Nothing is compared until a card is ticked.
    await goto_with_retry(page, '/gallery?filter=mine');
    const cardA = page.locator(`a[href="/lanes?id=${idA}"]`);
    const cardB = page.locator(`a[href="/lanes?id=${idB}"]`);
    await expect(cardA).toBeVisible();
    await expect(cardB).toBeVisible();
    await expect(page.getByTestId('recipe-comparison')).toHaveCount(0);

    // 3. Tick both cards — the table appears at the top with one column each.
    //    The tick is a labelled pill that is visible without hovering (touch
    //    has no hover), and flips its label once ticked.
    const toggleA = cardA.getByTestId('compare-toggle');
    await expect(toggleA).toBeVisible();
    await expect(toggleA).toHaveCSS('opacity', '1');
    await expect(toggleA).toHaveText(/Compare$/);
    await toggleA.click();
    await expect(toggleA).toHaveText(/Comparing/);
    const section = page.getByTestId('recipe-comparison');
    await expect(section).toBeVisible();
    await expect(section).toContainText('Comparing 1 recipe');
    await expect(cardA.locator('[data-testid="recipe-card"]')).toHaveAttribute('data-compared', 'true');
    // Ticking never navigates into the recipe.
    await expect(page).toHaveURL(/\/gallery/);

    await cardB.hover();
    await cardB.getByTestId('compare-toggle').click();
    await expect(section).toContainText('Comparing 2 recipes');

    const table = page.getByTestId('recipe-comparison-table');
    // The recipe header row floats above the rows while the table scrolls.
    await expect(table.getByTestId('comparison-header')).toHaveCSS('position', 'sticky');
    const columns = table.getByTestId('comparison-column');
    const rows = table.getByTestId('comparison-row');
    await expect(columns).toHaveCount(2);
    await expect(columns.nth(0)).toHaveAttribute('data-recipe-id', idA);
    await expect(columns.nth(1)).toHaveAttribute('data-recipe-id', idB);

    // Rows follow first-seen order across the selected recipes.
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Eggs');
    await expect(rows.nth(1)).toContainText('Flour');
    await expect(rows.nth(2)).toContainText('Butter');

    // 4. Quantities per column and totals on the right.
    const eggsRow = rows.filter({ hasText: 'Eggs' });
    await expect(eggsRow.locator('td').nth(0)).toHaveText('2');
    await expect(eggsRow.locator('td').nth(1)).toHaveText('2');
    await expect(eggsRow.getByTestId('comparison-total')).toContainText('4');

    const flourRow = rows.filter({ hasText: 'Flour' });
    await expect(flourRow).toContainText('g');
    await expect(flourRow.getByTestId('comparison-total')).toContainText('200');

    const butterRow = rows.filter({ hasText: 'Butter' });
    await expect(butterRow.locator('td').nth(0)).toHaveText('—');
    await expect(butterRow.locator('td').nth(1)).toHaveText('✓');
    await expect(butterRow.getByTestId('comparison-total')).toHaveText('✓');

    // 5. Rows reorder — by drag-and-drop and by keyboard on the grip.
    await rows.nth(2).dragTo(rows.nth(0));
    await expect(rows.nth(0)).toContainText('Butter');
    await expect(rows.nth(1)).toContainText('Eggs');

    await rows.nth(0).getByRole('button', { name: /Move row/ }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(0)).toContainText('Eggs');
    await expect(rows.nth(1)).toContainText('Butter');

    // 6. Columns reorder the same two ways.
    await columns.nth(1).dragTo(columns.nth(0));
    await expect(columns.nth(0)).toHaveAttribute('data-recipe-id', idB);
    await expect(columns.nth(1)).toHaveAttribute('data-recipe-id', idA);

    await columns.nth(0).getByRole('button', { name: /Move column/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(columns.nth(0)).toHaveAttribute('data-recipe-id', idA);
    await expect(columns.nth(1)).toHaveAttribute('data-recipe-id', idB);

    // The cell values travel with their column.
    await expect(eggsRow.getByTestId('comparison-total')).toContainText('4');

    // 7. The selection survives switching gallery tabs (server re-render).
    await goto_with_retry(page, '/gallery?filter=starred');
    await expect(page.getByTestId('recipe-comparison')).toContainText('Comparing 2 recipes');

    // 8. Removing a column from its header, then clearing everything.
    await page.getByTestId('recipe-comparison').getByRole('button', { name: /Remove .* from comparison/ }).first().click();
    await expect(page.getByTestId('recipe-comparison')).toContainText('Comparing 1 recipe');
    await page.getByTestId('recipe-comparison').getByRole('button', { name: 'Clear all' }).click();
    await expect(page.getByTestId('recipe-comparison')).toHaveCount(0);

    // 9. Guests: the card exists in the public gallery but carries no tick box
    //    and the page shows no comparison section.
    const { publishRecipe } = await import('./utils/admin-utils');
    await publishRecipe(idA);
    const guest = await browser.newPage();
    try {
      await goto_with_retry(guest, '/gallery');
      const publicCard = guest.locator(`a[href="/lanes?id=${idA}"]`);
      await expect(publicCard).toBeVisible({ timeout: 15000 });
      await expect(publicCard.getByTestId('compare-toggle')).toHaveCount(0);
      await expect(guest.getByTestId('compare-toggle')).toHaveCount(0);
      await expect(guest.getByTestId('recipe-comparison')).toHaveCount(0);
    } finally {
      await guest.close();
    }
  });
});
