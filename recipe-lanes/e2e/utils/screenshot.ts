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

import { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

const counters = new Map<string, number>();

// This creates a directory structure of screenshots like:
//
// test_screenshots/
// ├── pan-diagram/
// │   ├── phone/
// │   │   ├── <UUID>/
// │   │   │   ├── 01-initial-page.png
// │   │   │   └── ...

export const screenshotDir = (testName: string, deviceName: string) => {
  const baseDir = path.join('e2e', 'test_screenshots', testName, deviceName);
  const runId = randomUUID().slice(0, 8); // Short UUID for readability
  const dir = path.join(baseDir, runId);

  // Default: Clean up previous runs unless NO_CLEANUP is set
  if (!process.env.NO_CLEANUP) {
      cleanupScreenshots(baseDir);
  }

  fs.mkdirSync(dir, { recursive: true });
  counters.set(dir, 0); 
  return dir;
};

export const screenshot = async (page: Page, dir: string, name: string) => {
  const current = (counters.get(dir) || 0) + 1;
  counters.set(dir, current);
  const num = current.toString().padStart(2, '0');

  await page.screenshot({
    path: path.join(dir, `${num}-${name}.png`),
    fullPage: true,
  });
};

export const cleanupScreenshots = (dir: string) => {
  if (!process.env.NO_CLEANUP) {
    if (fs.existsSync(dir)) {
      // fs.rmSync(path.dirname(dir), { recursive: true, force: true });
      // fs.rmSync(path.dirname(path.dirname(dir)), { recursive: true, force: true });
      
      try {
        // Force remove the uuid dir.
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (e) {
        // Ignore if not empty (other device tests running or failed)
        console.log(`Could not remove UUID dir:${dir}`);
      }

      try {
        // Optionally remove device dir. Only runs when no other uuid runs exist.
        fs.rmdirSync(path.dirname(dir));
      } catch (e) {
        // Previous failed attempt.
        console.log(`Could not remove device dir:${path.dirname(dir)}`);
      }

      try {
        // Optionally remove test dir. Only runs when no other device runs exist.
        fs.rmdirSync(path.dirname(path.dirname(dir)));
      } catch (e) {
        // other divice is likely running.
        // console.log(`Could not remove parent screenshot directory, likely not empty.\ndir:${path.dirname(path.dirname(dir))}`);
      }
    }
    
  }
};