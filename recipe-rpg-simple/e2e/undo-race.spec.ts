import { test, expect, } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots} from './utils/screenshot';
import { deviceConfigs } from './utils/devices';
import { move_node, click_undo, get_node } from './utils/actions';
import { Page } from '@playwright/test';

export async function move_node_fast(page: Page, text: string, dx: number, dy: number, dir: string) {
    const node = get_node(page, text);
    await expect(node).toBeVisible({ timeout: 10000 });
    const box = await node.boundingBox();
    expect(box).toBeTruthy();

    await screenshot(page, dir, `before-move-${text}`);
    
    await node.hover();
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + dx, box!.y + box!.height / 2 + dy, { steps: 2 });
    page.mouse.up();
    
    screenshot(page, dir, `after-move-${text}`);
    return node;
}


export async function click_undo_fast(page: Page, dir: string) {
    const undoBtn = page.locator('button[title="Undo (Ctrl+Z)"]');
    // await expect(undoBtn).toBeEnabled();
    screenshot(page, dir, `before-undo`);
    await undoBtn.click();
    await page.waitForTimeout(500); // Wait for animation
    screenshot(page, dir, `after-undo`);
}

test.describe('Undo Race Conditions', () => {
  test.slow();

  const desktopDevices = deviceConfigs.filter(d => d.name === 'desktop');

  for (const device of desktopDevices) {
    
    // test(`${device.name}: Slow Undo (Control) - Wait for save then undo`, async ({ page, login }) => {
    //   const dir = screenshotDir('undo-race-slow', device.name);
    //   await page.setViewportSize(device.viewport);
    //   await page.goto('/lanes');
    //   await login('user-owner', { displayName: 'Recipe Owner' });
    //   await expect(page.getByTitle('Logout')).toBeVisible({ timeout: 15000 });

    //   // Setup
    //   await page.getByPlaceholder('Paste recipe here...').fill('test eggs');
    //   await page.locator('button:has(svg.lucide-arrow-right)').click();
    //   await expect(page.locator('.react-flow__viewport')).toBeVisible();
    //   await expect(page.locator('.react-flow__node').first()).toBeVisible();
      
    //   const node = page.locator('.react-flow__node').filter({ hasText: 'Eggs' }).first();
    //   const boxOriginal = await node.boundingBox();

    //   // Move
    //   await move_node(page, 'Eggs', -400, 0, dir);
      
    //   // WAIT for Save
    //   await expect(page.getByTitle('Saved')).toBeVisible({ timeout: 5000 });
    //   await page.waitForTimeout(1000); // Extra stability

    //   // Undo
    //   await click_undo(page, dir);

    //   // Verify
    //   const boxRestored = await node.boundingBox();
    //   expect(Math.abs(boxRestored!.x - boxOriginal!.x)).toBeLessThan(20);
      
    //   cleanupScreenshots(dir);
    // });

    
    
    test(`${device.name}: slow Undo`, async ({ page, login }) => {
      const dir = screenshotDir('undo-race-slow-myversion', device.name);
      await page.setViewportSize(device.viewport);
      await page.goto('/lanes');
      await login('user-owner', { displayName: 'Recipe Owner' });
      await expect(page.getByTitle('Logout')).toBeVisible({ timeout: 15000 });

      // Setup
      await page.getByPlaceholder('Paste recipe here...').fill('test eggs');
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      await expect(page.locator('.react-flow__viewport')).toBeVisible();
      await expect(page.locator('.react-flow__node').first()).toBeVisible();
      
      const node = get_node(page, 'Eggs');
      const boxOriginal = await node.boundingBox();
      const undoBtn = page.locator('button[title="Undo (Ctrl+Z)"]');

      // Move
      
      // await move_node_fast(page, 'Eggs', -400, 0, dir);
  
    await expect(node).toBeVisible({ timeout: 10000 });
    const box = await node.boundingBox();
    expect(box).toBeTruthy();

    await screenshot(page, dir, `before-move-Eggs`);
      await screenshot(page, dir, 'waiting-for-nodes');
      await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10000 });
    
    await node.hover();
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + -400, box!.y + box!.height / 2 , { steps: 2 });
    await page.mouse.up();
    
      // screenshot(page, dir, `after-move-Eggs`);
      
    await screenshot(page, dir, `after-move-Eggs-before-undo`);
      
      // WAIT for Save
      await expect(page.getByText('Saved')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(1000); // Extra stability

      // Undo
      // await click_undo_fast(page, dir);
      // await expect(undoBtn).toBeEnabled();
      // screenshot(page, dir, `before-undo`);
      await undoBtn.click();
      await page.waitForTimeout(500); // Wait for animation
      await screenshot(page, dir, `after-undo`);

      // await expect(page.getByText('Saved')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(2500); // Extra stability
      await screenshot(page, dir, 'After saved');
      

      // Verify
      const boxRestored = await node.boundingBox();
      expect(Math.abs(boxRestored!.x - boxOriginal!.x)).toBeLessThan(20);
      
      cleanupScreenshots(dir);
    });

    test(`${device.name}: Fast Undo`, async ({ page, login }) => {
      const dir = screenshotDir('undo-race-fast-myversion', device.name);
      await page.setViewportSize(device.viewport);
      await page.goto('/lanes');
      await login('user-owner', { displayName: 'Recipe Owner' });
      await expect(page.getByTitle('Logout')).toBeVisible({ timeout: 15000 });

      // Setup
      await page.getByPlaceholder('Paste recipe here...').fill('test eggs');
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      await expect(page.locator('.react-flow__viewport')).toBeVisible();
      await expect(page.locator('.react-flow__node').first()).toBeVisible();
      
      const node = get_node(page, 'Eggs');
      const boxOriginal = await node.boundingBox();
      const undoBtn = page.locator('button[title="Undo (Ctrl+Z)"]');

      // Move
      
      // await move_node_fast(page, 'Eggs', -400, 0, dir);
  
    await expect(node).toBeVisible({ timeout: 10000 });
    const box = await node.boundingBox();
    expect(box).toBeTruthy();

    await screenshot(page, dir, `before-move-Eggs`);
      await screenshot(page, dir, 'waiting-for-nodes');
      await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10000 });
    
    await node.hover();
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + -400, box!.y + box!.height / 2 , { steps: 2 });
    await page.mouse.up();
    
      // screenshot(page, dir, `after-move-Eggs`);
      
    await screenshot(page, dir, `after-move-Eggs-before-undo`);
      
    
    // Undo
    // await click_undo_fast(page, dir);
    // await expect(undoBtn).toBeEnabled();
    // screenshot(page, dir, `before-undo`);
    await undoBtn.click();
    await page.waitForTimeout(500); // Wait for animation
    await screenshot(page, dir, `after-undo`);
    
    // WAIT for Save (**Doesn't say Saved bc undo cancels the save**)
    // await expect(page.getByText('Saved')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(2500); // Extra stability
      // await expect(page.getByText('Saved')).toBeVisible({ timeout: 5000 });
      // await page.waitForTimeout(2500); // Extra stability
      await screenshot(page, dir, 'After saved');
      

      // Verify
      const boxRestored = await node.boundingBox();
      expect(Math.abs(boxRestored!.x - boxOriginal!.x)).toBeLessThan(20);
      
      cleanupScreenshots(dir);
    });


  }
});
