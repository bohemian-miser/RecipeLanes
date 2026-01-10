import { test, expect } from '@playwright/test';
import { create_recipe, wait_for_graph, get_node } from './utils/actions';
import { screenshotDir, cleanupScreenshots } from './utils/screenshot';

test.describe('Stats Tracking', () => {
  test('should track impressions and rejections', async ({ page }) => {
    test.slow();
    const dir = screenshotDir('stats-tracking', 'desktop');
    const uniqueName = `Stats Test ${Date.now()}`;
    
    // 1. Create Recipe
    await page.goto('/lanes');
    await create_recipe(page, `make ${uniqueName}`, dir);
    await wait_for_graph(page, dir);
    
    // 2. Wait for Icon
    // The prompt "make Stats Test <timestamp>" should generate an ingredient node "Stats Test <timestamp>"
    const node = get_node(page, uniqueName);
    await expect(node).toBeVisible();
    await expect(node.locator('img')).toBeVisible({ timeout: 30000 });

    // 3. Check Stats in Gallery (New Tab)
    const galleryPage = await page.context().newPage();
    await galleryPage.goto('/');
    
    // Search for the ingredient
    await galleryPage.getByPlaceholder('Search ingredients...').fill(uniqueName);
    await galleryPage.getByPlaceholder('Search ingredients...').press('Enter');
    
    // Wait for results
    // The gallery card format: Score (top left), Imp/Rej (top left next to score?)
    // In SharedGallery.tsx:
    // <div className="absolute top-1 left-1 ... text-[10px]">
    //   <span className="..."> {score} </span>
    //   <span className="..."> {impressions} / {rejections} </span>
    // </div>
    
    const card = galleryPage.locator('.relative.group').filter({ hasText: uniqueName }).first();
    await expect(card).toBeVisible({ timeout: 10000 });
    
    // Verify Rejections = 0, Impressions = 1 (0/1)
    await expect(card).toContainText('0 / 1');
    console.log('Verified Initial Impression: 0 / 1');

    // 4. Reroll in Recipe (Original Tab)
    await page.bringToFront();
    await node.hover();
    const rerollBtn = node.locator('button[title="Reroll Icon"]');
    await rerollBtn.click();
    
    // Wait for spinner to start and stop (icon change)
    await expect(rerollBtn.locator('svg')).toHaveClass(/animate-spin/);
    await expect(rerollBtn.locator('svg')).not.toHaveClass(/animate-spin/, { timeout: 30000 });
    
    // 5. Verify Stats Updated
    await galleryPage.bringToFront();
    await galleryPage.reload();
    await galleryPage.getByPlaceholder('Search ingredients...').fill(uniqueName);
    
    // We expect TWO cards now? Or one?
    // If we rejected the first one, it's still in the DB.
    // The gallery shows ALL icons for the ingredient.
    
    // Wait for the second card to appear (retry loop via polling)
    const cards = galleryPage.locator('.relative.group').filter({ hasText: uniqueName });
    await expect.poll(async () => {
        await galleryPage.reload(); // Reload to fetch fresh data
        await galleryPage.getByPlaceholder('Search ingredients...').fill(uniqueName);
        await galleryPage.getByPlaceholder('Search ingredients...').press('Enter');
        await galleryPage.waitForTimeout(500); // Wait for render
        return cards.count();
    }, {
        timeout: 10000,
        message: 'Second card did not appear in gallery'
    }).toBe(2);
    
    // Card 1 (Rejected): Should be 1 / 1
    // Card 2 (New): Should be 0 / 1
    
    const cardTexts = await cards.allTextContents();
    console.log('Card Stats:', cardTexts);
    
    const hasRejected = cardTexts.some(t => t.includes('1 / 1'));
    const hasNew = cardTexts.some(t => t.includes('0 / 1'));
    
    expect(hasRejected, 'Should find rejected icon (1/1)').toBeTruthy();
    expect(hasNew, 'Should find new icon (0/1)').toBeTruthy();
    
    cleanupScreenshots(dir);
  });
});
