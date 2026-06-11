import { test, expect } from './utils/fixtures';
import { deviceConfigs } from './utils/devices';
import { create_recipe, wait_for_graph, move_node } from './utils/actions';

test.describe('Recipe Lifecycle & Social (Consolidated)', () => {
  const desktop = deviceConfigs.find(d => d.name === 'desktop')!;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(desktop.viewport);
  });

  test('Guest Flow: Save & Share & New', async ({ page }) => {
    await page.goto('/lanes?new=true');
    await create_recipe(page, 'test eggs');
    await wait_for_graph(page);

    // 1. Share (Copy Link)
    const shareBtn = page.locator('button[title="Save & Copy Link"]');
    await shareBtn.click();
    await expect(page.locator('button[title="Copied!"]')).toBeVisible();

    // 2. Save (Blocked for Guest)
    // Make a change to enable save button if it became "No Changes"
    await move_node(page, '2 Eggs', 50, 50);

    // We search for a button with save icon or title "Save Changes"
    const saveBtn = page.locator('button').filter({ has: page.locator('svg.lucide-save') }).first();
    await expect(saveBtn).toBeEnabled({ timeout: 10000 });
    await saveBtn.click();
    await expect(page.getByText('Recipe not saved to account')).toBeVisible();

    // 3. New
    await page.locator('button[title="Create New"]').click();
    await expect(page).not.toHaveURL(/id=/);
  });

  test('Authenticated Flow: Forking & Copies', async ({ page, login }) => {
    // 1. Alice creates recipe
    await page.goto('/lanes?new=true');
    await login('alice-user');
    await create_recipe(page, 'Alice Original');
    await wait_for_graph(page);
    await expect(page).toHaveURL(/id=/);
    const aliceUrl = page.url();
    const aliceId = new URL(aliceUrl).searchParams.get('id');

    // 2. Bob forks recipe
    await page.goto('/lanes'); // Clear
    await login('bob-user');
    await page.goto(aliceUrl);
    await page.getByPlaceholder('Paste recipe here...').fill('Bob Modification');
    await page.locator('button.bg-yellow-500').click(); // Visualize/Fork

    await expect(page).toHaveURL(new RegExp(`id=(?!${aliceId})`));
    await expect(page.locator('h1').first()).toHaveText(/Copy of/);

    // 3. Bob sees "Existing Copies" banner on Alice's page
    await page.goto(aliceUrl);
    await expect(page.getByText(/You have \d+ existing cop/)).toBeVisible();
  });

  test('Gallery: Search & Vetting (Admin)', async ({ page, login }) => {
    test.slow();

    // 1. Create a public unvetted recipe
    await page.goto('/lanes?new=true');
    await login('creator-user');
    const title = `Unique-${Date.now()}`;
    await create_recipe(page, `make ${title}`);
    await wait_for_graph(page);

    await page.getByTitle('Toggle Visibility').click();
    await expect(page.locator('button', { hasText: 'Public' })).toBeVisible();
    const recipeId = new URL(page.url()).searchParams.get('id');

    // 2. Verify not in public gallery
    await page.goto('/gallery');
    await page.getByPlaceholder('Search recipes...').fill(title);
    await page.getByPlaceholder('Search recipes...').press('Enter');
    await expect(page.locator(`a[href="/lanes?id=${recipeId}"]`)).not.toBeVisible();

    // 3. Login as Admin & Vet
    await login('admin-user');
    const { promoteToAdmin } = await import('./utils/admin-utils');
    await promoteToAdmin('admin-user');

    // Re-login so the client picks up the fresh admin custom claim, then navigate.
    // The unvetted-filter view only renders for admins; expect.toBeVisible below
    // auto-retries the gallery fetch until the card appears (no fixed sleep).
    await login('admin-user');
    await page.goto('/gallery?filter=unvetted');
    const card = page.locator(`a[href="/lanes?id=${recipeId}"]`);
    await expect(card).toBeVisible({ timeout: 15000 });

    await card.hover();
    await card.locator('button[title="Approve (Vet) Recipe"]').click();
    await expect(card).not.toBeVisible({ timeout: 15000 });

    // 4. Verify in public gallery
    await page.goto('/gallery');
    await page.getByPlaceholder('Search recipes...').fill(title);
    await page.getByPlaceholder('Search recipes...').press('Enter');
    await expect(card).toBeVisible();
  });

  test('UI Features: Feedback', async ({ page }) => {
    test.slow();

    await page.goto('/lanes?new=true');
    await create_recipe(page, 'UI Test');
    await wait_for_graph(page);

    await page.getByTitle('Feedback & Contribute').click();
    await page.fill('#message', 'Test feedback');
    await page.fill('#email', 'test@example.com');
    await page.getByRole('button', { name: 'Send Feedback' }).click();
    await expect(page.getByText('Thank You!')).toBeVisible();
  });
});
