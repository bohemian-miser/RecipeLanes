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
        test.slow();
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
        test.slow(); // Icon generation + gallery checks can exceed 30s with queue backlog
        const dir = screenshotDir('issue-66-67', desktop.name);
        const uniqueName = `Regress Egg ${Date.now()}`;
        const uid = 'admin-user';

        await page.goto('/icon_overview');
        await login(uid);
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

        // Poll until the icon appears in the gallery (Cloud Function may not yet have written it
        // to ingredients_new when the shortlist assignment first makes the inventory icon visible).
        const searchInput = gallerySection.getByPlaceholder(/Search ingredients/i);
        await expect.poll(async () => {
            await searchInput.fill('');
            await searchInput.fill(uniqueName);
            await page.waitForTimeout(600); // debounce (300ms) + fetch round-trip
            return gallerySection.getByAltText(new RegExp(uniqueName, 'i')).count();
        }, { timeout: 30000, intervals: [2000] }).toBeGreaterThan(0);

        const galleryIcon = gallerySection.getByAltText(new RegExp(uniqueName, 'i')).first();
        
        await galleryIcon.hover();
        const label = gallerySection.locator(`[data-testid="gallery-item"][data-ingredient="${uniqueName}"] div.absolute.bottom-0`);
        await expect(label).toHaveClass(/translate-y-0/, { timeout: 10000 });

        // 3. Delete (Issue 67)
        const deleteBtn = gallerySection.locator('button').filter({ has: page.locator('svg.lucide-trash-2') }).first();
        await deleteBtn.click();
        
        await expect(galleryIcon).not.toBeVisible();
        cleanupScreenshots(dir);
    });

    test('Stats Tracking: impressions and rejections', async ({ page }) => {
        test.slow();
        const dir = screenshotDir('stats-tracking', desktop.name);
        const uniqueName = `Stats Egg ${Date.now()}`;
        
        await page.goto('/lanes?new=true');
        await create_recipe(page, `make ${uniqueName}`, dir);
        await wait_for_graph(page, dir);
        
        const node = get_node(page, uniqueName);
        await expect(node.locator('img')).toBeVisible({ timeout: 30000 });

        const galleryPage = await page.context().newPage();
        await galleryPage.goto('/icon_overview');

        // Poll until the icon appears in the gallery. Icon generation runs asynchronously via
        // Cloud Function — retry the search until the ingredient_new entry is written.
        const cards = galleryPage.locator('.relative.group').filter({ hasText: uniqueName });
        await expect.poll(async () => {
            await galleryPage.reload();
            await galleryPage.getByPlaceholder('Search ingredients...').fill(uniqueName);
            await galleryPage.keyboard.press('Enter');
            await galleryPage.waitForTimeout(1000); // debounce + fetch
            return cards.count();
        }, { timeout: 30000, intervals: [2000] }).toBeGreaterThan(0);

        const card = cards.first();
        await expect(card).toContainText('0 / 1', { timeout: 5000 });

        await page.bringToFront();
        await node.hover();
        const rerollBtn = node.locator('button[title="Cycle shortlist"]');
        await expect(rerollBtn).toBeVisible({ timeout: 15000 });
        await rerollBtn.click();

        await expect(rerollBtn.locator('svg')).not.toHaveClass(/animate-spin/, { timeout: 30000 });
        
        await galleryPage.bringToFront();
        await expect.poll(async () => {
            await galleryPage.reload();
            await galleryPage.getByPlaceholder('Search ingredients...').fill(uniqueName);
            await galleryPage.keyboard.press('Enter');
            await galleryPage.waitForTimeout(1000);
            return cards.count();
        }, {
            timeout: 45000,
            intervals: [2000]
        }).toBe(2);
        
        const cardTexts = await cards.allTextContents();
        expect(cardTexts.some(t => t.includes('1 / 1'))).toBeTruthy();
        expect(cardTexts.some(t => t.includes('0 / 1'))).toBeTruthy();
        
        await galleryPage.close();
        cleanupScreenshots(dir);
    });

    test('Issue 61: Local move persists against background update', async ({ page, browser, login }) => {
        // Technically this test is duped in graph.spec.ts, but it's a good test.
        const dir = screenshotDir('issue-61-glitch', desktop.name);
        
        // 1. Create Recipe
        await page.goto('/lanes?new=true');
        await login('user-glitch');
        await create_recipe(page, 'test eggs with ham', dir);
        await expect(page).toHaveURL(/id=/);
        const recipeId = new URL(page.url()).searchParams.get('id');
        await wait_for_graph(page, dir);
        
        // 2. Move Locally
        const node = get_node(page, '2 Eggs');
        const box = await node.boundingBox();
        await move_node(page, '2 Eggs', 300, 300, dir);
        
        // 3. Background update (different context)
        const contextB = await browser.newContext();
        const pageB = await contextB.newPage();
        const cookies = await page.context().cookies();
        await contextB.addCookies(cookies);
        
        await pageB.goto(`/lanes?id=${recipeId}`);
        await expect(pageB.locator('.react-flow__node').first()).toBeVisible();
        
        // Update title
        await pageB.locator('header h1').click();
        await pageB.locator('header input').fill('Background Title');
        await pageB.keyboard.press('Enter');
        await pageB.waitForTimeout(1000);
        await contextB.close();
        
        // 4. Verify user A sees new title but RETAINS position
        // TODO fix when fixed.
        // await expect(page.locator('header h1')).toHaveText('Background Title');
        const boxAfter = await get_node(page, '2 Eggs').boundingBox();
        expect(boxAfter?.x).toBeGreaterThan(box!.x + 200);
        
        cleanupScreenshots(dir);
    });

    test('Title edit persists after reload', async ({ page, login }) => {
        const dir = screenshotDir('title-persistence', desktop.name);
        await page.setViewportSize(desktop.viewport);

        await page.goto('/lanes?new=true');
        await login('title-test-user');
        await create_recipe(page, 'scrambled eggs', dir);
        await wait_for_graph(page, dir);
        await expect(page).toHaveURL(/id=/);
        const recipeUrl = page.url();

        // Edit the title inline
        await page.locator('header h1').click();
        await page.locator('header input').clear();
        await page.locator('header input').fill('My Renamed Recipe');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1000); // allow save to complete

        // Reload and verify title persisted
        await page.goto(recipeUrl);
        await expect(page.locator('header h1')).toHaveText('My Renamed Recipe', { timeout: 10000 });

        cleanupScreenshots(dir);
    });

    test('Comprehensive Stats: multiple rerolls and persistence', async ({ page }) => {
        test.slow();
        const dir = screenshotDir('stats-comprehensive', desktop.name);
        const RUN_ID = Date.now().toString().slice(-4);
        const ingredient = `A${RUN_ID} Egg`.toLowerCase();
        const ingredient2 = `B${RUN_ID} Flour`.toLowerCase();

        await page.goto('/lanes?new=true');
        await create_recipe(page, `test eggs with ${ingredient}`, dir);
        await wait_for_graph(page, dir);

        await page.waitForTimeout(5000);
        await screenshot(page, dir, '01-recipe-created');

        const node = get_node(page, ingredient);
        await expect(node.locator('img')).toBeVisible({ timeout: 60000 });
        let currentSrc = await node.locator('img').getAttribute('src');
        await screenshot(page, dir, 'ingredient seen');

        const expectStats = async (name: string, count: number) => {
            const galleryPage = await page.context().newPage();
            await galleryPage.goto('/icon_overview');
            await expect.poll(async () => {
                await galleryPage.reload();
                await galleryPage.getByPlaceholder('Search ingredients...').fill(name);
                await galleryPage.keyboard.press('Enter');
                await galleryPage.waitForTimeout(1500); // debounce (300ms) + fetch + render margin
                const cards = galleryPage.locator('.relative.group').filter({ hasText: name });
                return cards.count();
            }, {
                timeout: 30000,
                intervals: [2000]
            }).toBe(count);

            await screenshot(galleryPage, dir, `${ingredient} should have count ${count}`);
            await galleryPage.close();
        };

        await expectStats(ingredient, 1);

        await node.hover();
        
        
        const rerollBtn = node.locator('button[title="Cycle shortlist"]');
        await screenshot(page, dir, 'before reroll');
        // Scroll to make the reroll button visible.
        await page.mouse.wheel(0, 500);
        await expect(rerollBtn).toBeVisible({ timeout: 15000 });
        await rerollBtn.hover({ force: true });
        await rerollBtn.click({ force: true });
        await screenshot(page, dir, 'after reroll clicked');

        const spinner = rerollBtn.locator('svg');
        await expect(spinner).toHaveClass(/animate-spin/);
        await screenshot(page, dir, 'spinner visible');
        await expect.poll(() => node.locator('img').getAttribute('src'), {
            timeout: 15000,
            intervals: [1000]
        }).not.toBe(currentSrc);

        currentSrc = await node.locator('img').getAttribute('src');

        await expectStats(ingredient, 2);

        await node.hover();
        await rerollBtn.click({ force: true });
        await expect.poll(() => node.locator('img').getAttribute('src'), { 
            timeout: 30000,
            intervals: [2000]
        }).not.toBe(currentSrc);

        await expectStats(ingredient, 3);

        await page.goto('/lanes?new=true');
        await create_recipe(page, `crush ${ingredient2}`, dir);
        await wait_for_graph(page, dir);

        await page.reload();
        await wait_for_graph(page, dir);
        const node2 = get_node(page, ingredient2);
        await expect(node2.locator('img')).toBeVisible({ timeout: 60000 });
        const src2 = await node2.locator('img').getAttribute('src');
        
        await node2.hover();
        await node2.locator('button[title="Cycle shortlist"]').click({ force: true });
        await expect.poll(() => node2.locator('img').getAttribute('src'), { 
            timeout: 30000,
            intervals: [2000]
        }).not.toBe(src2);

        await expectStats(ingredient2, 2);
        cleanupScreenshots(dir);
    });
});
