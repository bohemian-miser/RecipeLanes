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
import { create_recipe, wait_for_graph } from './utils/actions';

test.describe('Issue 34: Hide Raw User ID', () => {
  const desktop = deviceConfigs.find(d => d.name === 'desktop')!;

  test(`${desktop.name}: Raw UID should be hidden/masked`, async ({ page, login }) => {
      const dir = screenshotDir('issue-34', desktop.name);
      cleanupScreenshots(dir);
      await page.setViewportSize(desktop.viewport);
      
      // Login as a user without a display name (or just a user)
      const uid = 'user-no-name';
      await page.goto('/lanes?new=true');
      await login(uid, { displayName: '' }); 
      
      await create_recipe(page, 'test recipe', dir);
      await wait_for_graph(page, dir);
      
      // Save it to establish ownership
      await page.getByTitle('Save Changes').click();
      await page.getByTitle('Save Changes').or(page.getByTitle('No Changes')).waitFor();
      
      await screenshot(page, dir, 'saved');

      // Check the "by ..." text
      // Current behavior (Bug): Shows raw UID "by user-no-name" (if uid is used as mock uid)
      // In emulator, uid is usually the email or 'user-no-name'.
      // Real Firebase UIDs are long strings.
      // The auth emulator uses the input string as UID if we control it.
      
      const header = page.locator('header');
      const byLine = header.getByText(/by /);
      
      await expect(byLine).toBeVisible();
      const text = await byLine.innerText();
      console.log('By line:', text);
      
      // CORRECT BEHAVIOR: Should NOT show raw UID if it's ugly/long.
      // If displayName is empty, we fallback to ID.
      // We want to verify it DOESN'T show the raw ID.
      expect(text).not.toContain(uid); 
  });
});