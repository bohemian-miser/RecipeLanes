import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';
import { create_recipe, wait_for_graph, get_node, move_node } from './utils/actions';

test.describe('Regressions & Bug Repros', () => {
    const desktop = deviceConfigs.find(d => d.name === 'desktop')!;

    test('Issue 34: Hide Raw User ID', async ({ page, login }) => {
        const dir = screenshotDir('issue-34', desktop.name);
        await page.setViewportSize(desktop.viewport);
        
        const uid = 'user-no-name-' + Date.now();
        await page.goto('/lanes?new=true');
        await login(uid, { displayName: '' }); 
        
        await create_recipe(page, 'test recipe', dir);
        await wait_for_graph(page, dir);
        await page.getByTitle('Save Changes').click();
        
        const header = page.locator('header');
        const byLine = header.getByText(/by /);
        await expect(byLine).toBeVisible();
        const text = await byLine.innerText();
        
        // Should NOT show raw UID
        expect(text).not.toContain(uid); 
        cleanupScreenshots(dir);
    });

    test('Issue 74: Bridge persists after move', async ({ page, login }) => {
        const dir = screenshotDir('issue-74', desktop.name);
        await page.setViewportSize(desktop.viewport);
        
        await page.goto('/lanes?new=true');
        await login('issue-74-user');

        await create_recipe(page, '1 Egg\n1 Sugar\nWhisk egg and sugar\nCook mixture', dir);
        await wait_for_graph(page, dir);
        
        const whisk = get_node(page, 'Whisk');
        await whisk.click();
        await whisk.hover();
        await whisk.getByRole('button', { name: /Delete/i }).click();
        await expect(whisk).not.toBeVisible();

        // Verify Bridge: Egg->Cook, Sugar->Cook (2 edges)
        await expect(page.locator('.react-flow__edge')).toHaveCount(2);
        
        // Move "Cook" node
        await move_node(page, 'Cook', 100, 100, dir);
        await page.waitForTimeout(500); 

        await expect(whisk).not.toBeVisible();
        await expect(page.locator('.react-flow__edge')).toHaveCount(2);
        cleanupScreenshots(dir);
    });

    test('Issue 66/67: Shared Gallery hover and delete', async ({ page, login }) => {
        const dir = screenshotDir('issue-66-67', desktop.name);
        const uniqueName = `Regress-${Date.now()}`;
        const uid = 'admin-user';

        await page.goto('/icon_overview');
        await login(uid);
        // Note: admin promotion usually happens via side effect or pre-seeding in tests.
        // Assuming login(uid) with 'admin' in name might be mocked as admin, 
        // or using promoteToAdmin utility.
        const { promoteToAdmin } = await import('./utils/admin-utils');
        await promoteToAdmin(uid);

        // 1. Generate
        await page.getByPlaceholder('ENTER INGREDIENT...').fill(uniqueName);
        await page.getByRole('button', { name: 'Generate Icon' }).click();
        
        const inventoryIcon = page.getByTestId('inventory-display').getByAltText(new RegExp(uniqueName, 'i')).first();
        await expect(inventoryIcon).toBeVisible({ timeout: 30000 });

        // 2. Hover (Issue 66)
        const gallerySection = page.locator('div', { hasText: 'Community Collection' }).last().locator('..');
        await gallerySection.scrollIntoViewIfNeeded();
        
        const searchInput = gallerySection.getByPlaceholder(/Search icons/i);
        await searchInput.fill(uniqueName);
        
        const galleryIcon = gallerySection.getByAltText(new RegExp(uniqueName, 'i')).first();
        await expect(galleryIcon).toBeVisible();
        
        await galleryIcon.hover();
        // Check for label visibility (adjust selector based on actual implementation)
        await expect(page.getByText(new RegExp(uniqueName, 'i'))).toBeVisible();

        // 3. Delete (Issue 67)
        // Click delete on the gallery icon (might need to hover first to see it)
        const deleteBtn = gallerySection.locator('button').filter({ has: page.locator('svg.lucide-trash-2') }).first();
        await deleteBtn.click();
        
        await expect(galleryIcon).not.toBeVisible();
        await expect(inventoryIcon).not.toBeVisible();

        cleanupScreenshots(dir);
    });

    test('Stats Tracking: impressions and rejections', async ({ page }) => {
        test.slow();
        const dir = screenshotDir('stats-tracking', desktop.name);
        const uniqueName = `Stats Test ${Date.now()}`;
        
        // 1. Create Recipe
        await page.goto('/lanes?new=true');
        await create_recipe(page, `make ${uniqueName}`, dir);
        await wait_for_graph(page, dir);
        
        // 2. Wait for Icon
        const node = get_node(page, uniqueName);
        await expect(node.locator('img')).toBeVisible({ timeout: 30000 });

        // 3. Check Stats in Gallery (New Tab)
        const galleryPage = await page.context().newPage();
        await galleryPage.goto('/icon_overview');
        await galleryPage.getByPlaceholder('Search ingredients...').fill(uniqueName);
        await galleryPage.keyboard.press('Enter');
        
        const card = galleryPage.locator('.relative.group').filter({ hasText: uniqueName }).first();
        await expect(card).toContainText('0 / 1', { timeout: 10000 });

        // 4. Reroll in Recipe (Original Tab)
        await page.bringToFront();
        await node.hover();
        const rerollBtn = node.locator('button[title="Reroll Icon"]');
        await rerollBtn.click();
        
        await expect(rerollBtn.locator('svg')).not.toHaveClass(/animate-spin/, { timeout: 30000 });
        
        // 5. Verify Stats Updated
        await galleryPage.bringToFront();
        const cards = galleryPage.locator('.relative.group').filter({ hasText: uniqueName });
        await expect.poll(async () => {
            await galleryPage.reload();
            await galleryPage.getByPlaceholder('Search ingredients...').fill(uniqueName);
            await galleryPage.keyboard.press('Enter');
            return cards.count();
        }, { timeout: 15000 }).toBe(2);
        
        const cardTexts = await cards.allTextContents();
        expect(cardTexts.some(t => t.includes('1 / 1'))).toBeTruthy();
        expect(cardTexts.some(t => t.includes('0 / 1'))).toBeTruthy();
        
        await galleryPage.close();
        cleanupScreenshots(dir);
    });

    test('Comprehensive Stats: multiple rerolls and persistence', async ({ page }) => {
        test.slow();
        const dir = screenshotDir('stats-comprehensive', desktop.name);
        const prefix = `StatsCheck${Date.now()}`;
        const ingredient = `${prefix} Onion`;

        // 1. Create Recipe
        await page.goto('/lanes?new=true');
        await create_recipe(page, `test eggs with ${ingredient}`, dir);
        await wait_for_graph(page, dir);
        
        const node = get_node(page, ingredient);
        await expect(node.locator('img')).toBeVisible({ timeout: 30000 });
        let currentSrc = await node.locator('img').getAttribute('src');

        // Helper to check stats count
        const expectStats = async (name: string, count: number) => {
            const galleryPage = await page.context().newPage();
            await galleryPage.goto('/icon_overview');
            await galleryPage.getByPlaceholder('Search ingredients...').fill(name);
            await galleryPage.keyboard.press('Enter');
            const cards = galleryPage.locator('.relative.group').filter({ hasText: name });
            await expect.poll(() => cards.count(), { timeout: 10000 }).toBe(count);
            await galleryPage.close();
        };

        // 2. Initial Check
        await expectStats(ingredient, 1);

        // 3. Reroll 1
        const rerollBtn = node.locator('button[title="Reroll Icon"]');
        await node.hover();
        await rerollBtn.click({ force: true });
        await expect.poll(() => node.locator('img').getAttribute('src'), { timeout: 25000 }).not.toBe(currentSrc);
        currentSrc = await node.locator('img').getAttribute('src');

        // 4. Verify 2 Icons
        await expectStats(ingredient, 2);

        // 5. Reroll 2
        await node.hover();
        await rerollBtn.click({ force: true });
        await expect.poll(() => node.locator('img').getAttribute('src'), { timeout: 25000 }).not.toBe(currentSrc);

        // 6. Verify 3 Icons
        await expectStats(ingredient, 3);

        // 7. Refresh and Reroll new ingredient
        const ingredient2 = `${prefix} Garlic`;
        await page.goto('/lanes?new=true');
        await create_recipe(page, `crush ${ingredient2}`, dir);
        await wait_for_graph(page, dir);
        
        await page.reload();
        await wait_for_graph(page, dir);
        const node2 = get_node(page, ingredient2);
        const src2 = await node2.locator('img').getAttribute('src');
        
        await node2.hover();
        await node2.locator('button[title="Reroll Icon"]').click({ force: true });
        await expect.poll(() => node2.locator('img').getAttribute('src'), { timeout: 25000 }).not.toBe(src2);

        await expectStats(ingredient2, 2);
        cleanupScreenshots(dir);
    });
});
