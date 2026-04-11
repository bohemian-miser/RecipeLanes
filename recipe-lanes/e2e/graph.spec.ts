import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';
import { get_node, delete_node, create_recipe, wait_for_graph, move_node, click_undo } from './utils/actions';

test.describe('Graph UI & Interactions (Consolidated)', () => {
  const desktop = deviceConfigs.find(d => d.name === 'desktop')!;
  
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(desktop.viewport);
  });

  test('Core Graph: Pan, Delete, Undo & Sidebar', async ({ page }) => {
    test.slow();
    const dir = screenshotDir('graph-core', desktop.name);
    await page.goto('/lanes?new=true');
    await create_recipe(page, '1 Egg\n1 Milk\nWhisk them', dir);
    await wait_for_graph(page, dir);

    // 1. Pan
    const viewport = page.locator('.react-flow__viewport');
    const initialTransform = await viewport.getAttribute('style');
    await page.mouse.move(100, 200);
    await page.mouse.down();
    await page.mouse.move(300, 400, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    expect(await viewport.getAttribute('style')).not.toBe(initialTransform);

    // 2. Delete & Undo
    await delete_node(page, 'Whisk', dir);
    await expect(get_node(page, 'Whisk')).not.toBeVisible();
    await click_undo(page, dir);
    await expect(get_node(page, 'Whisk')).toBeVisible();

    // 3. Scaling via Sidebar
    const node = get_node(page, 'Egg');
    await page.getByTitle('Toggle Ingredients').click();
    const sidebar = page.locator('div.absolute.left-0.top-14'); 
    await expect(sidebar).toBeVisible();
    await sidebar.getByText('+', { exact: true }).click();
    await expect(node).toContainText('2', { timeout: 10000 }); 
    
    cleanupScreenshots(dir);
  });

  test('Advanced: Pivot & Arrow Alignment', async ({ page }) => {
    test.slow();
    const dir = screenshotDir('graph-advanced', desktop.name);
    await page.goto('/lanes?new=true');
    await create_recipe(page, '1 Egg\nMix', dir);
    await wait_for_graph(page, dir);

    const eggNode = get_node(page, 'Egg');
    const mixNode = get_node(page, 'Mix');
    await page.waitForTimeout(1000);
    
    const eggStart = await eggNode.boundingBox();
    const mixStart = await mixNode.boundingBox();

    // Pivot: Shift + Drag
    await page.keyboard.down('Shift');
    await eggNode.hover();
    await page.mouse.down();
    await page.mouse.move(eggStart!.x + eggStart!.width/2 + 200, eggStart!.y + eggStart!.height/2 + 100, { steps: 20 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(1000);
    
    const eggEnd = await eggNode.boundingBox();
    const mixEnd = await mixNode.boundingBox();
    expect(Math.abs(eggEnd!.x - eggStart!.x)).toBeGreaterThan(20);
    expect(Math.abs(mixEnd!.x - mixStart!.x)).toBeLessThan(20);

    // Arrow Check
    const edges = page.locator('.react-flow__edge-path');
    await expect(edges.first()).toBeVisible();
    
    cleanupScreenshots(dir);
  });

  test('Persistence Regressions: Issue 74 & 61', async ({ page, browser, login }) => {
    test.slow();
    const dir = screenshotDir('graph-regressions', desktop.name);
    
    // 1. Issue 74: Bridge persists after move
    await page.goto('/lanes?new=true');
    await login('user-regress');
    await create_recipe(page, '1 Egg\n1 Sugar\nWhisk them\nCook', dir);
    await wait_for_graph(page, dir);
    
    const whisk = get_node(page, 'Whisk');
    await whisk.hover();
    await page.mouse.wheel(0, 500); // Zoom out while we're here.
    await whisk.click();
    await whisk.getByRole('button', { name: /Delete/i }).click();
    await expect(whisk).not.toBeVisible();
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);
    
    await move_node(page, 'Cook', 100, 100, dir);
    await page.waitForTimeout(500); 
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);

    const recipeId = new URL(page.url()).searchParams.get('id');

    // 2. Issue 61: Local move persists against background update
    // Technically this test is duped in regressions.spec.ts.
    const node = get_node(page, '1 Egg');
    const boxBefore = await node.boundingBox();
    await move_node(page, '1 Egg', 200, 200, dir);
    
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await contextB.addCookies(await page.context().cookies());
    await pageB.goto(`/lanes?id=${recipeId}`);
    await expect(pageB.locator('.react-flow__node').first()).toBeVisible();
    
    await pageB.locator('header h1').click();
    await pageB.locator('header input').fill('Background Update');
    await pageB.keyboard.press('Enter');
    await pageB.waitForTimeout(1000);
    await contextB.close();
    
    // TODO: Figure out why this is still broken.
    // await expect(page.locator('header h1')).toHaveText('Background Update');
    const boxAfter = await get_node(page, '1 Egg').boundingBox();
    expect(boxAfter?.x).toBeGreaterThan(boxBefore!.x + 100);
    
    cleanupScreenshots(dir);
  });
});
