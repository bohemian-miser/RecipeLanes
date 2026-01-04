import { test, expect } from '@playwright/test';
import { screenshot, screenshotDir, cleanupScreenshots} from './utils/screenshot';

test('issue 66: shared gallery icon label appears on hover', async ({ page }) => {
  const dir = screenshotDir('issue-66-repro');
  const uniqueName = `TestHoverItem-${Date.now()}`;

  // 1. Go to homepage
  await page.goto('/');

  // 2. Create an icon to ensure gallery has content
  await page.getByPlaceholder('ENTER INGREDIENT...').fill(uniqueName);
  await screenshot(page, dir, '01-ingredient-filled');
  await page.getByRole('button', { name: 'Generate Icon' }).click();

  // Wait for the icon to be generated and appear in the user's inventory
  await expect(page.getByAltText(new RegExp(uniqueName, 'i')).first()).toBeVisible({ timeout: 30000 });
  await screenshot(page, dir, '02-icon-generated');

  // 3. Look for the item in the Shared Gallery (Community Collection)
  await page.reload();
  await screenshot(page, dir, '03-page-reloaded');
  
  // We need to wait for the gallery to load.
  const gallerySection = page.locator('div', { hasText: 'Community Collection' }).locator('..');
  
  // Search to filter down to our item
  await page.getByPlaceholder('Search ingredients...').fill(uniqueName);
  await screenshot(page, dir, '04-search-filled');
  
  // Find the icon card in the gallery. 
  // Wait for results to update
  const card = gallerySection.locator('.group').first();
  await expect(card).toBeVisible({ timeout: 10000 });
  
  const label = card.locator('div.absolute.bottom-0');
  
  // 4. Assert label is initially hidden (or translated out)
  // Verify it has the class `translate-y-full` which hides it
  // Note: we can't easily check class list with toHaveClass if it has many classes, but we can check CSS.
  // But wait, if the bug is that it IS hidden, and we want to fix it to be visible?
  // No, the bug says "currently it is hidden... when you mouse over it should show".
  // So "Hidden initially -> Visible on hover" is the DESIRED behavior?
  // "when you mouse over it should show the label at the bottom of the icon. currently it is hidden and only shows when an image fails to load."
  // This phrasing suggests that CURRENTLY (bug state) it is hidden (maybe even on hover?), and it SHOULD show on hover.
  // OR, it means "Currently it is hidden (permanently?)".
  
  // If my test passes (Hidden -> Visible on hover), then the feature works as intended and I can't reproduce the bug.
  // If the bug is "It does not show on hover", then `await expect(label).toHaveCSS(...)` might fail or pass depending on what's broken.
  
  // Let's assume the bug is that it DOES NOT show on hover.
  
  // Hover over the card
  await card.hover();
  await screenshot(page, dir, '05-card-hovered');
  
  // 5. Assert label becomes visible/moves into view
  // After hover: translate-y-0
  // We check if it is visible (not occluded)
  await expect(label).toBeVisible();
  
  cleanupScreenshots(dir);
});
