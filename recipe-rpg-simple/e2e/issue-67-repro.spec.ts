import { test, expect } from '@playwright/test';

test('issue 67: delete icon removes it from inventory and gallery', async ({ page }) => {
  const uniqueName = `DeleteTest-${Date.now()}`;

  // 1. Go to homepage
  await page.goto('/');

  // 2. Generate Icon
  await page.getByPlaceholder('ENTER INGREDIENT...').fill(uniqueName);
  await page.getByRole('button', { name: 'Generate Icon' }).click();

  // Wait for it to appear in INVENTORY
  const inventory = page.getByTestId('inventory-display');
  const iconLocator = inventory.getByAltText(new RegExp(uniqueName, 'i')).first();
  await expect(iconLocator).toBeVisible({ timeout: 30000 });

  // 3. Delete Icon
  // Find the delete button within the card container in inventory
  // Use page.getByAltText to ensure it matches inside the group, without including the parent inventory in the locator chain
  const card = inventory.locator('.group', { has: page.getByAltText(new RegExp(uniqueName, 'i')) }).first();
  
  // The delete button has `title="Remove from Inventory"`.
  const deleteBtn = card.getByTitle('Remove from Inventory');
  await card.hover(); // Ensure opacity transition
  await deleteBtn.click();

  // 4. Verify it is gone from Inventory immediately
  await expect(iconLocator).not.toBeVisible();

  // 5. Reload and Verify it is STILL gone
  await page.reload();
  await expect(page.getByTestId('inventory-display').getByAltText(new RegExp(uniqueName, 'i'))).not.toBeVisible();

  // 6. Verify it is NOT in Community Gallery
  // Search for it
  await page.getByPlaceholder('Search ingredients...').fill(uniqueName);
  // Expect "No icons found" in shared gallery
  await expect(page.getByTestId('shared-gallery').getByText('No icons found')).toBeVisible();
});
