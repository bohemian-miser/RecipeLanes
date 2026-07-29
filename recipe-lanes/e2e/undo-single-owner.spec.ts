import { test, expect } from './utils/fixtures';
import { deviceConfigs } from './utils/devices';
import { get_node, create_recipe, wait_for_graph, move_node } from './utils/actions';
import { getRecipeGraph } from './utils/admin-utils';

/*
 * Issue #216 — one Ctrl+Z must undo exactly ONE user action.
 *
 * Before the fix, two window-level Ctrl+Z listeners were registered at once:
 *   - app/lanes/page.tsx        → Zustand undoStack (graph snapshots)
 *   - react-flow-diagram.tsx    → useHistoryManager (ReactFlow node/edge snapshots)
 * With both stacks non-empty, a single keypress popped BOTH: the store graph
 * reverted one state (e.g. an AI adjustment) while ReactFlow reverted a
 * different one (e.g. a drag). The two sources then disagreed and
 * buildGraphForSave could persist the desynced result.
 *
 * Scenario (mirrors the issue repro):
 *   1. Create a recipe (full parse under MOCK_AI: {2 Eggs, 100g Flour, Mix}).
 *   2. Forge-adjust to add an "Add sugar" node   → graph-level undoable action.
 *   3. Drag the "Mix" node                        → position-level undoable action.
 *   4. Ctrl+Z once  → ONLY the drag reverts: "Add sugar" must still exist,
 *      and Mix must be back at its pre-drag position.
 *   5. Ctrl+Z again → the adjustment reverts: "Add sugar" disappears.
 *   6. Cross-subsystem: after the post-undo autosave, Firestore must agree
 *      with the screen at each step (no half-undone graph persisted).
 */
test.describe('Issue #216 — single undo owner', () => {
  const desktop = deviceConfigs.find(d => d.name === 'desktop')!;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(desktop.viewport);
  });

  test('one Ctrl+Z reverts exactly one action (drag first, then adjustment)', async ({ page, login }) => {
    test.slow();
    await page.goto('/lanes?new=true');
    await login('undo-owner-user');

    // ── 1. Create recipe ────────────────────────────────────────────────────
    await create_recipe(page, 'test eggs');
    await wait_for_graph(page);
    const recipeId = new URL(page.url()).searchParams.get('id');
    expect(recipeId).toBeTruthy();
    await expect(get_node(page, 'Mix')).toBeVisible();

    // ── 2. Graph-level action: Forge-adjust adds "Add sugar" ───────────────
    const input = page.getByPlaceholder('Paste recipe here...');
    await input.click();
    await input.fill('test eggs\nAdd sugar');
    await page.locator('button:has(svg.lucide-arrow-right)').click();
    await expect(get_node(page, 'Add sugar')).toBeVisible({ timeout: 15000 });

    // ── 3. Position-level action: drag "Mix" ────────────────────────────────
    const mix = get_node(page, 'Mix');
    const preDragTransform = await mix.evaluate(
      (el: Element) => (el as HTMLElement).style.transform,
    );
    await move_node(page, 'Mix', 250, 150);
    const postDragTransform = await mix.evaluate(
      (el: Element) => (el as HTMLElement).style.transform,
    );
    expect(postDragTransform).not.toBe(preDragTransform);

    // ── 4. First Ctrl+Z: ONLY the drag reverts ──────────────────────────────
    await page.keyboard.press('Control+z');

    // The drag is undone: Mix returns to its pre-drag position.
    await expect
      .poll(async () => mix.evaluate((el: Element) => (el as HTMLElement).style.transform), {
        timeout: 5000,
      })
      .toBe(preDragTransform);

    // The adjustment is NOT undone: "Add sugar" survives — on screen…
    await expect(get_node(page, 'Add sugar')).toBeVisible();
    // …and stays on screen (guards against the desync effect removing it a
    // beat later when the store graph and ReactFlow disagree).
    await page.waitForTimeout(1500);
    await expect(get_node(page, 'Add sugar')).toBeVisible();

    // Cross-subsystem: the persisted graph still contains "Add sugar".
    await expect
      .poll(
        async () => {
          const g = await getRecipeGraph(recipeId!);
          return g?.nodes?.some((n: any) => n.text === 'Add sugar');
        },
        { timeout: 15000 },
      )
      .toBe(true);

    // ── 5. Second Ctrl+Z: the adjustment reverts ────────────────────────────
    await page.keyboard.press('Control+z');
    await expect(get_node(page, 'Add sugar')).not.toBeVisible({ timeout: 10000 });
    // The original nodes are intact.
    await expect(get_node(page, 'Mix')).toBeVisible();
    await expect(get_node(page, '2 Eggs')).toBeVisible();
    await expect(get_node(page, '100g Flour')).toBeVisible();

    // ── 6. Ctrl+Shift+Z: redo restores the adjustment ───────────────────────
    // (Regression: `e.key === 'z'` never matched the uppercase 'Z' the browser
    // reports while Shift is held, so this chord was silently dead.)
    await page.keyboard.press('Control+Shift+z');
    await expect(get_node(page, 'Add sugar')).toBeVisible({ timeout: 10000 });
  });
});
