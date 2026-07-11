import { test, expect } from './utils/fixtures';
import { deviceConfigs } from './utils/devices';
import { create_recipe, wait_for_graph } from './utils/actions';
import { setRecipeTitle } from './utils/admin-utils';

/**
 * Issue #139 — "can't see title on mobile".
 *
 * The lanes header is a single 56px row: logo + editable title on the left,
 * a nav/action cluster on the right. On a phone the right cluster is wider than
 * the viewport, so with the two sides competing for space the title container
 * was squeezed to zero width and the recipe title vanished. The fix gives the
 * title container flex priority (`flex-1 min-w-0`), makes the nav `shrink-0`,
 * and trims the nav's mobile footprint (drops labels + the secondary
 * Feedback/GitHub links on small screens) so the title always keeps real,
 * readable width.
 *
 * This guards the regression by seeding a deliberately long title on a phone
 * viewport and asserting the rendered `<h1>` keeps a meaningful (non-collapsed)
 * width. Before the fix its width was ~0; after, it truncates but stays visible.
 */
test.describe('Mobile header (issue #139)', () => {
  const phone = deviceConfigs.find(d => d.isMobile)!;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(phone.viewport);
  });

  test('long recipe title stays visible on a phone viewport', async ({ page }) => {
    await page.goto('/lanes?new=true');
    await create_recipe(page, '1 Egg\n1 Milk\nWhisk them');
    await wait_for_graph(page);

    // Seed a long title via an admin write; it reaches the open editor through
    // onSnapshot (same mechanism graph.spec relies on).
    const recipeId = new URL(page.url()).searchParams.get('id')!;
    const longTitle = 'A Very Long Recipe Title That Would Overflow The Mobile Header';
    await setRecipeTitle(recipeId, longTitle);

    const title = page.locator('header h1');
    // textContent is the full string even while CSS-truncated — confirms the
    // background update landed and the title is the one we're measuring.
    await expect(title).toHaveText(longTitle, { timeout: 15000 });
    await expect(title).toBeVisible();

    // The regression: the nav cluster used to collapse this to ~0px wide.
    const box = await title.boundingBox();
    expect(box, 'title should have a bounding box').not.toBeNull();
    expect(box!.width).toBeGreaterThan(40);
  });
});
