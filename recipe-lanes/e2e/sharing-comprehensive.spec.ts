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

test.describe('Sharing & Forking Comprehensive', () => {
  for (const device of deviceConfigs) {
    if (device.isMobile) continue;

    test(`${device.name}: Auto-fork on edit`, async ({ page, login }) => {
      const dir = screenshotDir('sharing-auto-fork', device.name);
      await page.setViewportSize(device.viewport);

      // 1. Alice creates a recipe
      await page.goto('/lanes?new=true');
      await login('mock-alice-comprehensive');
      await page.getByPlaceholder('Paste recipe here...').fill('Alice Original Recipe');
      await screenshot(page, dir, 'alice-filled');
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      await expect(page).toHaveURL(/id=/);
      const aliceUrl = page.url();
      const aliceId = new URL(aliceUrl).searchParams.get('id');
      console.log('Alice ID:', aliceId);
      await screenshot(page, dir, 'alice-created');

      // 2. Bob logs in and visits
      await login('mock-bob-comprehensive');
      await page.goto(aliceUrl);
      await expect(page.getByPlaceholder('Paste recipe here...')).toHaveValue('Alice Original Recipe');
      await screenshot(page, dir, 'bob-visits');

      // 3. Bob edits -> Should Auto-Fork
      // Trigger edit by typing
      await page.waitForTimeout(2000); // Wait for existingCopies check
      await page.getByPlaceholder('Paste recipe here...').pressSequentially(' - Modified');
      await screenshot(page, dir, '02a-bob-typing');
      
      // Expect immediate redirection (URL change)
      await expect(page).toHaveURL(new RegExp(`id=(?!${aliceId})`));
      const bobId = new URL(page.url()).searchParams.get('id');
      console.log('Bob Fork ID:', bobId);
      
      await screenshot(page, dir, 'bob-auto-forked');
      
      cleanupScreenshots(dir);
    });

    test(`${device.name}: Existing copy detection and handling`, async ({ page, login }) => {
      const dir = screenshotDir('sharing-existing-copy', device.name);
      await page.setViewportSize(device.viewport);

      // 1. Setup: Alice creates, Bob forks once.
      // Alice Create
      await page.goto('/lanes?new=true');
      await login('mock-alice-comprehensive-2');
      await page.getByPlaceholder('Paste recipe here...').fill('Alice Recipe 2');
      await screenshot(page, dir, 'alice-filling');
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      await expect(page).toHaveURL(/id=/);
      const aliceUrl = page.url();
      const aliceId = new URL(aliceUrl).searchParams.get('id');
      await screenshot(page, dir, 'alice-saved');

      // Bob Fork (Method: Edit text)
      await login('mock-bob-comprehensive-2');
      await page.goto(aliceUrl);
      await page.waitForTimeout(2000); // Wait for checkExistingCopies to settle
      await screenshot(page, dir, 'bob-visiting-first');
      await page.getByPlaceholder('Paste recipe here...').pressSequentially(' '); // Trigger fork
      await expect(page).toHaveURL(new RegExp(`id=(?!${aliceId})`));
      const bobFirstCopyId = new URL(page.url()).searchParams.get('id');
      console.log('Bob Copy 1:', bobFirstCopyId);
      await screenshot(page, dir, 'bob-forked-once');

      // 2. Bob visits Alice's recipe AGAIN
      await page.goto(aliceUrl);

      // 3. Expect Banner: "You have an existing copy"
      const banner = page.getByText(/You have \d+ existing cop/);
      await expect(banner).toBeVisible();

      await screenshot(page, dir, 'bob-revisits');

      // 4. Test "Go to Copy" link
      // Verify buttons present
      await expect(page.getByRole('link', { name: /existing cop/ })).toBeVisible();
      const saveNewBtn = page.getByRole('button', { name: 'Save another copy' });
      await expect(saveNewBtn).toBeVisible();

      // 5. Action: Save Another Copy
      await saveNewBtn.click();
      
      // Expect new URL (Copy 2)
      await expect(page).toHaveURL(new RegExp(`id=(?!${aliceId})`));
      await expect(page).toHaveURL(new RegExp(`id=(?!${bobFirstCopyId})`));
      const bobSecondCopyId = new URL(page.url()).searchParams.get('id');
      console.log('Bob Copy 2:', bobSecondCopyId);
      
      await expect(page.locator('text=New version created')).toBeVisible();
      await screenshot(page, dir, 'bob-made-second-copy');

      // Verify Title of Second Copy
      // Note: Title is displayed in an H1 by default, not an input (unless editing)
      const titleElement = page.locator('h1').first();
      await expect(titleElement).toBeVisible();
      const titleText = await titleElement.textContent();
      console.log('Actual Title of Copy 2:', titleText);
      
      await expect(titleElement).toHaveText(/^Another copy of/);

      // 6. Bob visits Alice's recipe A THIRD TIME (now has 2 copies)
      await page.goto(aliceUrl);
      await page.waitForTimeout(2000); // Wait for checkExistingCopies
      
      // Expect Banner: "You have 2 existing copies..."
      await expect(page.getByText('You have 2 existing copies')).toBeVisible();
      await screenshot(page, dir, 'bob-banner-two-copies');
      
      // Verify Link
      await expect(page.getByRole('link', { name: /2 existing copies/ })).toBeVisible();
      
      // Verify "Save another copy" button
      await expect(page.getByRole('button', { name: 'Save another copy' })).toBeVisible();
      
      // 7. Bob makes a 3rd copy
      await page.getByRole('button', { name: 'Save another copy' }).click();
      await expect(page).toHaveURL(new RegExp(`id=(?!${aliceId})`));
      await expect(page.locator('h1').first()).toHaveText(/^Another copy of/);
      await screenshot(page, dir, 'bob-third-copy');

      // 8. Bob visits Alice's recipe A FOURTH TIME (now has 3 copies)
      await page.goto(aliceUrl);
      await page.waitForTimeout(2000); 
      await expect(page.getByText('You have 3 existing copies')).toBeVisible();
      await screenshot(page, dir, 'bob-banner-three-copies');
      
      // 9. Bob makes a 4th copy
      await page.getByRole('button', { name: 'Save another copy' }).click();
      await expect(page).toHaveURL(new RegExp(`id=(?!${aliceId})`));
      const bobLatestUrl = page.url();
      await expect(page.locator('h1').first()).toHaveText(/^Another copy of/);
      await screenshot(page, dir, 'bob-fourth-copy');

      // 10. Alice loads Bob's latest copy
      await login('mock-alice-comprehensive-2'); // Switch back to Alice
      await page.goto(bobLatestUrl);
      await screenshot(page, dir, 'alice-viewing-bob-copy');
      
      // Alice is NOT the owner of Bob's copy, so she should just see it (no banners initially unless she has a copy of THIS copy, which she doesnt)
      // She should see the title "Another copy of..."
      await expect(page.locator('h1').first()).toHaveText(/^Another copy of/);
      
      // 11. Alice edits Bob's copy -> Auto Fork
      await page.waitForTimeout(2000);
      await page.getByPlaceholder('Paste recipe here...').pressSequentially(' - Alice Edit');
      await screenshot(page, dir, 'alice-editing');
      
      // Expect URL change (Alice's Fork of Bob's Copy)
      const bobLatestId = new URL(bobLatestUrl).searchParams.get('id');
      await expect(page).toHaveURL(new RegExp(`id=(?!${bobLatestId})`));
      
      // Title logic might vary (Copy of Another copy...), verify it exists
      await expect(page.locator('h1').first()).toBeVisible();
      
      await screenshot(page, dir, '12-alice-forked-bob');

      cleanupScreenshots(dir);
    });

    test(`${device.name}: Anonymous user fork`, async ({ page, login }) => {
      const dir = screenshotDir('sharing-anon', device.name);
      await page.setViewportSize(device.viewport);

      // 1. Alice creates (needs auth to create permanent one, or use anon flow)
      // Let's use Alice to create a stable "Shared" recipe
      await page.goto('/lanes?new=true');
      await login('mock-alice-comprehensive-3');
      await page.getByPlaceholder('Paste recipe here...').fill('Shared Recipe');
      await screenshot(page, dir, 'alice-filling');
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      await expect(page).toHaveURL(/id=/); // Critical wait
      const sharedUrl = page.url();
      const sharedId = new URL(sharedUrl).searchParams.get('id');
      await screenshot(page, dir, 'alice-saved');

      // 2. Logout (become Anon)
      // Use UI button to ensure both Client SDK and Server Cookie are cleared
      await page.getByRole('button', { name: 'Logout' }).click();
      await screenshot(page, dir, 'logged-out');
      
      // Verify logout
      await expect(page.getByText('Login')).toBeVisible();

      // 3. Visit Recipe
      await page.goto(sharedUrl);
      // Wait for load
      await expect(page.getByPlaceholder('Paste recipe here...')).toHaveValue('Shared Recipe');
      await screenshot(page, dir, 'anon-view');

      // 4. Edit -> Should NOT Auto Fork (Anon)
      await page.getByPlaceholder('Paste recipe here...').pressSequentially(' Edited');
      await screenshot(page, dir, 'anon-edited');
      
      // Expect URL to remain the same (no fork)
      await expect(page).toHaveURL(sharedUrl);
      
      // Expect "Log in to save" notification
      await expect(page.getByText('Log in to save your changes')).toBeVisible();
      
      await screenshot(page, dir, 'anon-notification');

      cleanupScreenshots(dir);
    });
  }
});