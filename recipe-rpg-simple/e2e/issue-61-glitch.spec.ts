import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { create_recipe, wait_for_graph, get_node, move_node } from './utils/actions';

test.describe('Issue 61: Glitchy Edits', () => {
  test.skip('Local node move persists against background update', async ({ page, browser, login }) => {
    const dir = screenshotDir('issue-61-glitch', 'desktop');
    
    // 1. Create Recipe as User A
    await page.goto('/lanes?new=true');
    await login('user-a');
    await create_recipe(page, 'test eggs with ham', dir);
    await expect(page).toHaveURL(/id=/);
    
    const recipeId = new URL(page.url()).searchParams.get('id');
    console.log('Recipe ID:', recipeId);
    
    // Wait for graph
    await wait_for_graph(page, dir);
    
    // 2. Move Node "Egg" locally (User A)
    // We drag the node.
    const node = get_node(page, '1 Egg');
    const box = await node.boundingBox();
    if (!box) throw new Error('Node not found');
    
    await move_node(page, '1 Egg', 300, 300, dir);
    
    await screenshot(page, dir, '01-moved-locally');
    
    // 3. Simulate Background Update (User B / System)
    // We use a separate context to avoid local state sharing
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    
    // Login as same user or different? If owner, same.
    // If we use 'user-a', we can update via UI or API.
    // Let's use API to be precise about sending OLD graph data.
    // We can't easily access Server Actions from here without UI.
    // But we can use the `saveRecipeAction` if we expose it? No.
    
    // Alternative: Use the same page's console to call a server action?
    // No, that updates local state too.
    
    // We can use a raw fetch to /api/...? We don't have a generic save API.
    // We have `createVisualRecipeAction` which calls `saveRecipe`.
    
    // Let's use pageB to load the same recipe, NOT move the node, change title, and save.
    // This will save the OLD position (0,0) to the DB.
    
    await pageB.goto(`/lanes?id=${recipeId}`);
    // Wait for load
    await expect(pageB.locator('.react-flow__node').first()).toBeVisible();
    
    // Change Title on Page B
    await pageB.locator('header h1').click();
    await pageB.locator('header input').fill('Background Update Title');
    await pageB.keyboard.press('Enter');
    
    // Wait for save on Page B (Notification or just wait)
    // Issue 16 fix added notification "Title saved." (if owner)
    // We need to login on Page B?
    // Fixture login uses 'user-a'. We can reuse cookie?
    const cookies = await page.context().cookies();
    await contextB.addCookies(cookies);
    
    await pageB.reload(); // Reload to pick up auth
    await pageB.locator('header h1').click();
    await pageB.locator('header input').fill('Background Update Title');
    await pageB.keyboard.press('Enter');
    
    // Wait for save
    await pageB.waitForTimeout(2000); 
    
    await contextB.close();
    
    // 4. Verify User A
    // User A should see the new title (via Snapshot)
    await expect(page.locator('header h1')).toHaveText('Background Update Title');
    
    // AND User A should STILL have the node at the new position (300, 300 offset)
    // If glitch occurs, it snapped back to original.
    
    const nodeAfter = get_node(page, '1 Egg');
    const boxAfter = await nodeAfter.boundingBox();
    
    // Original was roughly at box.x. Moved +300.
    // If boxAfter.x is close to box.x, it reset.
    // If boxAfter.x is close to box.x + 300, it persisted.
    
    console.log('Original X:', box.x);
    console.log('After Update X:', boxAfter?.x);
    
    expect(boxAfter?.x).toBeGreaterThan(box.x + 200);
    
    await screenshot(page, dir, '02-after-background-update');
    cleanupScreenshots(dir);
  });
});
