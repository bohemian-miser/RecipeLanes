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
import { create_recipe, wait_for_graph } from '../utils/actions';
import { promoteToAdmin } from '../utils/admin-utils';
import { vetRecipeAction } from '../../app/actions';

test.describe('Recipe Vetting', () => {
  
  test('unvetted recipes are hidden from public gallery until approved', async ({ page, login }) => {
    const dir = screenshotDir('vetting-flow', 'desktop');
    cleanupScreenshots(dir);

    // 1. User Creates Public Recipe
    await page.goto('/lanes?new=true');
    await login('user-creator');
    
    const uniqueTitle = `Vetting Test ${Date.now()}`;
    await create_recipe(page, `make ${uniqueTitle}`, dir);
    
    // Debug: Check URL
    await expect(page).toHaveURL(/id=/, { timeout: 20000 });
    const url = page.url();
    console.log(`Navigated to: ${url}`);
    
    await wait_for_graph(page, dir);
    
    // Set to Public
    await page.getByTitle('Toggle Visibility').click();
    // Wait for "Public" state (icon change or text)
    await expect(page.locator('button', { hasText: 'Public' })).toBeVisible();
    await page.waitForTimeout(1000); // Save
    
    const recipeUrl = page.url();
    const recipeId = new URL(recipeUrl).searchParams.get('id');
    console.log(`Created Recipe: ${recipeId}`);

    // 2. Verify Hidden in Public Gallery (as Guest or User)
    // Logout first
    await page.getByTitle('Logout').click();
    
    await page.goto('/gallery');
    await page.getByPlaceholder('Search recipes...').fill(uniqueTitle);
    await page.getByPlaceholder('Search recipes...').press('Enter');
    
    await expect(page.locator(`a[href="/lanes?id=${recipeId}"]`)).not.toBeVisible();
    
    await screenshot(page, dir, 'not-visible-unvetted');

    // 3. Admin Approves Recipe
    const { getFirestore } = require('firebase-admin/firestore');
    const db = getFirestore();
    await db.collection('recipes').doc(recipeId).update({ isVetted: true });
    console.log(`Manually vetted recipe ${recipeId}`);

    // 4. Verify Visible in Public Gallery
    await page.reload();
    await page.getByPlaceholder('Search recipes...').fill(uniqueTitle);
    await page.getByPlaceholder('Search recipes...').press('Enter');
    
    await expect(page.locator(`a[href="/lanes?id=${recipeId}"]`)).toBeVisible({ timeout: 10000 });
    await screenshot(page, dir, 'visible-vetted');
  });

  test('admin can view and approve unvetted recipes via UI', async ({ page, login }) => {
    const dir = screenshotDir('vetting-ui', 'desktop');
    cleanupScreenshots(dir);

    // 1. Create Unvetted Public Recipe (as normal user)
    await page.goto('/lanes?new=true');
    await login('user-submitter');
    
    const title = `Submission ${Date.now()}`;
    await create_recipe(page, `make ${title}`, dir);
    await wait_for_graph(page, dir);
    
    // Make Public
    await page.getByTitle('Toggle Visibility').click();
    await expect(page.locator('button', { hasText: 'Public' })).toBeVisible();
    await page.waitForTimeout(1000); 

    const url = page.url();
    const recipeId = new URL(url).searchParams.get('id');
    console.log(`Submitted Recipe: ${recipeId}`);

    // 2. Login as Admin
    await page.getByTitle('Logout').click();
    await login('admin-user');
    const { promoteToAdmin } = require('../utils/admin-utils');
    await promoteToAdmin('admin-user'); // Ensure admin privileges

    // 3. Go to Unvetted Tab
    await page.goto('/gallery?filter=unvetted');
    await screenshot(page, dir, 'unvetted-tab');
    
    // Verify recipe is present
    // Note: Link locator is robust
    const cardLink = page.locator(`a[href="/lanes?id=${recipeId}"]`);
    await expect(cardLink).toBeVisible();

    // 4. Approve via UI
    // The card should have a Vet button (Green Check) because we are admin
    // We need to hover the card to see the button? 
    // RecipeCard actions are absolute top-right, visible on hover (md) or always (touch).
    // In desktop view, we need hover.
    
    // Locate the card container (parent of link)
    // Actually the Link IS the card container in RecipeCard component.
    await cardLink.hover();
    await screenshot(page, dir, 'card-hovered');

    const vetBtn = page.locator(`button[title="Approve (Vet) Recipe"]`).filter({ has: page.locator('xpath=..').filter({ has: page.locator(`a[href="/lanes?id=${recipeId}"]`) }) }).first();
    // Simplified locator: The button is inside the card.
    // But button is sibling to other buttons in overlay.
    // It's inside the Link? No, `Link` wraps the `div`. 
    // Wait, `RecipeCard` returns `<Link ...> <div ...> ... <div className="absolute ..."> <button ...>`.
    // So the button is INSIDE the Link anchor?
    // HTML5 allows interactive content inside `a`? No, it's invalid HTML but React/Next might render it. 
    // Browsers might handle it by nesting or breaking it.
    // Let's check `RecipeCard.tsx`.
    // Yes: `<Link ...> <div ...> <div absolute actions> <button ...>`.
    // This is technically invalid HTML (button inside anchor).
    // Playwright might struggle clicking it if the anchor intercepts.
    // Typically one should use `e.preventDefault()` on the button (which I did in `RecipeCard`).
    
    // Let's locate the button inside the specific card.
    // cardLink is the `a` tag.
    const specificVetBtn = cardLink.locator('button[title="Approve (Vet) Recipe"]');
    await expect(specificVetBtn).toBeVisible();
    
    await specificVetBtn.click();
    
    // 5. Verify it disappears from Unvetted list
    // UI logic: "isVetted" state changes to true, so "!isVetted" becomes false.
    // BUT the list is fetched from server. Does it auto-refresh?
    // In `handleVet` I added `router.refresh()`.
    // This should trigger a re-fetch of the server component.
    // Since `getUnvettedRecipes` filters out vetted ones, it should disappear.
    
    await expect(cardLink).not.toBeVisible({ timeout: 15000 });
    await screenshot(page, dir, 'removed-from-unvetted');
    
    // 6. Verify it appears in Public list
    await page.goto('/gallery');
    await expect(cardLink).toBeVisible();
    await screenshot(page, dir, 'visible-in-public');
  });
});