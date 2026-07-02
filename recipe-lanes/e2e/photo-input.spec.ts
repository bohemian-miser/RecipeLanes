import { test, expect } from './utils/fixtures';
import { deviceConfigs } from './utils/devices';

// Issue #182: the camera button opens the OS file picker (accept="image/*",
// which offers Take Photo / library on mobile) and picking an image creates a
// recipe. Runs on a phone viewport since this is a mobile-facing control.
const phone = deviceConfigs.find(d => d.name === 'phone')!;

// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test('phone: camera button opens the file picker and a photo creates a recipe', async ({ page }) => {
  await page.setViewportSize(phone.viewport);
  await page.goto('/lanes?new=true');

  const cameraBtn = page.getByRole('button', { name: 'Recipe from photo' });
  await expect(cameraBtn).toBeVisible();

  // Clicking the button opens the OS file chooser (proves the hidden input is
  // wired up and reachable).
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    cameraBtn.click(),
  ]);
  await chooser.setFiles({ name: 'recipe.png', mimeType: 'image/png', buffer: PNG });

  // Runs the full photo→recipe flow (MockAIService returns "Photo Mock Recipe"
  // under .env.test) and navigates to the created recipe.
  await expect(page).toHaveURL(/id=/, { timeout: 20000 });
  await expect(page.locator('.react-flow__viewport')).toBeVisible({ timeout: 20000 });
});
