import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';

test.describe('Icon Generation Pipeline', () => {
  for (const device of deviceConfigs) {
    if (device.isMobile) continue;

    test(`${device.name}: Generates and displays icon`, async ({ page, login }) => {
      const dir = screenshotDir('icon-generation', device.name);
      await page.setViewportSize(device.viewport);

      // 1. Login
      await login('icon-tester');
      await page.goto('/');
      await screenshot(page, dir, '01-initial');
      
      // 2. Input Ingredient
      const input = page.getByPlaceholder('ENTER INGREDIENT...');
      await expect(input).toBeVisible();
      await input.fill('Golden Apple');
      await screenshot(page, dir, '02-input');
      
      // 3. Generate
      await page.getByRole('button', { name: 'Generate Icon' }).click();
      
      // 4. Verify Pending State (Optional, might be fast)
      // await expect(page.getByText('Forging...')).toBeVisible(); 
      
      // 5. Verify Result
      // Wait for the "Remove from Inventory" button which appears on the card
      const removeBtn = page.locator('button[title="Remove from Inventory"]').last();
      await expect(removeBtn).toBeVisible({ timeout: 30000 });
      
      const img = page.locator('.grid img').last();
      await expect(img).toBeVisible();
      
      const src = await img.getAttribute('src');
      console.log('Generated Icon URL:', src);
      
      // Expect a valid URL (Mock or Real)
      expect(src).toBeTruthy();
      if (process.env.MOCK_AI === 'true') {
          // If we are using placehold.co (Mock)
          expect(src).toContain('placehold.co');
      } else {
          // If we are using Real (or Emulator Storage)
          // It should be a storage URL or Data URI
          expect(src).toMatch(/^http|data:/);
      }

      await screenshot(page, dir, '03-generated');
    });
  }
});
