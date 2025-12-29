import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots} from './utils/screenshot';
import { deviceConfigs } from './utils/devices';

test.describe('Graph Interaction', () => {
  test.slow();

  for (const device of deviceConfigs) {
    test(`${device.name}: can pan diagram`, async ({ page }) => {
      const dir = screenshotDir('pan-diagram', device.name);

      await page.setViewportSize(device.viewport);
      await page.goto('/lanes');
      await screenshot(page, dir, 'initial-page');

      await page.getByPlaceholder('Paste recipe here...').fill('test eggs');
      await screenshot(page, dir, 'recipe-entered');

      await page.locator('button:has(svg.lucide-arrow-right)').click();
      await screenshot(page, dir, 'create-clicked');

      const viewport = page.locator('.react-flow__viewport');
      await expect(viewport).toBeVisible({ timeout: 30000 });
      await screenshot(page, dir, 'graph-visible');

      const initialTransform = await viewport.getAttribute('style');

      await page.mouse.move(200, 400);
      await page.mouse.down();
      await screenshot(page, dir, 'pan-started');

      await page.mouse.move(200, 200);
      await page.mouse.up();
      await page.waitForTimeout(2000);
      await screenshot(page, dir, 'pan-completed');

      const midTransform = await viewport.getAttribute('style');
      expect(midTransform).not.toBe(initialTransform);

      const box = await viewport.boundingBox();
      expect(box?.height).toBeGreaterThan(500);
      await screenshot(page, dir, 'final-state');
      cleanupScreenshots(dir);
    });

    test(`${device.name}: delete node and undo restores edges`, async ({ page }) => {
      const dir = screenshotDir('delete-node-undo', device.name);

      await page.setViewportSize(device.viewport);
      await page.goto('/lanes');
      await screenshot(page, dir, 'initial-page');

      await page.getByPlaceholder('Paste recipe here...').fill('test eggs');
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      await screenshot(page, dir, 'recipe-created');

      const viewport = page.locator('.react-flow__viewport');
      await expect(viewport).toBeVisible({ timeout: 30000 });
      await screenshot(page, dir, 'graph-visible');

      await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.react-flow__edge').first()).toBeAttached({ timeout: 10000 });
      await screenshot(page, dir, 'nodes-and-edges-loaded');

      const getEdgeCount = () => page.locator('.react-flow__edge').count();
      const initialEdges = await getEdgeCount();
      expect(initialEdges).toBeGreaterThan(0);

      const node = page.locator('.react-flow__node').filter({ hasText: 'Flour' }).first();
      await expect(node).toBeVisible({ timeout: 30000 });
      await screenshot(page, dir, 'target-node-found');

      // Click and hover to reveal delete button
      await node.click();
      await screenshot(page, dir, 'node-selected');

      await node.hover();
      await screenshot(page, dir, 'node-hovered');

      const deleteBtn = node.getByRole('button', { name: /Delete Step/i });
      await expect(deleteBtn).toBeVisible();
      await screenshot(page, dir, 'delete-button-visible');

      // More robust delete: wait for button to be ready, then click with retries
      await deleteBtn.waitFor({ state: 'visible' });
      await expect(deleteBtn).toBeEnabled();
      
      // Try clicking and verify it worked
      let deleted = false;
      for (let attempt = 0; attempt < 3 && !deleted; attempt++) {
        await screenshot(page, dir, `delete-attempt-${attempt + 1}`);
        
        // Re-hover to ensure button is still visible (especially on mobile)
        await node.hover();
        await page.waitForTimeout(200);
        
        await deleteBtn.click({ force: true });
        await page.waitForTimeout(1000);
        
        // Check if node is gone
        deleted = !(await node.isVisible());
      }
      
      await screenshot(page, dir, 'after-delete-attempts');

      await expect(node).not.toBeVisible({ timeout: 10000 });
      await screenshot(page, dir, 'node-deleted');

      const deletedEdges = await getEdgeCount();
      expect(deletedEdges).toBeLessThan(initialEdges);

      const undoBtn = page.locator('button[title="Undo (Ctrl+Z)"]');
      await undoBtn.click();
      await screenshot(page, dir, 'undo-clicked');

      await expect(node).toBeVisible();
      await screenshot(page, dir, 'node-restored');

      await page.waitForTimeout(2000);
      await screenshot(page, dir, 'final-state');

      const restoredEdges = await getEdgeCount();
      expect(restoredEdges).toBe(initialEdges);
      cleanupScreenshots(dir);
    });
    test(`${device.name}: delete common node with undo and redo`, async ({ page }) => {
      const dir = screenshotDir('delete-common-node-undo-redo', device.name);

      await page.setViewportSize(device.viewport);
      await page.goto('/lanes');
      await screenshot(page, dir, 'initial-page');

      // Create complex graph with diamond pattern
      await page.getByPlaceholder('Paste recipe here...').fill('test complex');
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      await screenshot(page, dir, 'recipe-created');

      const viewport = page.locator('.react-flow__viewport');
      await expect(viewport).toBeVisible({ timeout: 30000 });
      await screenshot(page, dir, 'graph-visible');

      await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.react-flow__edge').first()).toBeAttached({ timeout: 10000 });
      await screenshot(page, dir, 'nodes-and-edges-loaded');

      const getEdgeCount = () => page.locator('.react-flow__edge').count();
      const getNodeCount = () => page.locator('.react-flow__node').count();

      const initialEdges = await getEdgeCount();
      const initialNodes = await getNodeCount();
      
      // Complex graph should have 9 nodes and 9 edges
      expect(initialNodes).toBe(9);
      expect(initialEdges).toBe(9);
      await screenshot(page, dir, 'initial-counts-verified');

      // Find the common node "Combine (Common)"
      const commonNode = page.locator('.react-flow__node').filter({ hasText: 'Combine (Common)' }).first();
      await expect(commonNode).toBeVisible({ timeout: 30000 });
      await screenshot(page, dir, 'common-node-found');

      // Helper function to delete node with retry logic
      const deleteNode = async (node: typeof commonNode, attemptPrefix: string) => {
        await node.click();
        await node.hover();

        const deleteBtn = node.getByRole('button', { name: /Delete Step/i });
        await expect(deleteBtn).toBeVisible();
        await deleteBtn.waitFor({ state: 'visible' });
        await expect(deleteBtn).toBeEnabled();

        let deleted = false;
        for (let attempt = 0; attempt < 3 && !deleted; attempt++) {
          await screenshot(page, dir, `${attemptPrefix}-attempt-${attempt + 1}`);
          await node.hover();
          await page.waitForTimeout(200);
          await deleteBtn.click({ force: true });
          await page.waitForTimeout(1000);
          deleted = !(await node.isVisible());
        }
      };

      // Delete the common node
      await deleteNode(commonNode, 'delete');
      await screenshot(page, dir, 'after-delete');

      // Verify common node is gone
      await expect(commonNode).not.toBeVisible({ timeout: 10000 });
      await screenshot(page, dir, 'node-deleted');

      // Verify node count decreased
      const nodesAfterDelete = await getNodeCount();
      expect(nodesAfterDelete).toBe(initialNodes - 1);

      // Verify edges stayed the same (common node had 2 in, 2 out, now each of the in's needs to be doubled so -2+2 = 0)
      const edgesAfterDelete = await getEdgeCount();
      expect(edgesAfterDelete).toBe(initialEdges);
      await screenshot(page, dir, 'edges-after-delete');

      // --- UNDO ---
      const undoBtn = page.getByRole('button', { name: /Undo/i });
      await undoBtn.click();
      await screenshot(page, dir, 'undo-clicked');

      // Verify common node is restored
      await expect(commonNode).toBeVisible({ timeout: 10000 });
      await screenshot(page, dir, 'node-restored');

      // Verify node count restored (using retry assertion)
      await expect(page.locator('.react-flow__node')).toHaveCount(initialNodes);

      // Verify edge count restored
      await expect(page.locator('.react-flow__edge')).toHaveCount(initialEdges);
      await screenshot(page, dir, 'edges-restored');

      // Verify specific edges are back by checking connections
      // The common node should have edges from "Process A" and "Process B"
      const processANode = page.locator('.react-flow__node').filter({ hasText: 'Process A' }).first();
      const processBNode = page.locator('.react-flow__node').filter({ hasText: 'Process B' }).first();
      await expect(processANode).toBeVisible();
      await expect(processBNode).toBeVisible();

      // Check downstream nodes are connected
      const finalFNode = page.locator('.react-flow__node').filter({ hasText: 'Final Step F' }).first();
      const finalGNode = page.locator('.react-flow__node').filter({ hasText: 'Final Step G' }).first();
      await expect(finalFNode).toBeVisible();
      await expect(finalGNode).toBeVisible();
      await screenshot(page, dir, 'all-nodes-verified');

      // --- REDO ---
      const redoBtn = page.getByRole('button', { name: /Redo/i });
      await redoBtn.click();
      await screenshot(page, dir, 'redo-clicked');

      // Verify common node is deleted again
      await expect(commonNode).not.toBeVisible({ timeout: 10000 });
      await screenshot(page, dir, 'node-deleted-again');

      // Verify node count decreased again (using retry assertion)
      await expect(page.locator('.react-flow__node')).toHaveCount(initialNodes - 1);

      // Verify edge count decreased again
      await expect(page.locator('.react-flow__edge')).toHaveCount(initialEdges); // Edges stay same count because of reconnection logic?
      // Wait, in previous code: expect(edgesAfterRedo).toBe(edgesAfterDelete);
      // edgesAfterDelete was expect(edgesAfterDelete).toBe(initialEdges);
      // So edges count should be initialEdges.
      
      await screenshot(page, dir, 'edges-after-redo');

      // --- UNDO again to leave graph in original state ---
      await undoBtn.click();
      await expect(commonNode).toBeVisible({ timeout: 10000 });
      
      await expect(page.locator('.react-flow__node')).toHaveCount(initialNodes);
      await expect(page.locator('.react-flow__edge')).toHaveCount(initialEdges);
      await screenshot(page, dir, 'final-state-restored');
      cleanupScreenshots(dir);
    });
  }
});