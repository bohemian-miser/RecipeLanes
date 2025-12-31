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
      fs.rmSync(dir, { recursive: true, force: true });
    }
    try {
      fs.rmdirSync(path.dirname(path.dirname(dir)));
    } catch (e) {
      // Ignore if not empty (other device tests running or failed)
    }
  }
};
