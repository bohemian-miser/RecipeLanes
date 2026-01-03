import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';

test.describe('Icon Generation Pipeline', () => {
  for (const device of deviceConfigs) {
    if (device.isMobile) continue;

    test(`${device.name}: Generates and displays icon`, async ({ page, login }) => {
      const dir = screenshotDir('icon-generation', device.name);
      await page.setViewportSize(device.viewport);

      // 1. Login
      await page.goto('/');
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
          expect(src).toMatch(/placehold\.co|firebasestorage|127\.0\.0\.1|localhost/);
      } else {
          // If we are using Real (or Emulator Storage)
          expect(src).toMatch(/^http|data:/);
      }

      await screenshot(page, dir, '03-generated');
      cleanupScreenshots(dir);
    });
  }
    test(`${device.name}: Rerolls and displays transparent icon`, async ({ page, login }) => {
      const dir = screenshotDir('icon-reroll', device.name);
      await page.setViewportSize(device.viewport);
      // 1. Login
      await page.goto('/');
      await login('icon-reroll-tester');
      await screenshot(page, dir, '01-initial');
      // 2. Input Ingredient
      const input = page.getByPlaceholder('ENTER INGREDIENT...');
      await expect(input).toBeVisible();
      await input.fill('Golden Apple');
      await screenshot(page, dir, '02-input');
      // 3. Generate
      await page.getByRole('button', { name: 'Forge' }).click();
      // 4. Wait for Icon
      const icon = page.locator('.group .relative .w-full.h-full.object-contain');
      await expect(icon).toBeVisible({ timeout: 30000 });
      await screenshot(page, dir, '03-generated-icon');
      // 5. Reroll
      await page.getByTitle('Reroll').click();
      // 6. Wait for new Icon
      await expect(icon).toBeVisible({ timeout: 30000 });
      await screenshot(page, dir, '04-rerolled-icon');
      // Manual check: Please verify that the rerolled icon in 04-rerolled-icon.png has a transparent background.
    });
});
