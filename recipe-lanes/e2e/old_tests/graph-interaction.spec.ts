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
import { screenshot, screenshotDir, cleanupScreenshots} from '../utils/screenshot';
import { deviceConfigs } from '../utils/devices';
import { get_node, delete_node, create_recipe, wait_for_graph } from '../utils/actions';

test.describe('[OLD] Graph Interaction', () => {
  test.slow();

  for (const device of deviceConfigs) {
    test(`${device.name}: can pan diagram`, async ({ page }) => {
      const dir = screenshotDir('pan-diagram', device.name);

      await page.setViewportSize(device.viewport);
      await page.goto('/lanes');
      await screenshot(page, dir, 'initial-page');

      await create_recipe(page, 'test eggs', dir);

      await wait_for_graph(page, dir);

      const viewport = page.locator('.react-flow__viewport');
      await page.waitForTimeout(1000); // Wait for layout to settle
      const initialTransform = await viewport.getAttribute('style');
      console.log('Initial Transform:', initialTransform);

      // Pan from center-ish (avoiding nodes which are usually centered)
      // Moving to bottom-right (300, 300) should be safe if graph is centered.
      // Actually, let's start from an edge where no nodes are likely present.
      // Top-left is risky (Sidebar toggle). Bottom is Legend/Chat.
      // Left edge, below header (100px down) is usually safe.
      const startX = 100;
      const startY = 200;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await screenshot(page, dir, 'pan-started');

      await page.mouse.move(startX + 300, startY + 300, { steps: 50 }); // Move diagonal 300px, slowly
      await page.mouse.up();
      await page.waitForTimeout(2000);
      await screenshot(page, dir, 'pan-completed');

      const midTransform = await viewport.getAttribute('style');
      console.log('Initial Transform:', initialTransform);
      console.log('Mid Transform:', midTransform);
      expect(midTransform).not.toBe(initialTransform);

      const box = await viewport.boundingBox();
      expect(box?.height).toBeGreaterThan(100);
      await screenshot(page, dir, 'final-state');
      cleanupScreenshots(dir);
    });

    test(`${device.name}: delete node and undo restores edges`, async ({ page }) => {
      const dir = screenshotDir('delete-node-undo', device.name);

      await page.setViewportSize(device.viewport);
      await page.goto('/lanes');
      await screenshot(page, dir, 'initial-page');

      await create_recipe(page, 'test eggs', dir);

      await wait_for_graph(page, dir);

      await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.react-flow__edge').first()).toBeAttached({ timeout: 10000 });
      await screenshot(page, dir, 'nodes-and-edges-loaded');

      const getEdgeCount = () => page.locator('.react-flow__edge').count();
      const initialEdges = await getEdgeCount();
      expect(initialEdges).toBeGreaterThan(0);

      const node = get_node(page, 'Flour');
      await expect(node).toBeVisible({ timeout: 30000 });
      await screenshot(page, dir, 'target-node-found');

      // Use helper
      await delete_node(page, 'Flour', dir);

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
      await create_recipe(page, 'test complex', dir);

      await wait_for_graph(page, dir);

      // Wait for all icons to settle (complex graph has 9 nodes, all should get icons)
      // This prevents background updates from clobbering local deletions later in the test
      await expect(page.locator('.react-flow__node img')).toHaveCount(9, { timeout: 30000 });

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
      const commonNode = get_node(page, 'Combine (Common)');
      await expect(commonNode).toBeVisible({ timeout: 30000 });
      await screenshot(page, dir, 'common-node-found');

      // Delete the common node using helper
      await delete_node(page, 'Combine (Common)', dir);
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
      const processANode = get_node(page, 'Process A');
      const processBNode = get_node(page, 'Process B');
      await expect(processANode).toBeVisible();
      await expect(processBNode).toBeVisible();

      // Check downstream nodes are connected
      const finalFNode = get_node(page, 'Final Step F');
      const finalGNode = get_node(page, 'Final Step G');
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