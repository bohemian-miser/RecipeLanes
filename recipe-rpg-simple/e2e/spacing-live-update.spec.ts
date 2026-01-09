import { test, expect } from './utils/fixtures';
import { create_recipe, wait_for_graph } from './utils/actions';
import { screenshotDir, cleanupScreenshots } from './utils/screenshot';

test.describe('Spacing Live Update', () => {
  test('Spacing slider should update layout immediately', async ({ page }) => {
    test.setTimeout(120000);
    const dir = screenshotDir('spacing-bug', 'desktop');
    cleanupScreenshots(dir);
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto('/lanes?new=true');
    await create_recipe(page, 'test eggs with space', dir);
    await wait_for_graph(page, dir);

    // 1. Get initial position of a node (e.g., the last one)
    const nodeSelector = '.react-flow__node-minimal';
    const lastNode = page.locator(nodeSelector).last();
    const initialBox = await lastNode.boundingBox();
    expect(initialBox).toBeTruthy();

    // 2. Drag a node to ensure we are in "dirty" state (which might be blocking updates)
    // Drag the FIRST node to avoid messing up the last node's reading too much, 
    // or just drag any node.
    const firstNode = page.locator(nodeSelector).first();
    await firstNode.dragTo(page.locator(nodeSelector).nth(1));
    
    // 3. Change Spacing Slider
    // The slider is an input[type="range"]
    const slider = page.locator('input[type="range"]');
    await expect(slider).toBeVisible();
    
    // Current value is .5. Change to 1.
    await slider.fill('1');
    // Trigger change event if needed (fill usually does it for text, for range it might need explicit dispatch)
    await slider.evaluate(e => {
        const event = new Event('change', { bubbles: true });
        e.dispatchEvent(event);
        const input = new Event('input', { bubbles: true });
        e.dispatchEvent(input);
    });

    // 4. Check if position changed
    // Wait for a bit for layout to apply
    await page.waitForTimeout(1000);
    
    const newBox = await lastNode.boundingBox();
    expect(newBox).toBeTruthy();
    
    // Expect significant movement. Spacing 1 -> 2 should spread nodes out.
    // The last node should move down/right significantly.
    // We check Y position difference.
    console.log(`Initial Y: ${initialBox!.y}, New Y: ${newBox!.y}`);
    expect(Math.abs(newBox!.y - initialBox!.y)).toBeGreaterThan(20);

    // 5. Test Undo
    // Undo should revert the layout change (positions)
    // But spacing prop is controlled by parent. Undo in ReactFlow only reverts *nodes* state.
    // If we undo, the nodes move back. BUT the slider is still at 2.
    // So the layout engine might fight back?
    // Let's see what happens.
    
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);
    
    const undoBox = await lastNode.boundingBox();
    console.log(`Undo Y: ${undoBox!.y}`);
    
    // It should be closer to initialBox (before spacing change) OR before drag?
    // If we snapshotted before spacing change, it should revert to state after drag.
    // If we didn't snapshot, it might undo the drag?
    
    // For now, let's just assert "Spacing updates layout" which is the reported bug.
  });
});
