import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir } from './utils/screenshot';
import { promoteToAdmin } from './utils/admin-utils';

test('issue 67: delete icon removes it from inventory and gallery', async ({ page, login }) => {
  const dir = screenshotDir('issue-67-repro', 'desktop');
  const uniqueName = `DeleteTest-${Date.now()}`;
  
  // Login and Promote to Admin
  const uid = 'issue67-user';
  
  // 1. Go to homepage (Required for auth hooks to load)
  await page.goto('/icon_overview');
  await screenshot(page, dir, '01-home-loaded');

  // Login and Promote to Admin
  await login(uid);
  await promoteToAdmin(uid);
  
  // 2. Generate Icon
  await page.getByPlaceholder('ENTER INGREDIENT...').fill(uniqueName);
  await screenshot(page, dir, '02-input-filled');
  await page.getByRole('button', { name: 'Generate Icon' }).click();
  await screenshot(page, dir, '03-after-generate-click');

  // Wait for it to appear in INVENTORY (top cache) to confirm generation
  const inventory = page.getByTestId('inventory-display');
  const inventoryIcon = inventory.getByAltText(new RegExp(uniqueName, 'i')).first();
  
  await screenshot(page, dir, '04-before-expect-inventory-visible');
  await expect(inventoryIcon).toBeVisible({ timeout: 30000 });

  // 3. Search and Delete from SHARED GALLERY (bottom permanent storage)
  const gallery = page.getByTestId('shared-gallery');
  await gallery.scrollIntoViewIfNeeded();
  await screenshot(page, dir, '04b-gallery-scrolled');

  const searchInput = gallery.getByPlaceholder('Search ingredients...');
  
  await searchInput.fill(uniqueName);
  await screenshot(page, dir, '05-gallery-search-filled');
  
  // Wait for loading to finish (debounce 300ms + fetch)
  const galleryIcon = gallery.getByAltText(new RegExp(uniqueName, 'i')).first();
  await screenshot(page, dir, '06-before-expect-gallery-icon-visible');
  await expect(galleryIcon).toBeVisible({ timeout: 15000 });

  // Use xpath or simple locator from the icon element to find parent
  const card = galleryIcon.locator('..'); 
  const deleteBtn = card.locator('button[title="Delete Icon"]');
  
  await screenshot(page, dir, '06b-before-hover');
  
  // Hover the card to trigger group-hover
  await card.hover(); 
  await screenshot(page, dir, '07-gallery-card-hovered');
  
  // Wait for the button to be visible (transition)
  await expect(deleteBtn).toBeVisible();
  
  await deleteBtn.click();
  await screenshot(page, dir, '08-after-gallery-delete-click');

  // 4. Verify it is gone from Gallery immediately (Optimistic UI in Gallery component)
  await screenshot(page, dir, '09-before-expect-gallery-icon-gone');
  await expect(galleryIcon).not.toBeVisible();
  
  // 5. Verify it is also gone from Inventory (requires sync/reload if state is separate)
  // Since Inventory uses a separate state array, deletion from Gallery might not auto-update Inventory
  // unless we share state or trigger a refresh.
  // For now, we accept that a reload is needed to verify true persistence/sync.
  
  await page.reload();
  await screenshot(page, dir, '10-page-reloaded-for-sync');
  
  await screenshot(page, dir, '11-before-expect-inventory-icon-gone');
  await expect(page.getByTestId('inventory-display').getByAltText(new RegExp(uniqueName, 'i'))).not.toBeVisible();

  // 6. Double check persistence in gallery
  await page.getByTestId('shared-gallery').scrollIntoViewIfNeeded();
  await page.getByTestId('shared-gallery').getByPlaceholder('Search ingredients...').fill(uniqueName);
  await page.waitForTimeout(1000);
  await screenshot(page, dir, '12-gallery-search-refilled');
  
  await screenshot(page, dir, '13-before-expect-gallery-still-empty');
  await expect(page.getByTestId('shared-gallery').getByText('No icons found')).toBeVisible();
});
