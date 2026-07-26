import { test, expect } from './utils/fixtures';
import { deviceConfigs } from './utils/devices';
import { get_node, create_recipe, wait_for_graph } from './utils/actions';

/*
 * Issue #156 — the Forge/Visualize button.
 *
 * NEW recipe            → full parse (createVisualRecipeAction / parseRecipeGraph).
 * EXISTING recipe + edit → incremental AI *adjust* (adjustRecipeAction), so the
 *                          existing graph + node positions are preserved and the
 *                          input/recipe box is left completely untouched.
 *
 * Under MOCK_AI the parse of "test eggs" yields exactly {2 Eggs, 100g Flour,
 * Mix} and can NEVER invent an "Add sugar" node, whereas the adjust mock returns
 * a surgical patch that ADDS one node per "Added lines:" entry while preserving
 * the rest. So the presence of an "Add sugar" node after Forge is a clean,
 * deterministic proof that the adjust path (not a full re-parse) ran.
 */
test.describe('Issue #156 — Forge uses the adjust API for existing recipes', () => {
  const desktop = deviceConfigs.find(d => d.name === 'desktop')!;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(desktop.viewport);
  });

  test('existing recipe: edit text + Forge = incremental adjust (graph preserved, input untouched)', async ({ page, login }) => {
    test.slow();
    await page.goto('/lanes?new=true');
    await login('forge-adjust-user');

    // --- New recipe → FULL PARSE ---
    await create_recipe(page, 'test eggs');
    await wait_for_graph(page);
    const createdId = new URL(page.url()).searchParams.get('id');
    expect(createdId).toBeTruthy();

    await expect(get_node(page, '2 Eggs')).toBeVisible();
    await expect(get_node(page, '100g Flour')).toBeVisible();
    await expect(get_node(page, 'Mix')).toBeVisible();
    // A brand-new full parse of "test eggs" never produces an "Add sugar" node.
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Add sugar' })).toHaveCount(0);

    // --- Existing recipe: edit the source text and press Forge ---
    const input = page.getByPlaceholder('Paste recipe here...');
    await expect(input).toHaveValue('test eggs');
    await input.click();
    await input.fill('test eggs\nAdd sugar');
    await page.locator('button:has(svg.lucide-arrow-right)').click();

    // Adjust path: the surgical patch ADDS "Add sugar"...
    await expect(get_node(page, 'Add sugar')).toBeVisible({ timeout: 15000 });
    // ...while every pre-existing node survives (positions preserved by applyPatch).
    await expect(get_node(page, '2 Eggs')).toBeVisible();
    await expect(get_node(page, '100g Flour')).toBeVisible();
    await expect(get_node(page, 'Mix')).toBeVisible();

    // Incremental update stays on the same recipe (no fresh full-parse re-seed).
    expect(new URL(page.url()).searchParams.get('id')).toBe(createdId);

    // CRITICAL (the #204 regression): the input / recipe box is left untouched —
    // the edited text is still exactly what the user typed.
    await expect(input).toHaveValue('test eggs\nAdd sugar');
  });
});
