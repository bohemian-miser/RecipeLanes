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

test.describe('[OLD] Banner Logic', () => {
  for (const device of deviceConfigs) {
    if (device.isMobile) continue;

    test(`${device.name}: Guest Banner Dismissal`, async ({ page }) => {
      const dir = screenshotDir('banners-guest', device.name);
      await page.setViewportSize(device.viewport);
      
      await page.goto('/lanes?new=true');
      await page.getByPlaceholder('Paste recipe here...').fill('Guest Recipe');
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      
      // Wait for banner
      const banner = page.locator('text=Recipe not saved to account');
      // Locator finds the text node or span inside. We need to click the container (Banner div).
      // The text is inside the Banner.
      // But clicking text should bubble up to Banner onClick.
      // Unless text is covered by button? No.
      // We'll click top-left to be safe.
      await expect(banner).toBeVisible({ timeout: 15000 });
      await screenshot(page, dir, 'banner-visible');
      
      // Tap to dismiss (avoid button center)
      // We need to click the Banner component, not just the text span.
      // page.locator('text=...') might select a span.
      // Use :scope or xpath to find parent?
      // Or just click the text at an offset if it's wide?
      // Better: locate the Banner div directly.
      const bannerDiv = page.locator('div').filter({ has: page.locator('text=Recipe not saved to account') }).last();
      await bannerDiv.click({ position: { x: 5, y: 5 } });
      
      await expect(banner).not.toBeVisible();
      await screenshot(page, dir, 'banner-dismissed');
      cleanupScreenshots(dir);
    });

    test(`${device.name}: Notification Banner Dismissal`, async ({ page, context }) => {
      const dir = screenshotDir('banners-notification', device.name);
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.setViewportSize(device.viewport);
      
      // Use share button to trigger notification
      await page.goto('/lanes?new=true');
      await page.getByPlaceholder('Paste recipe here...').fill('Notification Test');
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      await expect(page.locator('.react-flow__viewport')).toBeVisible();
      
      // Click Share
      await page.locator('button[title="Save & Copy Link"]').click();
      
      // Notification
      const banner = page.locator('text=Link copied to clipboard');
      await screenshot(page, dir, 'debug-before-banner');
      await expect(banner).toBeVisible();
      await screenshot(page, dir, 'banner-visible');
      
      // Dismiss
      await banner.click();
      await expect(banner).not.toBeVisible(); // Should be instant, faster than 3s
      await screenshot(page, dir, 'banner-dismissed');
      cleanupScreenshots(dir);
    });

    // Broken test.
    // test(`${device.name}: Warning Banner Action`, async ({ page, login }) => {
    //   const dir = screenshotDir('banners-warning', device.name);
    //   await page.setViewportSize(device.viewport);
      
    //   await page.goto('/lanes?new=true');
    //   await login('warning-tester');
    //   await page.getByPlaceholder('Paste recipe here...').fill('Original Text');
    //   await page.locator('button:has(svg.lucide-arrow-right)').click();
    //   await expect(page).toHaveURL(/id=/);
      
    //   // Modify text
    //   await page.getByPlaceholder('Paste recipe here...').fill('Modified Text');
      
    //   // Warning appears
    //   const banner = page.locator('div').filter({ hasText: 'This will override' }).last();
    //   await expect(banner).toBeVisible();
    //   await screenshot(page, dir, 'banner-visible');
      
    //   // Click to Fork
    //   await banner.click({ force: true });
      
    //   // Warning gone
    //   await expect(banner).not.toBeVisible();
    //   // Should have new ID? Or "New version created" notification
    //   await expect(page.locator('text=New version created')).toBeVisible();
    //   await screenshot(page, dir, 'banner-actioned');
    //   cleanupScreenshots(dir);
    // });
    
    test(`${device.name}: Existing Copies Banner Dismissal`, async ({ page, login }) => {
        const dir = screenshotDir('banners-copies', device.name);
        await page.setViewportSize(device.viewport);
        
        await page.goto('/lanes?new=true');
        await login('mock-alice-banners');
        await page.getByPlaceholder('Paste recipe here...').fill('Alice Shared');
        await page.locator('button:has(svg.lucide-arrow-right)').click();
        await expect(page).toHaveURL(/id=/);
        const aliceUrl = page.url();
        const aliceId = new URL(aliceUrl).searchParams.get('id');
        
        await page.getByRole('button', { name: 'Logout' }).click();
        await login('mock-bob-banners');
        
        // Bob creates a copy of Alice's recipe
        await page.goto(aliceUrl);
        await page.locator('button:has(svg.lucide-arrow-right)').click(); // Visualize/Fork
        // Wait for new ID
        await expect(page).toHaveURL(new RegExp(`id=(?!${aliceId})`));
        
        // Now Bob has a copy.
        // Bob visits Alice's recipe AGAIN.
        await page.goto(aliceUrl);
        
        // 2. Expect "Existing Copy" banner (Passive)
        // Text: "You have 1 existing copy of this recipe..."
        const banner = page.getByText(/You have \d+ existing cop/);
        await expect(banner).toBeVisible();
        await screenshot(page, dir, 'banner-visible');
        
        // Dismiss
        // Click the container background (careful not to click links)
        const bannerDiv = page.locator('div').filter({ hasText: /You have \d+ existing cop/ }).last();
        await bannerDiv.click({ position: { x: 5, y: 5 } });
        
        await expect(banner).not.toBeVisible();
        await screenshot(page, dir, 'banner-dismissed');
        cleanupScreenshots(dir);
    });
  }
});