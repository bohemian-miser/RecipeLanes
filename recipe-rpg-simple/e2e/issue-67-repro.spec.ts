import { test, expect } from '@playwright/test';

test('issue 67: delete icon removes it from inventory and gallery', async ({ page }) => {
  const uniqueName = `DeleteTest-${Date.now()}`;

  // 1. Go to homepage
  await page.goto('/');

  // 2. Generate Icon
  await page.getByPlaceholder('ENTER INGREDIENT...').fill(uniqueName);
  await page.getByRole('button', { name: 'Generate Icon' }).click();

  // Wait for it to appear
  const iconLocator = page.getByAltText(new RegExp(uniqueName, 'i')).first();
  await expect(iconLocator).toBeVisible({ timeout: 30000 });

  // 3. Delete Icon
  // The delete button is on the card.
  // We need to hover or just click it? The delete button might be visible or require hover.
  // In `IconDisplay`:
  // <button ... onClick={onDelete} ... title="Remove from Inventory"> <Trash2 ...> </button>
  // It is visible in the row `flex items-center gap-1`.
  
  // Find the delete button within the card container
  const card = page.locator('.group', { has: iconLocator }).first();
  // Wait, `IconDisplay` cards have `group` class?
  // Yes: `className="group relative bg-zinc-800 ..."`
  
  // The delete button has `title="Remove from Inventory"`.
  const deleteBtn = card.getByTitle('Remove from Inventory');
  await deleteBtn.click();

  // 4. Verify it is gone from Inventory immediately
  await expect(iconLocator).not.toBeVisible();

  // 5. Reload and Verify it is STILL gone
  await page.reload();
  await expect(iconLocator).not.toBeVisible();

  // 6. Verify it is NOT in Community Gallery
  // Search for it
  await page.getByPlaceholder('Search ingredients...').fill(uniqueName);
  // Expect "No icons found" or empty list
  await expect(page.getByText('No icons found')).toBeVisible();
});
