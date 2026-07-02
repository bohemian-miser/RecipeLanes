import { test, expect } from './utils/fixtures';
import { deviceConfigs } from './utils/devices';

// Issue #182: the camera button opens a Take photo / Choose from gallery menu,
// and picking an image creates a recipe. Runs on a phone viewport because the
// menu-positioning bug (opened off the top of the screen) only showed on mobile.
const phone = deviceConfigs.find(d => d.name === 'phone')!;

// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test('phone: camera button opens an on-screen menu and a photo creates a recipe', async ({ page }) => {
  await page.setViewportSize(phone.viewport);
  await page.goto('/lanes?new=true');

  // Open the menu.
  await page.getByRole('button', { name: 'Recipe from photo' }).click();

  const takePhoto = page.getByRole('menuitem', { name: 'Take photo' });
  const chooseGallery = page.getByRole('menuitem', { name: 'Choose from gallery' });
  await expect(takePhoto).toBeVisible();
  await expect(chooseGallery).toBeVisible();

  // The menu must sit fully within the viewport (regression: it used to open
  // upward, off the top of the screen).
  const box = await chooseGallery.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(phone.viewport.height);

  // Picking a file from the gallery input runs the full photo→recipe flow
  // (MockAIService returns the "Photo Mock Recipe" graph under .env.test).
  await page.locator('input[type="file"]:not([capture])').setInputFiles({
    name: 'recipe.png',
    mimeType: 'image/png',
    buffer: PNG,
  });

  // Navigates to the created recipe.
  await expect(page).toHaveURL(/id=/, { timeout: 20000 });
  await expect(page.locator('.react-flow__viewport')).toBeVisible({ timeout: 20000 });
});
