import { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const screenshotDir = (testName: string, deviceName: string) => {
  const dir = path.join('e2e', 'test_screenshots', testName, deviceName);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

export const screenshot = async (page: Page, dir: string, name: string) => {
  await page.screenshot({
    path: path.join(dir, `${name}.png`),
    fullPage: true,
  });
};
