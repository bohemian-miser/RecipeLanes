import { test, expect, devices } from '@playwright/test';

test.use({ ...devices['iPhone 12'] });

test('mobile: can pan recipe diagram', async ({ page }) => {
  await page.goto('/lanes');

  // Create Recipe
  await page.getByPlaceholder('Paste recipe here...').fill('Toast: Put bread in toaster.');
  
  // Click Visualize Button (Yellow button with ArrowRight)
  await page.locator('button.bg-yellow-500').click();

  // Wait for graph to render
  const viewport = page.locator('.react-flow__viewport');
  await expect(viewport).toBeVisible({ timeout: 15000 });
  
  // Get initial transform
  const initialTransform = await viewport.getAttribute('style');

  // Get viewport size
  const size = page.viewportSize();
  console.log('Viewport:', size);

  // Try dragging at Y=630 (Inside Footer area: 664 - 64 = 600 to 664)
  await page.mouse.move(200, 630);
  await page.mouse.down();
  await page.mouse.move(200, 500);
  await page.mouse.up();

  // Wait a bit for transition
  await page.waitForTimeout(500);

  // Verify transform changed
  const newTransform = await viewport.getAttribute('style');
  expect(newTransform).not.toBe(initialTransform);
});
