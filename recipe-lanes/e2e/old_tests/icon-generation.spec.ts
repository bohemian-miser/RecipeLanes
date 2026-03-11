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
import { screenshot, screenshotDir, cleanupScreenshots } from '../utils/screenshot';
import { deviceConfigs } from '../utils/devices';

test.describe('[OLD] Icon Generation Pipeline', () => {
  for (const device of deviceConfigs) {
    if (device.isMobile) continue;

    test(`${device.name}: Generates and displays icon`, async ({ page, login }) => {
      const dir = screenshotDir('icon-generation', device.name);
      await page.setViewportSize(device.viewport);

      // 1. Login
      await page.goto('/icon_overview');
      await login('icon-tester');
      await screenshot(page, dir, '01-initial');
      
      // 2. Input Ingredient
      const input = page.getByPlaceholder('ENTER INGREDIENT...');
      await screenshot(page, dir, '00-debug-before-input-visible');
      await expect(input).toBeVisible();
      await input.fill('Golden Apple');
      await screenshot(page, dir, '02-input');
      
      // 3. Generate
      await page.getByRole('button', { name: 'Generate Icon' }).click();
      
      // 5. Verify Result
      // Wait for the "Remove from Inventory" button which appears on the card
      const removeBtn = page.locator('button[title="Remove from Inventory"]').last();
      await screenshot(page, dir, '00-debug-before-remove-btn');
      await expect(removeBtn).toBeVisible({ timeout: 30000 });
      
      const img = page.locator('.grid img').last();
      await screenshot(page, dir, '00-debug-before-img-visible');
      await expect(img).toBeVisible();
      
      const src = await img.getAttribute('src');
      console.log('Generated Icon URL:', src);
      
      // Expect a valid URL (Mock or Real)
      expect(src).toBeTruthy();
      if (process.env.MOCK_AI === 'true') {
          // In Mock mode for Icon Maker (Synchronous Action), it returns the placeholder directly.
          // Note: The /lanes flow (Cloud Function) might upload to storage, but this test covers the direct action.
          expect(src).toMatch(/placehold\.co|firebasestorage|127\.0.0.1|localhost/);
      } else {
          // If we are using Real (or Emulator Storage)
          expect(src).toMatch(/^http|data:/);
      }

      // Verify that the icon has a transparent background
      const isTransparent = await page.evaluate(async (imageUrl) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = imageUrl;
        });

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        
        const pixelData = ctx.getImageData(0, 0, 1, 1).data;
        return pixelData[3] === 0; // Check alpha channel of the top-left pixel
      }, src);

      expect(isTransparent).toBe(true);

      await screenshot(page, dir, '03-generated');
      cleanupScreenshots(dir);
    });
  }
});