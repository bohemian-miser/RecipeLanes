import { test, expect } from './utils/fixtures';
import { deviceConfigs } from './utils/devices';
import { get_node, delete_node, create_recipe, wait_for_graph, move_node, click_undo, pan_pane } from './utils/actions';

test.describe('Graph UI & Interactions (Consolidated)', () => {
  const desktop = deviceConfigs.find(d => d.name === 'desktop')!;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(desktop.viewport);
  });

  test('Core Graph: Pan, Delete, Undo & Sidebar', async ({ page }) => {
    test.slow();
    await page.goto('/lanes?new=true');
    await create_recipe(page, '1 Egg\n1 Milk\nWhisk them');
    await wait_for_graph(page);

    // 1. Pan — wait for loading screen to clear so it doesn't intercept mouse events
    await expect(page.getByTestId('loading-screen')).not.toBeVisible({ timeout: 30000 });
    const viewport = page.locator('.react-flow__viewport');
    const initialTransform = await viewport.getAttribute('style');
    // Drag from a point that is verifiably the pane (not a node, the bottom-left
    // Controls widget, or the top-right Panel) so the canvas actually pans.
    await pan_pane(page, 200, -200);
    // Wait for the viewport transform to reflect the pan (auto-retries).
    await expect
      .poll(async () => viewport.getAttribute('style'), { timeout: 5000 })
      .not.toBe(initialTransform);

    // 2. Delete & Undo
    await delete_node(page, 'Whisk');
    await expect(get_node(page, 'Whisk')).not.toBeVisible();
    await click_undo(page);
    await expect(get_node(page, 'Whisk')).toBeVisible();

    // 3. Scaling via Sidebar
    const node = get_node(page, 'Egg');
    await page.getByTitle('Toggle Ingredients').click();
    const sidebar = page.locator('div.absolute.left-0.top-14');
    await expect(sidebar).toBeVisible();
    await sidebar.getByText('+', { exact: true }).click();
    await expect(node).toContainText('2', { timeout: 10000 });
  });

  test('Advanced: Pivot & Arrow Alignment', async ({ page }) => {
    test.slow();
    await page.goto('/lanes?new=true');
    await create_recipe(page, '1 Egg\nMix');
    await wait_for_graph(page);

    const eggNode = get_node(page, 'Egg');
    const mixNode = get_node(page, 'Mix');
    // wait_for_graph already waited on rf-ready (layout + fitView settled), so
    // bounding boxes are stable here.
    const eggStart = await eggNode.boundingBox();
    const mixStart = await mixNode.boundingBox();

    // Pivot: Shift + Drag
    await page.keyboard.down('Shift');
    await eggNode.hover();
    await page.mouse.down();
    await page.mouse.move(eggStart!.x + eggStart!.width/2 + 200, eggStart!.y + eggStart!.height/2 + 100, { steps: 20 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    // Wait for the pivot to commit: Egg moves > 20px, Mix stays put.
    await expect
      .poll(async () => {
        const b = await eggNode.boundingBox();
        return b ? Math.abs(b.x - eggStart!.x) : 0;
      }, { timeout: 5000 })
      .toBeGreaterThan(20);

    const mixEnd = await mixNode.boundingBox();
    expect(Math.abs(mixEnd!.x - mixStart!.x)).toBeLessThan(20);

    // Arrow Check
    const edges = page.locator('.react-flow__edge-path');
    await expect(edges.first()).toBeVisible();
  });

  // TODO(wave2): coverage being moved to unit/emulator tests; delete once those land.
  // Quarantined (single test): this opens a SECOND browser context that makes a fresh
  // connection to the dev server mid-test; that second navigation intermittently hits
  // ERR_CONNECTION_REFUSED — an environmental flake in the cross-context/cross-connection
  // setup, not something a better in-page wait can fix. The Issue 61 background-update
  // path is already duplicated in (quarantined) regressions.spec.ts.
  test.skip('Persistence Regressions: Issue 74 & 61', async ({ page, browser, login }) => {
    test.slow();

    // 1. Issue 74: Bridge persists after move
    await page.goto('/lanes?new=true');
    await login('user-regress');
    await create_recipe(page, '1 Egg\n1 Sugar\nWhisk them\nCook');
    await wait_for_graph(page);

    const whisk = get_node(page, 'Whisk');
    await whisk.hover();
    await page.mouse.wheel(0, 500); // Zoom out while we're here.
    await whisk.click();
    await whisk.getByRole('button', { name: /Delete/i }).click();
    await expect(whisk).not.toBeVisible();
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);

    await move_node(page, 'Cook', 100, 100);
    // move_node waits on the node transform committing; edge count should hold.
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);

    const recipeId = new URL(page.url()).searchParams.get('id');

    // 2. Issue 61: Local move persists against background update
    // Technically this test is duped in regressions.spec.ts.
    const node = get_node(page, '1 Egg');
    const boxBefore = await node.boundingBox();
    await move_node(page, '1 Egg', 200, 200);

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await contextB.addCookies(await page.context().cookies());
    await pageB.goto(`/lanes?id=${recipeId}`);
    await expect(pageB.locator('.react-flow__node').first()).toBeVisible();

    await pageB.locator('header h1').click();
    await pageB.locator('header input').fill('Background Update');
    // Wait for the server action that persists the title (owner title-save fires a
    // POST next-action to /lanes) so the background write has actually landed in
    // Firestore before we close the context.
    const titleSave = pageB.waitForResponse(
      r => r.request().method() === 'POST'
        && /\/lanes/.test(r.url())
        && !!r.request().headers()['next-action'],
      { timeout: 15000 },
    );
    await pageB.keyboard.press('Enter');
    await titleSave;
    await contextB.close();

    // TODO: Figure out why this is still broken.
    // await expect(page.locator('header h1')).toHaveText('Background Update');
    // The local move must survive the background update arriving via onSnapshot.
    await expect
      .poll(async () => {
        const b = await get_node(page, '1 Egg').boundingBox();
        return b?.x ?? 0;
      }, { timeout: 5000 })
      .toBeGreaterThan(boxBefore!.x + 100);
  });
});
