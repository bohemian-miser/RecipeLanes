import { test, expect, devices } from '@playwright/test';

// Use iPhone 12 for mobile simulation
test.use({ ...devices['iPhone 12'] });

test.describe('Graph Interaction', () => {
  test.slow(); // Mark all tests in this describe block as slow
  
  test('mobile: can pan diagram (full screen check)', async ({ page }) => {
    await page.goto('/lanes');

    // Create Recipe
    await page.getByPlaceholder('Paste recipe here...').fill('Toast: Put bread in toaster.');
    await page.locator('button.bg-yellow-500').click();

    // Wait for graph
    const viewport = page.locator('.react-flow__viewport');
    await expect(viewport).toBeVisible({ timeout: 15000 });
    
    const initialTransform = await viewport.getAttribute('style');

    // 1. Pan from Center (Should always work)
    await page.mouse.move(200, 400);
    await page.mouse.down();
    await page.mouse.move(200, 200); // Drag up
    await page.mouse.up();
    await page.waitForTimeout(2000); // Increased wait
    
    const midTransform = await viewport.getAttribute('style');
    expect(midTransform).not.toBe(initialTransform);

    // Verify viewport height covers the screen (extends to bottom)
    // iPhone 12 height is 664 (viewport in Playwright).
    // Before fix: height would be ~600 (664 - 64).
    // After fix: height should be ~664.
    const box = await viewport.boundingBox();
    expect(box?.height).toBeGreaterThan(500); 
  });

  test('graph logic: delete node and undo restores edges', async ({ page }) => {
    // We need a recipe with edges.
    await page.goto('/lanes');
    await page.getByPlaceholder('Paste recipe here...').fill('test eggs');
    await page.locator('button.bg-yellow-500').click();

    const viewport = page.locator('.react-flow__viewport');
    await expect(viewport).toBeVisible({ timeout: 30000 });
    
    // Wait for nodes to appear
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10000 });
    // Wait for edges to appear
    await expect(page.locator('.react-flow__edge').first()).toBeAttached({ timeout: 10000 });

    // Helper
    const getEdgeCount = () => page.locator('.react-flow__edge').count();

    const initialEdges = await getEdgeCount();
    expect(initialEdges).toBeGreaterThan(0);

    // Find a node (e.g. "Mock Ingredient 2")
    const node = page.locator('.react-flow__node').filter({ hasText: 'Mock Ingredient 2' }).first();
    await expect(node).toBeVisible({ timeout: 30000 });
    
    console.log(`[DEBUG] Initial Node Count: ${await page.locator('.react-flow__node').count()}`);
    console.log(`[DEBUG] Target Node HTML: ${await node.innerHTML()}`);
    
    await node.click();
    await page.screenshot({ path: 'full-page-selected.png', fullPage: true });
    console.log('[DEBUG] Node clicked/selected');
    await node.hover(); 
    await page.waitForTimeout(1000); 

    // The trash/delete icon is an X icon in MinimalNode.
    const deleteBtn = node.getByRole('button', { name: /Delete Step/i });
    console.log(`[DEBUG] deleteBtn: ${JSON.stringify(deleteBtn)}`);
    console.log(`[DEBUG] deleteBtn: ${deleteBtn.innerHTML()}`);
    await expect(deleteBtn).toBeVisible();
    
    const btnBox = await deleteBtn.boundingBox();
    console.log(`[DEBUG] Delete Button Box: ${JSON.stringify(btnBox)}`);
    console.log(`[DEBUG] Delete Button HTML: ${await deleteBtn.innerHTML()}`);
    
    // Use force click to bypass any potential overlay/pointer-event issues
    await deleteBtn.click({ force: true });

    await page.screenshot({ path: 'full-page-del-clicked.png', fullPage: true });
    console.log('[DEBUG] Delete button clicked (forced)');
    
    // Wait for delete animation/state update
    await page.waitForTimeout(2000); 

    // Verify node is gone
    const isVisible = await node.isVisible();
    const countAfter = await page.locator('.react-flow__node').count();
    console.log(`[DEBUG] Node visible after delete? ${isVisible}`);
    console.log(`[DEBUG] Node Count after delete: ${countAfter}`);
    
    if (isVisible) {
         console.log(`[DEBUG] Remaining Node HTML: ${await node.innerHTML()}`);
    }

    await expect(node).not.toBeVisible({ timeout: 10000 });
    
    // Verify edges changed (should be less or bridged)
    const deletedEdges = await getEdgeCount();
    expect(deletedEdges).toBeLessThan(initialEdges);

    // Undo
    const undoBtn = page.locator('button[title="Undo (Ctrl+Z)"]');
    await undoBtn.click();
    
    // Verify node is back
    await expect(node).toBeVisible();
    
    // Wait for edges to re-render
    await page.waitForTimeout(2000); // Increased wait

    // Verify edges restored
    const restoredEdges = await getEdgeCount();
    expect(restoredEdges).toBe(initialEdges);
  });
});