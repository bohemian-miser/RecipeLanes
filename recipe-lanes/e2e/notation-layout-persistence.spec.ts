import { test, expect } from './utils/fixtures';
import { Locator } from '@playwright/test';
import { create_recipe, wait_for_graph } from './utils/actions';
import { debugShot } from './utils/debug-shot';

/*
 * Issue #268 — Notation mode does not save layout.
 *
 * Node drags in Notation mode ARE written to graph.layouts['notation'] by
 * buildGraphForSave, but runLayout never applies them on restore: the
 * `isNotation` branch unconditionally recomputes the spine layout from
 * scratch. So a drag → save → reload (or a mode round-trip) snaps every
 * node back to the computed layout, silently discarding the user's work.
 *
 * These tests mirror e2e/layout-persistence.spec.ts's dagre tests, in
 * notation mode.
 */

const TOLERANCE_PX = 5;

async function readGraphPos(loc: Locator): Promise<{ x: number; y: number }> {
    const transform = await loc.evaluate((el: Element) => (el as HTMLElement).style.transform);
    const m = transform.match(/translate(?:3d)?\((-?[\d.]+)px[,\s]+(-?[\d.]+)px/);
    if (!m) throw new Error(`unparseable transform: ${transform}`);
    return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
}

test.describe('Issue #268 — notation mode layout persistence', () => {
    test('notation drag survives hard reload', async ({ page, login }) => {
        test.slow();
        await page.setViewportSize({ width: 1280, height: 800 });

        // ── 1. Create recipe, switch to Notation mode ─────────────────────────
        await page.goto('/lanes?new=true');
        await login('notation-layout-user-' + Date.now());
        await create_recipe(page, '2 Eggs\n1 Cup Sugar\nWhisk eggs with sugar');
        await wait_for_graph(page);
        const recipeUrl = page.url();

        const layoutSelect = page.locator('select[title="Layout Mode"]');
        await layoutSelect.selectOption('notation');
        await wait_for_graph(page);

        // ── 2. Drag a real (non-station) node 250px away ──────────────────────
        // Station badges are synthetic and not draggable targets for this test.
        // Resolve the node id FIRST, then pin an id-based locator for every
        // read and the drag: hasText is a case-insensitive substring match, so
        // 'Eggs' hits both the "2 Eggs" leaf and the "Whisk eggs with sugar"
        // verb, and .first() re-resolves by DOM order — which changes after a
        // drag (nodes re-sort by Y for the painter's algorithm).
        const picked = page
            .locator('.react-flow__node:not(.react-flow__node-notation-station)')
            .filter({ hasText: 'Eggs' })
            .first();
        await expect(picked).toBeVisible({ timeout: 10000 });
        const targetId = await picked.getAttribute('data-id');
        const target = page.locator(`.react-flow__node[data-id="${targetId}"]`);
        const freshPos = await readGraphPos(target);

        const box = await target.boundingBox();
        expect(box).toBeTruthy();
        await target.hover();
        await page.mouse.down();
        await page.mouse.move(box!.x + box!.width / 2 + 250, box!.y + box!.height / 2 + 180, { steps: 20 });
        await page.mouse.up();

        await expect
            .poll(async () => {
                const p = await readGraphPos(target);
                return Math.abs(p.x - freshPos.x) + Math.abs(p.y - freshPos.y);
            }, { timeout: 5000 })
            .toBeGreaterThan(50);

        // ── 3. Wait for the autosave ──────────────────────────────────────────
        await expect(page.getByText('Saved changes', { exact: false })).toBeVisible({
            timeout: 15000,
        });
        const savedPos = await readGraphPos(target);
        await debugShot(page, 'notation-after-save');

        // ── 4. Hard reload; recipe opens in notation mode (layoutMode persists)
        await page.goto(recipeUrl);
        await wait_for_graph(page);
        await debugShot(page, 'notation-after-reload');
        await expect(layoutSelect).toHaveValue('notation', { timeout: 10000 });

        // ── 5. The dragged position must be restored, not the fresh layout ────
        const targetAfterReload = page.locator(`.react-flow__node[data-id="${targetId}"]`);
        await expect(targetAfterReload).toBeVisible({ timeout: 10000 });
        await expect
            .poll(async () => {
                const p = await readGraphPos(targetAfterReload);
                return Math.abs(p.x - savedPos.x) + Math.abs(p.y - savedPos.y);
            }, {
                timeout: 10000,
                message: `node should restore to dragged position (${savedPos.x}, ${savedPos.y}), not snap back to (${freshPos.x}, ${freshPos.y})`,
            })
            .toBeLessThan(TOLERANCE_PX * 2);
    });

    test('notation drag survives a mode round-trip (notation → dagre → notation)', async ({ page, login }) => {
        test.slow();
        await page.setViewportSize({ width: 1280, height: 800 });

        await page.goto('/lanes?new=true');
        await login('notation-roundtrip-user-' + Date.now());
        await create_recipe(page, '2 Eggs\n1 Cup Sugar\nWhisk eggs with sugar');
        await wait_for_graph(page);

        const layoutSelect = page.locator('select[title="Layout Mode"]');
        await layoutSelect.selectOption('notation');
        await wait_for_graph(page);

        // Resolve the node id FIRST, then pin an id-based locator for every
        // read and the drag: hasText is a case-insensitive substring match, so
        // 'Eggs' hits both the "2 Eggs" leaf and the "Whisk eggs with sugar"
        // verb, and .first() re-resolves by DOM order — which changes after a
        // drag (nodes re-sort by Y for the painter's algorithm).
        const picked = page
            .locator('.react-flow__node:not(.react-flow__node-notation-station)')
            .filter({ hasText: 'Eggs' })
            .first();
        await expect(picked).toBeVisible({ timeout: 10000 });
        const targetId = await picked.getAttribute('data-id');
        const target = page.locator(`.react-flow__node[data-id="${targetId}"]`);
        const freshPos = await readGraphPos(target);

        const box = await target.boundingBox();
        expect(box).toBeTruthy();
        await target.hover();
        await page.mouse.down();
        await page.mouse.move(box!.x + box!.width / 2 + 250, box!.y + box!.height / 2 + 180, { steps: 20 });
        await page.mouse.up();
        await expect
            .poll(async () => {
                const p = await readGraphPos(target);
                return Math.abs(p.x - freshPos.x) + Math.abs(p.y - freshPos.y);
            }, { timeout: 5000 })
            .toBeGreaterThan(50);
        await expect(page.getByText('Saved changes', { exact: false })).toBeVisible({ timeout: 15000 });
        const savedPos = await readGraphPos(target);

        // Round-trip through dagre and back.
        await layoutSelect.selectOption('dagre');
        await wait_for_graph(page);
        await layoutSelect.selectOption('notation');
        await wait_for_graph(page);

        const targetBack = page.locator(`.react-flow__node[data-id="${targetId}"]`);
        await expect(targetBack).toBeVisible({ timeout: 10000 });
        await expect
            .poll(async () => {
                const p = await readGraphPos(targetBack);
                return Math.abs(p.x - savedPos.x) + Math.abs(p.y - savedPos.y);
            }, {
                timeout: 10000,
                message: `node should return to dragged position (${savedPos.x}, ${savedPos.y}) after mode round-trip`,
            })
            .toBeLessThan(TOLERANCE_PX * 2);
    });
});
