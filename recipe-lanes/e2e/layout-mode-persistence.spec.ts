import { test, expect } from './utils/fixtures';
import { screenshotDir } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';
import { create_recipe, wait_for_graph } from './utils/actions';

test.describe('Layout Persistence', () => {
  const desktop = deviceConfigs.find(d => d.name === 'desktop')!;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(desktop.viewport);
  });

  test('Mode alone should persist on refresh', async ({ page, login }) => {
    test.setTimeout(90000); 
    
    const dir = screenshotDir('layout-persistence-mode-only', desktop.name);
    
    // 1. Login and create recipe
    await page.goto('/lanes?new=true');
    await login('tester-user');
    await create_recipe(page, '2 eggs, 1 pan. fry eggs in pan for 5 min.', dir);
    await wait_for_graph(page, dir);
    
    // Verify default layout mode is NOT timeline2
    const layoutSelect = page.locator('select[title="Layout Mode"]');
    await expect(layoutSelect).not.toHaveValue('timeline2');

    // 2. Change layout to 'timeline2'
    await layoutSelect.selectOption('timeline2');
    await page.waitForTimeout(3000); // Give it time to save (if it was implemented)
    
    // Check that timeline2 is selected
    await expect(layoutSelect).toHaveValue('timeline2');

    // 3. Refresh the page
    await page.reload();
    
    // Instead of wait_for_graph (which looks for react-flow), we just wait for our node
    const textNode = page.getByText('Fry Eggs In Pan').first();
    await expect(textNode).toBeVisible({ timeout: 15000 });

    // 4. Verify persistence
    await expect(layoutSelect).toHaveValue('timeline2');
    console.log('Layout mode correctly persisted as "timeline2".');

    // 5. Move a node in Timeline2
    // The `<g>` doesn't have a reliable bounding box in Playwright, so we find the main circle inside it
    // Wait for the timeline to fully render
    await page.waitForTimeout(1000);
    const anyNodeCircle = page.locator('g[data-testid^="node-"] circle').first();
    await expect(anyNodeCircle).toBeVisible();
    
    const t2BoxBeforeMove = await anyNodeCircle.boundingBox();
    if (!t2BoxBeforeMove) throw new Error('Timeline2 node circle not found');
    console.log(`Timeline2 Node pos: x=${t2BoxBeforeMove.x}, y=${t2BoxBeforeMove.y}`);

    // Move the node from the center of the circle
    await page.mouse.move(t2BoxBeforeMove.x + t2BoxBeforeMove.width / 2, t2BoxBeforeMove.y + t2BoxBeforeMove.height / 2);
    await page.mouse.down();
    await page.mouse.move(t2BoxBeforeMove.x + t2BoxBeforeMove.width / 2 + 150, t2BoxBeforeMove.y + t2BoxBeforeMove.height / 2 + 100, { steps: 20 });
    await page.mouse.up();

    // Give it a moment to potentially save
    await page.waitForTimeout(2000);
    
    const t2BoxAfterMove = await anyNodeCircle.boundingBox();
    console.log(`Timeline2 Node moved to: x=${t2BoxAfterMove?.x}, y=${t2BoxAfterMove?.y}`);
    expect(t2BoxAfterMove!.x).toBeGreaterThan(t2BoxBeforeMove.x + 100);

    // Refresh the page
    await page.reload();
    await expect(layoutSelect).toHaveValue('timeline2');
    
    const t2RefreshedNodeCircle = page.locator('g[data-testid^="node-"] circle').first();
    await expect(t2RefreshedNodeCircle).toBeVisible({ timeout: 10000 });
    
    const t2BoxRefreshed = await t2RefreshedNodeCircle.boundingBox();
    console.log(`Timeline2 Node after refresh: x=${t2BoxRefreshed?.x}, y=${t2BoxRefreshed?.y}`);
    
    // THIS WILL FAIL IF THE CODE IS UNPATCHED
    expect(t2BoxRefreshed!.x).toBeGreaterThan(t2BoxBeforeMove.x + 50);
  });
});

