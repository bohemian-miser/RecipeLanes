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
import { create_recipe, wait_for_graph } from '../utils/actions';
import { screenshotDir, screenshot, cleanupScreenshots } from '../utils/screenshot';
import { deviceConfigs } from '../utils/devices';
import fs from 'fs';

test.describe('Download Feature', () => {
  for (const device of deviceConfigs) {
    test(`${device.name}: should download recipe as PNG`, async ({ page }) => {
        test.slow();
        const dir = screenshotDir('download-test', device.name);
        await page.setViewportSize(device.viewport);
        
        // 1. Setup Recipe
        await page.goto('/lanes');
        await create_recipe(page, 'test complex', dir);
        await wait_for_graph(page, dir);
        await screenshot(page, dir, 'recipe-ready');

        // 2. Click Download and Wait for Event
        // Note: 'download' event is emitted when browser handles attachment/download
        const downloadPromise = page.waitForEvent('download');
        
        // The button has title="Download PNG"
        // On mobile, the button might be hidden or inside a menu?
        // Check if visible
        const downloadBtn = page.getByTitle('Download PNG');
        await expect(downloadBtn).toBeVisible();
        await screenshot(page, dir, 'before-click');
        downloadBtn.hover()
        await screenshot(page, dir, 'hover');

        if (await downloadBtn.isVisible()) {
            await downloadBtn.click();
        await screenshot(page, dir, 'after click');
        } else {
            console.log(`Download button not visible on ${device.name}, skipping click logic or opening menu?`);
            // Assuming button is visible in panel for now (Panel is top-right)
            // On very small screens, panel might collapse? 
            // Current implementation shows panel always.
        }
        
        const download = await downloadPromise;
        
        // 3. Verify Filename
        const filename = download.suggestedFilename();
        expect(filename).toMatch(/recipe-lanes-.*\.png/);
        
        // 4. Save and Verify Size
        const path = await download.path();
        expect(path).toBeTruthy();
        
        const stats = fs.statSync(path!);
        console.log(`[${device.name}] Downloaded file size: ${stats.size} bytes`);
        expect(stats.size).toBeGreaterThan(1000); 

        // Cleanup
        cleanupScreenshots(dir);
    });
  }
});