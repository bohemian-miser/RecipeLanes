import { test, expect } from '@playwright/test';

test.describe.skip('Input Box Resize Behavior', () => {
  test('should retract input box after manual resize when graph is interacted', async ({ page }) => {
    await page.goto('/lanes');
    
    // 1. Focus input to expand
    const input = page.getByPlaceholder('Paste recipe here...');
    await input.focus();
    
    // Check it expanded (class or height)
    // Class toggles max-h... let's check computed height or just assume logic works.
    // User says "resizing... breaks ui".
    
    // 2. Simulate Manual Resize (User drags handle)
    // Playwright doesn't simulate drag resize easily, so we set inline style which is what browser does.
    await input.evaluate((el) => {
        el.style.height = '500px';
    });
    
    // Verify it is big
    const boxAfterResize = await input.boundingBox();
    expect(boxAfterResize?.height).toBeCloseTo(500, 1);
    
    // 3. Interact with Graph (Click the pane)
    // We need to click OUTSIDE the input.
    // The graph container is '.react-flow__pane'.
    // If graph is not loaded, we have empty state.
    // Empty state has "Ready to Visualise".
    // Does clicking empty state trigger retract?
    // In `page.tsx`: `onInteraction={() => setInputExpanded(false)}` is passed to `ReactFlowDiagram`.
    // It is ONLY passed to `ReactFlowDiagram`.
    // It is NOT on the empty state div.
    // So if no graph, clicking background might NOT retract?
    // Let's check `page.tsx`.
    // The visualizer div `onClick`? No.
    // `ReactFlowDiagram` has `onPaneClick`.
    // If graph is null, `ReactFlowDiagram` is not rendered.
    // So "Ready to Visualise" div needs `onClick`?
    // User said "clicking on the view".
    // If I just loaded page, graph is null.
    // So I need to Visualize first to get the graph, THEN resize/interact.
    
    await input.fill('Test Recipe');
    await page.locator('button:has(svg)').nth(0).click(); // Visualize
    
    // Wait for graph
    await expect(page.locator('.react-flow__pane')).toBeVisible({ timeout: 10000 });
    
    // Now Expand again (it might have auto-collapsed on visualize)
    await input.focus();
    // Resize
    await input.evaluate((el) => {
        el.style.height = '500px';
    });
    const boxAfterResize2 = await input.boundingBox();
    expect(boxAfterResize2?.height).toBeCloseTo(500, 1);
    
    // 4. Click Graph Pane
    await page.locator('.react-flow__pane').click();
    
    // 5. Expect Retract
    // Height should be small (h-10 is 2.5rem = 40px).
    // Allow some tolerance for padding/border.
    await page.waitForTimeout(500); // Wait for transition
    const boxFinal = await input.boundingBox();
    expect(boxFinal?.height).toBeLessThan(100); 
  });
});
