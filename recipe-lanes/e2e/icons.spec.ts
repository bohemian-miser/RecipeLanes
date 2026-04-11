import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';
import { create_recipe, wait_for_graph, get_node } from './utils/actions';

test.describe('Icon Systems (Consolidated)', () => {
  const desktop = deviceConfigs.find(d => d.name === 'desktop')!;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(desktop.viewport);
  });

  test('Icon Lifecycle: Generation, Gallery & Stats', async ({ page, login }) => {
    test.slow(); // icon generation + gallery propagation can exceed 30s
    const dir = screenshotDir('icons-lifecycle', desktop.name);
    const unique = `Cycle Egg ${Date.now()}`;
    const uid = 'admin-cycle';

    // 1. Generation (Maker)
    await page.goto('/icon_overview');
    await login(uid);
    const { promoteToAdmin } = await import('./utils/admin-utils');
    await promoteToAdmin(uid);
    
    // Wait for the auth refresh to complete and the form to become visible and stable
    await page.waitForTimeout(1000);
    const ingredientInput = page.getByPlaceholder('ENTER INGREDIENT...');
    await expect(ingredientInput).toBeVisible({ timeout: 15000 });
    
    await ingredientInput.fill(unique);
    await page.getByRole('button', { name: 'Generate Icon' }).click();
    
    const inventoryIcon = page.getByTestId('inventory-display').getByAltText(new RegExp(unique, 'i')).first();
    await expect(inventoryIcon).toBeVisible({ timeout: 60000 });

    // 2. Stats & Gallery Check
    const gallerySection = page.locator('div', { hasText: 'Community Collection' }).last().locator('..');
    await gallerySection.scrollIntoViewIfNeeded();

    // Poll until the icon appears in the gallery. The icon is written to ingredients_new by the
    // Cloud Function which may complete slightly after the shortlist assignment makes the
    // inventory icon visible. Retry the search every 2s for up to 30s.
    const gallerySearchInput = gallerySection.getByPlaceholder(/Search ingredients/);
    await expect.poll(async () => {
        await gallerySearchInput.fill('');
        await gallerySearchInput.fill(unique);
        await page.waitForTimeout(600); // debounce (300ms) + fetch round-trip
        return gallerySection.getByAltText(new RegExp(unique, 'i')).count();
    }, { timeout: 30000, intervals: [2000] }).toBeGreaterThan(0);

    const galleryIcon = gallerySection.getByAltText(new RegExp(unique, 'i')).first();
    
    // Hover for label
    await galleryIcon.hover();

    await screenshot(page, dir, 'after hover');
    const label = gallerySection.locator(`[data-testid="gallery-item"][data-ingredient="${unique}"] div.absolute.bottom-0`);
    await expect(label).toHaveClass(/translate-y-0/);

    // 3. Delete
    await gallerySection.locator('button').filter({ has: page.locator('svg.lucide-trash-2') }).first().click();

    await screenshot(page, dir, 'after delete clicked');
    //wait 3 sec
    await page.waitForTimeout(3000);
    await screenshot(page, dir, 'after delete clicked 3 sec');
    
    await expect(galleryIcon).not.toBeVisible();
    // TODO: delete inventory icon when underlying icon is deleted.
    // await expect(inventoryIcon).not.toBeVisible();

    cleanupScreenshots(dir);
  });

  test('Icon Backlog & Automated Recipe Flow', async ({ page, login }) => {
    test.slow(); // Icon generation + backlog retry pipeline can take >30s on Pi
    const dir = screenshotDir('icons-backlog-auto', desktop.name);

    // 1. Automated flow (Recipe creation)
    await page.goto('/lanes?new=true');
    const autoIng = `Auto Egg ${Date.now()}`;
    await create_recipe(page, `test ${autoIng}`, dir);
    await wait_for_graph(page, dir);
    const node = get_node(page, autoIng);
    await expect(node.locator('img')).toBeVisible({ timeout: 60000 });

    // 2. Backlog Management
    await page.goto('/icon_overview');
    await login('backlog-user');
    const failItem = `Fail Egg ${Date.now()}`;
    
    await page.waitForFunction(() => (window as any)._firebaseDb && (window as any)._firebaseFirestore);
    // Clear existing queue items so our test item sorts to page 1 of QueueMonitor
    await page.evaluate(async () => {
        const { _firebaseDb, _firebaseFirestore } = window as any;
        const { collection, getDocs, deleteDoc, doc } = _firebaseFirestore;
        const snap = await getDocs(collection(_firebaseDb, 'icon_queue'));
        for (const d of snap.docs) {
            await deleteDoc(doc(_firebaseDb, 'icon_queue', d.id));
        }
    });
    await page.evaluate(async ({ name }) => {
        const { _firebaseDb, _firebaseFirestore } = window as any;
        const { doc, setDoc } = _firebaseFirestore;
        await setDoc(doc(_firebaseDb, 'icon_queue', name), {
            status: 'failed', error: 'Simulated', recipes: [], recipeCount: 0, created_at: new Date()
        });
    }, { name: failItem });

    const row = page.locator('[data-testid="backlog-item"]').filter({ hasText: failItem });
    await expect(row).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(2000); // Let QueueMonitor settle after any background icon processing
    await row.getByLabel('Retry').click();
    await expect(row).not.toBeVisible({ timeout: 30000 });
    
    cleanupScreenshots(dir);
  });
});
