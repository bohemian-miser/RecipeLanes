import { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const counters = new Map<string, number>();

// This creates a directory structure of screenshots like:
//
// test_screenshots/
// ├── pan-diagram/
// │   ├── phone/
// │   │   ├── 01-initial-page.png
// │   │   ├── 02-recipe-entered.png
// │   │   └── ...
// │   └── desktop/
// │       ├── 01-initial-page.png
// │       └── ...
// └── delete-node-undo/
//     ├── phone/
//     │   ├── 01-initial-page.png
//     │   └── ...
//     └── desktop/
//         └── ...

export const screenshotDir = (testName: string, deviceName: string) => {
  const dir = path.join('e2e', 'test_screenshots', testName, deviceName);
  cleanupScreenshots(dir);
  fs.mkdirSync(dir, { recursive: true });
  counters.set(dir, 0); // Initialize/reset counter for this specific dir
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
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
        try {
            fs.rmdirSync(path.dirname(dir));
        } catch (e) {
            // Ignore if not empty (other device tests running or failed)
        }
    }
};
