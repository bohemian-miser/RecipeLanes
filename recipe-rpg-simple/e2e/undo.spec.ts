import { test, expect } from '@playwright/test';

test.describe.skip('Undo/Redo Functionality', () => {
  test.skip('should undo and redo node movement', async ({ page }) => {
    await page.goto('/lanes');
    await page.getByPlaceholder('Paste recipe here...').fill('Boil water');
    await page.locator('button:has(svg)').nth(0).click(); // Visualize
    
    // Wait for graph
    const node = page.locator('.react-flow__node-minimal').first();
    await expect(node).toBeVisible({ timeout: 15000 });
    
    const initialBox = await node.boundingBox();
    if (!initialBox) throw new Error("Node not found");

    // Drag node
    await node.dragTo(page.locator('.react-flow__pane'), { targetPosition: { x: 300, y: 300 } });
    
    // Wait for update
    await page.waitForTimeout(500);
    const newBox = await node.boundingBox();
    expect(newBox?.x).not.toBeCloseTo(initialBox.x, 1);

    // Undo (Ctrl+Z)
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);
    const undoBox = await node.boundingBox();
    expect(undoBox?.x).toBeCloseTo(initialBox.x, 0); 
    
    // Redo (Ctrl+Y or Ctrl+Shift+Z)
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(500);
    const redoBox = await node.boundingBox();
    expect(redoBox?.x).toBeCloseTo(newBox!.x, 0);
  });

  test('should undo node deletion and restore edges', async ({ page }) => {
    await page.goto('/lanes');
    // A -> B recipe to test edges
    await page.getByPlaceholder('Paste recipe here...').fill('Chop onion. Fry onion.');
    await page.locator('button:has(svg)').nth(0).click();
    
    // Wait for ANY node first
    await expect(page.locator('.react-flow__node-minimal').first()).toBeVisible({ timeout: 20000 });
    
    // Expect 3 nodes
    await expect(page.locator('.react-flow__node-minimal')).toHaveCount(3, { timeout: 15000 });
    
    // Find middle node (Chop)
    // We can filter by text content if we want, but let's just delete the second node in DOM order (likely middle).
    // Better: Find node with text 'Chop'.
    const chopNode = page.locator('.react-flow__node-minimal', { hasText: /Chop/i }).first();
    await expect(chopNode).toBeVisible();

    // Hover to show delete button
    await chopNode.hover();
    // Click X button (absolute -top-2 -left-2)
    // It's the button with <X /> icon.
    await chopNode.locator('button').filter({ has: page.locator('svg') }).nth(1).click(); // 0 is Reroll, 1 is Delete? Or check titles.
    // Title "Delete Step..."
    await chopNode.getByTitle('Delete Step (Connect Parents to Children)').click();

    await expect(chopNode).toBeHidden();
    await expect(page.locator('.react-flow__node-minimal')).toHaveCount(2);
    
    // Undo
    await page.keyboard.press('Control+z');
    await expect(chopNode).toBeVisible();
    await expect(page.locator('.react-flow__node-minimal')).toHaveCount(3);
    
    // Verify Edges
    // We can't easily check React Flow edges DOM without inspecting SVG structure.
    // But if node is back, edges should be restored if state was restored correctly.
    // We can check if "edges" count is correct.
    // .react-flow__edge
    await expect(page.locator('.react-flow__edge')).toHaveCount(2, { timeout: 15000 }); // 1->2, 2->3
  });
});
