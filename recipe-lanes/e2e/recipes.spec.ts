import { test, expect } from './utils/fixtures';
import { deviceConfigs } from './utils/devices';
import { create_recipe, wait_for_graph, move_node, goto_with_retry } from './utils/actions';

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

  test('Save a copy: owner forks their own recipe from the toolbar (issue #239)', async ({ page, login }) => {
    // Owner creates and saves a recipe.
    await page.goto('/lanes?new=true');
    await login('carol-user');
    await create_recipe(page, 'Carol Original');
    await wait_for_graph(page);
    await expect(page).toHaveURL(/id=/);
    const originalId = new URL(page.url()).searchParams.get('id');

    // The Save-a-copy button is a square icon that drops down from Save on hover
    // (pointer-events-none until the group is hovered). Hover the group first so
    // the button becomes interactive, then click it.
    const saveGroup = page.locator('div.group', { has: page.getByTitle('Save a copy') });
    await saveGroup.hover();
    const copyBtn = page.getByTitle('Save a copy');
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();

    // A brand-new recipe is created (new id, "Copy of ..." title) — the original
    // is never overwritten.
    await expect(page).toHaveURL(new RegExp(`id=(?!${originalId})`));
    await expect(page.locator('h1').first()).toHaveText(/Copy of/);
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
    await goto_with_retry(page, '/gallery');
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
    await goto_with_retry(page, '/gallery?filter=unvetted');
    const card = page.locator(`a[href="/lanes?id=${recipeId}"]`);
    await expect(card).toBeVisible({ timeout: 15000 });

    await card.hover();
    await card.locator('button[title="Approve (Vet) Recipe"]').click();
    await expect(card).not.toBeVisible({ timeout: 15000 });

    // 4. Verify in public gallery
    await goto_with_retry(page, '/gallery');
    await page.getByPlaceholder('Search recipes...').fill(title);
    await page.getByPlaceholder('Search recipes...').press('Enter');
    await expect(card).toBeVisible();
  });

  // Ported from icons.spec.ts / regressions.spec.ts (Issue 66/67). De-flaked by
  // SEEDING the gallery icon directly into Firestore (admin SDK) instead of
  // relying on the async icon-generation pipeline. All waits are web-first.
  test('Shared Gallery: hover reveals label and delete removes icon (Issue 66/67)', async ({ page, login }) => {
    const uid = 'gallery-admin-user';
    const ingredient = `Gallery Egg ${Date.now()}`;

    // Seed an icon + become admin so the gallery renders it and delete is allowed.
    const { promoteToAdmin, seedIcon } = await import('./utils/admin-utils');
    await seedIcon(ingredient);

    await page.goto('/icon_overview');
    await login(uid);
    await promoteToAdmin(uid);
    // Reload so the auth/admin claim is reflected; the gallery fetches on mount.
    await page.goto('/icon_overview');

    // Narrow the gallery to exactly our seeded icon via search (deterministic).
    const gallerySection = page.locator('div', { hasText: 'Community Collection' }).last().locator('..');
    const searchInput = gallerySection.getByPlaceholder(/Search ingredients/i);
    await expect(searchInput).toBeVisible({ timeout: 15000 });
    await searchInput.fill(ingredient);

    const item = gallerySection.locator(`[data-testid="gallery-item"][data-ingredient="${ingredient}"]`);
    await expect(item).toBeVisible({ timeout: 15000 });
    await expect(item).toHaveCount(1);

    // Hover reveals the label (translate-y-0) and the delete control.
    await item.hover();
    const label = item.locator('div.absolute.bottom-0');
    await expect(label).toHaveClass(/translate-y-0/);
    const deleteBtn = item.locator('button[title="Delete Icon"]');
    await expect(deleteBtn).toBeVisible();

    // Delete — wait on the real server-action POST response, then the DOM removal.
    await Promise.all([
      page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes('/icon_overview')),
      deleteBtn.click(),
    ]);
    await expect(item).toHaveCount(0, { timeout: 15000 });
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
