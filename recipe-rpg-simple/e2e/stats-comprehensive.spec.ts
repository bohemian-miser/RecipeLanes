import { test, expect } from '@playwright/test';
import { create_recipe, wait_for_graph, get_node } from './utils/actions';
import { screenshotDir, screenshot, cleanupScreenshots } from './utils/screenshot';

test.describe('Comprehensive Stats & Reroll', () => {
  // Use a unique ingredient prefix for isolation
  const prefix = `StatsCheck${Date.now()}`;

  test('should track stats correctly across multiple rerolls', async ({ page }) => {
    test.slow();
    const dir = screenshotDir('stats-comprehensive', 'desktop');
    const ingredient = `${prefix} Onion`;

    // 1. Create Recipe
    await page.goto('/lanes');
    await create_recipe(page, `chop ${ingredient}`, dir);
    await wait_for_graph(page, dir);
    await screenshot(page, dir, '01-recipe-created');
    
    const node = get_node(page, ingredient);
    await expect(node).toBeVisible();
    await expect(node.locator('img')).toBeVisible({ timeout: 30000 });
    
    // Initial Icon ID/Src
    let currentSrc = await node.locator('img').getAttribute('src');
    expect(currentSrc).toBeTruthy();

    // Helper to check stats in Gallery (New Tab)
    const checkStats = async (name: string, expectedCounts: string[], stepName: string) => {
        const galleryPage = await page.context().newPage();
        await galleryPage.goto('/');
        await galleryPage.getByPlaceholder('Search ingredients...').fill(name);
        await galleryPage.getByPlaceholder('Search ingredients...').press('Enter');
        
        // Wait for results
        const cards = galleryPage.locator('.relative.group').filter({ hasText: name });
        
        // Wait for count to match (poll)
        await expect.poll(async () => {
            return await cards.count();
        }, { timeout: 10000 }).toBe(expectedCounts.length);
        
        // Screenshot Gallery Stats
        await screenshot(galleryPage, dir, `${stepName}-gallery-stats`);
        
        const texts = await cards.allTextContents();
        // Verify each expected count string exists in results
        for (const expected of expectedCounts) {
            const found = texts.some(t => t.includes(expected));
            expect(found, `Stats ${expected} not found in [${texts.join(', ')}]`).toBeTruthy();
        }
        await galleryPage.close();
    };

    // 2. Initial Check: 1 Impression, 0 Rejections (1/0)
    console.log('Checking Initial Stats...');
    await checkStats(ingredient, ['1 / 0'], '02-initial');

    // 3. Reroll 1 (Reject Icon A) -> Get Icon B
    console.log('Reroll 1...');
    const rerollBtn = node.locator('button[title="Reroll Icon"]');
    await node.hover();
    await rerollBtn.click();
    await expect(rerollBtn.locator('svg')).toHaveClass(/animate-spin/);
    await screenshot(page, dir, '03-reroll-1-spinning');
    
    // Wait for update
    await expect.poll(async () => {
        const newSrc = await node.locator('img').getAttribute('src');
        return newSrc;
    }, { timeout: 20000 }).not.toBe(currentSrc);
    
    await screenshot(page, dir, '04-reroll-1-complete');
    currentSrc = await node.locator('img').getAttribute('src');

    // 4. Check Stats: Icon A (1/1), Icon B (1/0)
    console.log('Checking Stats after Reroll 1...');
    await checkStats(ingredient, ['1 / 1', '1 / 0'], '05-stats-after-reroll-1');

    // 5. Reroll 2 (Reject Icon B) -> Get Icon C
    console.log('Reroll 2...');
    await node.hover();
    await rerollBtn.click();
    
    await expect.poll(async () => {
        const newSrc = await node.locator('img').getAttribute('src');
        return newSrc;
    }, { timeout: 20000 }).not.toBe(currentSrc);
    
    await screenshot(page, dir, '06-reroll-2-complete');
    
    // 6. Check Stats: Icon A (1/1), Icon B (1/1), Icon C (1/0)
    console.log('Checking Stats after Reroll 2...');
    await checkStats(ingredient, ['1 / 1', '1 / 1', '1 / 0'], '07-stats-after-reroll-2');

    // 7. Test "Make 1 - refresh - reroll" logic with NEW ingredient
    const ingredient2 = `${prefix} Garlic`;
    console.log(`Creating second recipe with ${ingredient2}...`);
    await page.goto('/lanes?new=true');
    await create_recipe(page, `crush ${ingredient2}`, dir);
    await wait_for_graph(page, dir);
    const node2 = get_node(page, ingredient2);
    await expect(node2.locator('img')).toBeVisible();
    await screenshot(page, dir, '08-recipe-2-created');
    
    // Refresh Page
    console.log('Refreshing page...');
    await page.reload();
    await wait_for_graph(page, dir); // Wait for load
    await screenshot(page, dir, '09-recipe-2-refreshed');
    
    const node2Refreshed = get_node(page, ingredient2);
    await node2Refreshed.hover();
    const rerollBtn2 = node2Refreshed.locator('button[title="Reroll Icon"]');
    
    const startSrc2 = await node2Refreshed.locator('img').getAttribute('src');
    console.log('Reroll 3 (Post-Refresh)...');
    await rerollBtn2.click();
    
    // Wait for update
    await expect.poll(async () => {
        const newSrc = await node2Refreshed.locator('img').getAttribute('src');
        return newSrc;
    }, { timeout: 20000 }).not.toBe(startSrc2);
    await screenshot(page, dir, '10-recipe-2-rerolled');
    
    // Check Stats: Icon A (1/1), Icon B (1/0)
    console.log('Checking Stats for Ingredient 2...');
    await checkStats(ingredient2, ['1 / 1', '1 / 0'], '11-stats-recipe-2');

    cleanupScreenshots(dir);
  });
});
