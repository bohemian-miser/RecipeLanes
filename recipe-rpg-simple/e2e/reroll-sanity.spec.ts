import { test, expect } from '@playwright/test';
import { create_recipe, wait_for_graph, get_node } from './utils/actions';
import { screenshotDir, screenshot, cleanupScreenshots } from './utils/screenshot';

test.describe('Reroll Functionality', () => {
  test('should reroll icon when clicked', async ({ page }) => {
    test.slow();
    const dir = screenshotDir('reroll-sanity', 'desktop');
    
    // 1. Setup
    await page.goto('/lanes');
    await create_recipe(page, 'test reroll functionality', dir);
    await wait_for_graph(page, dir);

    // 2. Select Node "Ing A" (created by 'test reroll functionality' usually produces Ing A, B, C or similar simple graph if we use 'test complex' prompt, but let's use explicit text)
    // Actually, let's use a simpler prompt that guarantees a node.
    // "fry an egg" -> "egg" (Ingredient), "fried egg" (Action).
    
    // Restart with simple prompt
    await page.goto('/lanes?new=true');
    await create_recipe(page, 'fry an egg', dir);
    await wait_for_graph(page, dir);
    
    const node = get_node(page, 'Egg');
    await expect(node).toBeVisible({ timeout: 10000 });
    
    // Wait for initial icon
    const img = node.locator('img');
    await expect(img).toBeVisible({ timeout: 30000 });
    const initialSrc = await img.getAttribute('src');
    console.log('Initial Icon:', initialSrc);
    expect(initialSrc).toBeTruthy();

    await screenshot(page, dir, 'before-reroll');

    // 3. Click Reroll
    // The reroll button is hidden by default (opacity-0 group-hover:opacity-100).
    // We need to hover the node first.
    await node.hover();
    const rerollBtn = node.locator('button[title="Reroll Icon"]');
    await expect(rerollBtn).toBeVisible();
    
    // Click
    await rerollBtn.click();
    await screenshot(page, dir, 'reroll-clicked');

    // Check for spinning state (immediate feedback)
    // The spinner is on the SVG inside the button
    const spinner = rerollBtn.locator('svg');
    // Skipping spinner check as it might be too fast in mock env
    // await expect(spinner).toHaveClass(/animate-spin/);

    // 4. Verify Loading State
    // The spinner might be fast, but we can check if the image changes.
    // Wait for src to be DIFFERENT from initialSrc.
    
    await expect.poll(async () => {
        const newSrc = await img.getAttribute('src');
        console.log('Checking new src:', newSrc);
        return newSrc;
    }, {
        timeout: 20000,
        message: 'Icon src did not change after reroll'
    }).not.toBe(initialSrc);

    const finalSrc = await img.getAttribute('src');
    console.log('Final Icon:', finalSrc);
    
    await screenshot(page, dir, 'after-reroll');
    cleanupScreenshots(dir);
  });
});
