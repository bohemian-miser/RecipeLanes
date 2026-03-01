import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';

test.skip('Gallery Search', () => {
  for (const device of deviceConfigs) {
    if (device.isMobile) continue; // Focus on desktop for search testing

    test(`${device.name}: Search filters icons correctly`, async ({ page, login }) => {
      const dir = screenshotDir('gallery-search', device.name);
      await page.setViewportSize(device.viewport);

      // 1. Seed Data (Authenticated)
      await page.goto('/icon_overview'); // Icon Maker
      await login('search-tester');
      
      await screenshot(page, dir, 'debug-before-input-visible');
      await expect(page.getByPlaceholder('ENTER INGREDIENT...')).toBeVisible({ timeout: 15000 });
      
      const ingredients = [
          'Egg Salad', 
          'Boiled Egg', 
          'Scrambled Eggs', 
          'Blueberry Muffin', 
          'Strawberry Tart', 
          'Apple Pie'
      ];
      
      console.log('Seeding icons...');
      for (const ing of ingredients) {
          await page.getByPlaceholder('ENTER INGREDIENT...').fill(ing);
          await page.getByRole('button', { name: 'Generate Icon' }).click();
          // Wait for generation to complete (icon appears in inventory)
          await screenshot(page, dir, `debug-seeding-${ing.replace(/\s/g, '-')}`);
          await expect(page.locator('button[title="Remove from Inventory"]').last()).toBeVisible({ timeout: 30000 });
      }
      await screenshot(page, dir, 'seeded-inventory');

      // 2. Go to Gallery (Shared Gallery at bottom)
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      
      // 3. Perform Search for "Egg"
      const searchInput = page.getByPlaceholder('Search ingredients...');
      await screenshot(page, dir, 'debug-before-search-visible');
      await expect(searchInput).toBeVisible();
      
      console.log('Searching for "Egg"...');
      await searchInput.fill('Egg');
      
      // Wait for debounce + fetch
      await page.waitForTimeout(1500);
      await screenshot(page, dir, 'search-egg');
  
      // Locator updated to match current UI "Public Gallery"
      const gallerySection = page.locator('div').filter({ hasText: /Gallery|Collection/ }).last();
      const galleryGrid = gallerySection.locator('.grid');
      
      // Check that Egg ones are visible
      await expect(galleryGrid.getByAltText('Egg Salad')).toBeVisible();
      await expect(galleryGrid.getByAltText('Boiled Egg')).toBeVisible();
      await expect(galleryGrid.getByAltText('Scrambled Eggs')).toBeVisible();
      
      // Check that Fruits are NOT visible
      await expect(galleryGrid.getByAltText('Blueberry Muffin')).not.toBeVisible();
      await expect(galleryGrid.getByAltText('Strawberry Tart')).not.toBeVisible();
      await expect(galleryGrid.getByAltText('Apple Pie')).not.toBeVisible();
      
      // 5. Search for "Blueberry"
      await searchInput.fill('Blueberry');
      await page.waitForTimeout(1500);
      await screenshot(page, dir, 'search-blueberry');
      
      await expect(galleryGrid.getByAltText('Blueberry Muffin')).toBeVisible();
      await expect(galleryGrid.getByAltText('Egg Salad')).not.toBeVisible();
      
      console.log('Search test passed.');
      cleanupScreenshots(dir);
    });
  }
});
