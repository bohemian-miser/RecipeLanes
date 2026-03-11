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
import { seedCommonIngredients } from '../utils/seed-data';
import { clearFirestore, clearStorage } from '../utils/admin-utils';

test.describe('Optimistic UI & Background Trigger', () => {
  
  test.beforeEach(async () => {
      // Clear DB and Storage to ensure fresh state (no cached icons for "Mix" etc.)
      await clearFirestore();
      await clearStorage();
      
      // Seed Eggs and Flour (Global Setup)
      await seedCommonIngredients();
  });

  for (const device of deviceConfigs) {
    test(`${device.name}: Load graph and populate icons in background`, async ({ page, login }) => {
      const dir = screenshotDir('optimistic-ui', device.name);
      cleanupScreenshots(dir);
        await page.setViewportSize(device.viewport);

        // 1. Login Programmatically
        await page.goto('/lanes?new=true');
        await login('user-optimistic', { displayName: 'Optimistic Chef' });
        await screenshot(page, dir, 'logged-in');

        // 2. Enter Recipe
        const newIngredient = `Ham ${Date.now()}`;
        // Use specific trigger phrase for Mock AI (if MOCK_AI=true) or just text that parses well
        // We use the pattern we set up in the previous step for Mock AI consistency
        const recipeText = `test eggs with ${newIngredient}.`;
        
        const textarea = page.locator('textarea[placeholder="Paste recipe here..."]');
        await textarea.fill(recipeText);
        await screenshot(page, dir, 'recipe-entered');
        
        // 3. Click Visualize
        const visualizeBtn = page.locator('button:has-text("Visualise")').or(page.locator('button:has(.lucide-arrow-right)'));
        await visualizeBtn.click();
        
        await screenshot(page, dir, 'after click');

        // 4. Assert Immediate Graph Load (Optimistic)
        // Wait for graph container
        await expect(page.locator('.react-flow')).toBeVisible({ timeout: 30000 });      await screenshot(page, dir, 'after click2');

        // Force fit view to ensure all nodes are rendered (especially on mobile)
        const fitViewBtn = page.locator('.react-flow__controls-fitview');
        if (await fitViewBtn.isVisible()) {
            await fitViewBtn.click();
            await page.waitForTimeout(500); // Allow animation
        }

        const eggNode = page.locator('.react-flow__node-minimal', { hasText: '2 Eggs' }).or(page.locator('.react-flow__node-minimal', { hasText: 'Egg' })).first();
        const flourNode = page.locator('.react-flow__node-minimal', { hasText: '100g Flour' }).or(page.locator('.react-flow__node-minimal', { hasText: 'Flour' })).first();
        const hamNode = page.locator('.react-flow__node-minimal', { hasText: newIngredient }).first();
        const mixNode = page.locator('.react-flow__node-minimal', { hasText: 'Mix' }).first();

        // Check text presence first
        await expect(eggNode).toBeVisible();
        await expect(flourNode).toBeVisible();
        await expect(hamNode).toBeVisible();
        await expect(mixNode).toBeVisible();
        await screenshot(page, dir, 'before ham check');
        

        // 5. Assert Cached Icons are Present Immediately
        const eggImg = eggNode.locator('img');
        const flourImg = flourNode.locator('img');
        const hamImg = hamNode.locator('img');
        const mixImg = mixNode.locator('img');
        
        // Wait for hydration if needed, but they should be there fast
        await expect(eggImg).toBeVisible();
        console.log('Egg image src:', await eggImg.getAttribute('src'));
        await expect(eggImg).toHaveAttribute('src', /icons%2Fseed-Egg-/);
        
        await expect(flourImg).toBeVisible();
        console.log('Flour image src:', await flourImg.getAttribute('src'));
        await expect(flourImg).toHaveAttribute('src', /icons%2Fseed-Flour-/);
        
        await screenshot(page, dir, 'graph-loaded');
        // 6. Assert New Icons are Missing Initially (Optimistic Cache Miss) OR already arrived (Fast Forge)
        // Ham and Mix should be missing icons initially, rendering placeholders (Emojis)
        // But in emulator it might be instant. We race them.
        const hamPlaceholder = hamNode.locator('span.text-4xl');
        const mixPlaceholder = mixNode.locator('span.text-4xl');

        // Check if either placeholder OR image is visible
        await expect(hamPlaceholder.or(hamImg)).toBeVisible();
        await expect(mixPlaceholder.or(mixImg)).toBeVisible();

        await screenshot(page, dir, 'icons-initial-state');

        // 7. Wait for Background Worker (Listener Update)
        console.log('Waiting for background icon generation...');
        
        // We expect both images to eventually appear with Storage URLs to placeholders
        // It has a 1 second lag to make sure it doesn't load too quickly.
        await page.waitForTimeout(5000);
        await screenshot(page, dir, 'before-ham-visible-check');
        await expect(hamImg).toBeVisible({ timeout: 60000 }); 
        console.log('Ham image src:', await hamImg.getAttribute('src'));
        await expect(hamImg).toHaveAttribute('src', /icons%2FHam-/, { timeout: 1000 });

        await expect(mixImg).toBeVisible({ timeout: 1000 }); 
        console.log('Mix image src:', await mixImg.getAttribute('src'));
        await expect(mixImg).toHaveAttribute('src', /icons%2FMixing.Bowl/, { timeout: 1000 });
        
        await screenshot(page, dir, 'icons-fully-populated');
        
        cleanupScreenshots(dir);
    });
  }
});