import { test, expect, devices, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const deviceConfigs = [
  { name: 'phone', viewport: devices['iPhone 12'].viewport!, isMobile: true },
  { name: 'desktop', viewport: { width: 1280, height: 720 }, isMobile: false },
];

// This creates a directory structure of screenshots like:
//
// test_screenshots/
// ├── pan-diagram/
// │   ├── phone/
// │   │   ├── 01-initial-page.png
// │   │   ├── 02-recipe-entered.png
// │   │   └── ...
// │   └── desktop/
// │       ├── 01-initial-page.png
// │       └── ...
// └── delete-node-undo/
//     ├── phone/
//     │   ├── 01-initial-page.png
//     │   └── ...
//     └── desktop/
//         └── ...
// import { test, expect, devices, Page } from '@playwright/test';
// import * as fs from 'fs';
// import * as path from 'path';


const screenshotDir = (testName: string, deviceName: string) => {
  const dir = path.join('test_screenshots', testName, deviceName);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const screenshot = async (page: Page, dir: string, name: string) => {
  await page.screenshot({
    path: path.join(dir, `${name}.png`),
    fullPage: true,
  });
};

test.describe('Graph Interaction', () => {
  test.slow();

  for (const device of deviceConfigs) {
    test(`${device.name}: can pan diagram`, async ({ page }) => {
      const dir = screenshotDir('pan-diagram', device.name);

      await page.setViewportSize(device.viewport);
      await page.goto('/lanes');
      await screenshot(page, dir, '01-initial-page');

      await page.getByPlaceholder('Paste recipe here...').fill('Toast: Put bread in toaster.');
      await screenshot(page, dir, '02-recipe-entered');

      await page.locator('button.bg-yellow-500').click();
      await screenshot(page, dir, '03-create-clicked');

      const viewport = page.locator('.react-flow__viewport');
      await expect(viewport).toBeVisible({ timeout: 15000 });
      await screenshot(page, dir, '04-graph-visible');

      const initialTransform = await viewport.getAttribute('style');

      await page.mouse.move(200, 400);
      await page.mouse.down();
      await screenshot(page, dir, '05-pan-started');

      await page.mouse.move(200, 200);
      await page.mouse.up();
      await page.waitForTimeout(2000);
      await screenshot(page, dir, '06-pan-completed');

      const midTransform = await viewport.getAttribute('style');
      expect(midTransform).not.toBe(initialTransform);

      const box = await viewport.boundingBox();
      expect(box?.height).toBeGreaterThan(500);
      await screenshot(page, dir, '07-final-state');
    });

    test(`${device.name}: delete node and undo restores edges`, async ({ page }) => {
      const dir = screenshotDir('delete-node-undo', device.name);

      await page.setViewportSize(device.viewport);
      await page.goto('/lanes');
      await screenshot(page, dir, '01-initial-page');

      await page.getByPlaceholder('Paste recipe here...').fill('test eggs');
      await page.locator('button.bg-yellow-500').click();
      await screenshot(page, dir, '02-recipe-created');

      const viewport = page.locator('.react-flow__viewport');
      await expect(viewport).toBeVisible({ timeout: 30000 });
      await screenshot(page, dir, '03-graph-visible');

      await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.react-flow__edge').first()).toBeAttached({ timeout: 10000 });
      await screenshot(page, dir, '04-nodes-and-edges-loaded');

      const getEdgeCount = () => page.locator('.react-flow__edge').count();
      const initialEdges = await getEdgeCount();
      expect(initialEdges).toBeGreaterThan(0);

      const node = page.locator('.react-flow__node').filter({ hasText: 'Mock Ingredient 2' }).first();
      await expect(node).toBeVisible({ timeout: 30000 });
      await screenshot(page, dir, '05-target-node-found');

      await node.click();
      await screenshot(page, dir, '06-node-selected');

      await node.hover();
      await page.waitForTimeout(1000);
      await screenshot(page, dir, '07-node-hovered');

      const deleteBtn = node.getByRole('button', { name: /Delete Step/i });
      await expect(deleteBtn).toBeVisible();
      await screenshot(page, dir, '08-delete-button-visible');

      await deleteBtn.click({ force: true });
      await screenshot(page, dir, '09-delete-clicked');

      await page.waitForTimeout(2000);
      await screenshot(page, dir, '10-after-delete-wait');

      await expect(node).not.toBeVisible({ timeout: 10000 });
      await screenshot(page, dir, '11-node-deleted');

      const deletedEdges = await getEdgeCount();
      expect(deletedEdges).toBeLessThan(initialEdges);

      const undoBtn = page.locator('button[title="Undo (Ctrl+Z)"]');
      await undoBtn.click();
      await screenshot(page, dir, '12-undo-clicked');

      await expect(node).toBeVisible();
      await screenshot(page, dir, '13-node-restored');

      await page.waitForTimeout(2000);
      await screenshot(page, dir, '14-final-state');

      const restoredEdges = await getEdgeCount();
      expect(restoredEdges).toBe(initialEdges);
    });
  }
});