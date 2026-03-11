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

import { test, expect } from '@playwright/test';
import { screenshot, screenshotDir } from '../utils/screenshot';
import { get_node } from '../utils/actions';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test.skip('[OLD] issue 69: mobile pivot interaction', async ({ page }) => {
  const dir = screenshotDir('issue-69-repro', 'mobile');
  // 1. Setup Graph with Egg -> Mix
  await page.goto('/lanes?new=true');
  await screenshot(page, dir, '01-lanes-loaded');
  
  // TODO use a known test recipe.
  await page.getByPlaceholder('Paste recipe here...').fill(`1 Egg\nMix`);
  await screenshot(page, dir, '02-recipe-input');
  
  await page.locator('button:has(svg.lucide-arrow-right)').click();
  await screenshot(page, dir, '03-after-visualize-click');
  
  const eggNode = get_node(page, 'Egg');
  const mixNode = get_node(page, 'Mix');
  
  await screenshot(page, dir, '04-before-expect-egg-visible');
  await expect(eggNode).toBeVisible({ timeout: 15000 });
  
  // Get initial positions
  const getPos = async (loc: any) => {
      const box = await loc.boundingBox();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  
  const eggStart = await getPos(eggNode);
  
  // 2. Test Pivot (Tap & Hold + Drag)
  const box = await eggNode.boundingBox();
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  
  // Wait for Long Press
  await page.waitForTimeout(800);
  await screenshot(page, dir, '05-after-long-press');
  
  await screenshot(page, dir, '06-before-expect-pivot-mode');
  await expect(eggNode.locator('.border-blue-500')).toBeVisible();

  // Drag
  await page.mouse.move(centerX + 100, centerY + 50, { steps: 10 });
  await page.mouse.up();
  await screenshot(page, dir, '07-after-drag');
  
  await page.waitForTimeout(1000); // Wait for settlement
  
  const eggEnd = await getPos(eggNode);
  
  // Check movement
  const eggDist = Math.sqrt(Math.pow(eggEnd.x - eggStart.x, 2) + Math.pow(eggEnd.y - eggStart.y, 2));
  console.log('Egg Distance:', eggDist);
  expect(eggDist).toBeGreaterThan(20);
  
  // 3. Test Tap Selection (Branch Selection)
  const mixBox = await mixNode.boundingBox();
  const mixCX = mixBox.x + mixBox.width / 2;
  const mixCY = mixBox.y + mixBox.height / 2;
  
  await page.mouse.move(mixCX, mixCY);
  await page.mouse.down();
  await page.mouse.up();
  await screenshot(page, dir, '08-after-mix-tap');
  
  await screenshot(page, dir, '09-before-expect-mix-selected');
  await expect(mixNode).toHaveClass(/selected/);
});