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

import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';

test.skip('Pivot Interaction', () => {
  for (const device of deviceConfigs) {
    test(`${device.name}: Pivot Branch`, async ({ page }) => {
      const dir = screenshotDir('pivot', device.name);
      await page.setViewportSize(device.viewport);
      
      await page.goto('/lanes?new=true');
      await page.getByPlaceholder('Paste recipe here...').fill(`1 Egg
Mix`);
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      
      const viewport = page.locator('.react-flow__viewport');
      await expect(viewport).toBeVisible({ timeout: 15000 });
      
      const eggNode = page.locator('.react-flow__node').filter({ hasText: 'Egg' }).first();
      const mixNode = page.locator('.react-flow__node').filter({ hasText: 'Mix' }).first();
      
      await expect(eggNode).toBeVisible();
      await expect(mixNode).toBeVisible();
      
      // Get initial positions
      const getPos = async (loc: any) => {
          const box = await loc.boundingBox();
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      };
      
      const eggStart = await getPos(eggNode);
      const mixStart = await getPos(mixNode);
      
      console.log('Start:', { eggStart, mixStart });
      
      // Perform Pivot
      // Desktop: Shift + Drag
      // Mobile: Long Press + Drag
      
      if (device.isMobile) {
          // Mobile: Touch & Hold 600ms, then Drag
          const box = await eggNode.boundingBox();
          if (!box) throw new Error('No box');
          const centerX = box.x + box.width / 2;
          const centerY = box.y + box.height / 2;
          
          // Touch Start
          await page.mouse.move(centerX, centerY);
          await page.mouse.down();
          
          // Wait for Long Press (600ms threshold)
          await page.waitForTimeout(800); 
          
          // Drag
          await page.mouse.move(centerX + 100, centerY + 50, { steps: 10 });
          await page.mouse.up();
          
      } else {
          // Desktop: Shift + Drag
          const box = await eggNode.boundingBox();
          if (!box) throw new Error('No box');
          const centerX = box.x + box.width / 2;
          const centerY = box.y + box.height / 2;
          
          await page.keyboard.down('Shift');
          await page.mouse.move(centerX, centerY);
          await page.mouse.down();
          await page.mouse.move(centerX + 100, centerY + 50, { steps: 10 });
          await page.mouse.up();
          await page.keyboard.up('Shift');
      }
      
      await page.waitForTimeout(1000); // Wait for React state update
      
      const eggEnd = await getPos(eggNode);
      const mixEnd = await getPos(mixNode);
      
      console.log('End:', { eggEnd, mixEnd });
      
      // Verification
      // Egg should have moved significantly
      const eggDist = Math.sqrt(Math.pow(eggEnd.x - eggStart.x, 2) + Math.pow(eggEnd.y - eggStart.y, 2));
      expect(eggDist).toBeGreaterThan(20);
      
      // Mix should be roughly stationary (it's the pivot)
      // Allow small drift due to layout adjustment or force simulation if active
      const mixDist = Math.sqrt(Math.pow(mixEnd.x - mixStart.x, 2) + Math.pow(mixEnd.y - mixStart.y, 2));
      expect(mixDist).toBeLessThan(20);
      
      await screenshot(page, dir, 'pivoted');
      cleanupScreenshots(dir);
    });
  }
});