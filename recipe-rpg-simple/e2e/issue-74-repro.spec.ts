import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';

test.describe('Issue 74 Repro: Delete and Move', () => {
  for (const device of deviceConfigs) {
    if (device.isMobile) continue;

    test.skip(`${device.name}: Bridge persists after move`, async ({ page, login }) => {
      const dir = screenshotDir('issue-74', device.name);
      await page.setViewportSize(device.viewport);
      
      // Login flow
      await page.goto('/');
      await login('issue-74-tester');
      await page.goto('/lanes?new=true');

      // Create Chain: Egg + Sugar -> Whisk -> Cook
      await page.getByPlaceholder('Paste recipe here...').fill('1 Egg\n1 Sugar\nWhisk egg and sugar\nCook mixture');
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      
      await expect(page).toHaveURL(/id=/);
      const url = page.url();
      
      // Login as Bob (Non-Owner)
      await login('issue-74-bob');
      await page.goto(url);
      
      // We expect 4 nodes: Egg, Sugar, Whisk, Cook
      await expect(page.locator('.react-flow__node')).toHaveCount(4);
      await screenshot(page, dir, '01-initial');

      // Identify nodes
      const egg = page.locator('.react-flow__node').filter({ hasText: 'Egg' }).first();
      const sugar = page.locator('.react-flow__node').filter({ hasText: 'Sugar' }).first();
      const whisk = page.locator('.react-flow__node').filter({ hasText: 'Whisk' }).first();
      const cook = page.locator('.react-flow__node').filter({ hasText: 'Cook' }).first();

      await expect(egg).toBeVisible();
      await expect(sugar).toBeVisible();
      await expect(whisk).toBeVisible();
      await expect(cook).toBeVisible();

      // Verify Edges Initial: Egg->Whisk, Sugar->Whisk, Whisk->Cook (3 edges)
      await expect(page.locator('.react-flow__edge')).toHaveCount(3);

      // Dismiss any banners that might block interaction
      const banner = page.locator('div').filter({ hasText: /Recipe not saved|You have/ }).first();
      if (await banner.isVisible()) {
          await banner.click();
          await expect(banner).not.toBeVisible();
      }

      // Delete Middle Node (Whisk)
      await whisk.click();
      await whisk.hover();
      const deleteBtn = whisk.getByRole('button', { name: /Delete/i });
      await deleteBtn.click();
      
      await expect(whisk).not.toBeVisible();
      await screenshot(page, dir, '02-deleted');

      // Verify Bridge: Egg->Cook, Sugar->Cook (2 edges)
      await expect(page.locator('.react-flow__edge')).toHaveCount(2);
      
      // Move "Cook" node (Trigger Auto-Save/Layout Update)
      const cookBox = await cook.boundingBox();
      if (!cookBox) throw new Error("No box for cook");
      
      const startX = cookBox.x + cookBox.width / 2;
      const startY = cookBox.y + cookBox.height / 2;
      
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 100, startY + 100, { steps: 10 });
      await page.mouse.up();
      
      await page.waitForTimeout(1000); // Wait for React state & Save
      await screenshot(page, dir, '03-moved');

      // Verify Whisk is STILL gone (This is the critical check for the stale state bug)
      await expect(whisk).not.toBeVisible();

      // Verify Edges still exist (Should be 2)
      await expect(page.locator('.react-flow__edge')).toHaveCount(2);
      
      cleanupScreenshots(dir);
    });
  }
});
