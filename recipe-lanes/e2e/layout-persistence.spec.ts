/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Layout-persistence regression tests.
 *
 * The production bug: user moves nodes in the graph editor, the app auto-saves,
 * but on reload the coordinates are back in the original dagre-computed positions.
 *
 * Root cause: once hasInitialLayoutRef.current = true (set after the first runLayout
 * call), the layout useEffect always takes the metadata-only path and never calls
 * runLayout(true) again — even when graph.layouts[mode] arrives for the first time
 * (the "two-snapshot" scenario: first Firestore snapshot has no layouts, second has them).
 *
 * These tests exercise that code path directly by:
 *   1. Loading a recipe so dagre runs and hasInitialLayoutRef = true.
 *   2. Using the admin SDK to write layout data into Firestore (simulating what
 *      happens after a save: layouts are now in the document but the React component
 *      already ran its initial layout without them).
 *   3. Waiting for the resulting onSnapshot to fire.
 *   4. Asserting the component DID apply the saved layout positions.
 *
 * The test FAILS before the fix (metadata-only path ignores the new layouts) and
 * PASSES after the fix (runLayout(true) is re-invoked when layouts change).
 */

import { test, expect } from './utils/fixtures';
import { Locator } from '@playwright/test';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { create_recipe, wait_for_graph, get_node } from './utils/actions';
import { setRecipeLayouts } from './utils/admin-utils';

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Reads the graph-coordinate position of a React Flow node from its CSS transform.
 * React Flow positions each .react-flow__node with an inline style:
 *   transform: translate(Xpx, Ypx)   or   translate3d(Xpx, Ypx, 0px)
 * These coordinates are in the graph's own coordinate space — they are NOT affected
 * by pan/zoom (which is applied to the parent .react-flow__viewport instead).
 */
async function readGraphPos(loc: Locator): Promise<{ x: number; y: number }> {
    const transform = await loc.evaluate((el: Element) => (el as HTMLElement).style.transform);
    const m = transform.match(/translate(?:3d)?\((-?[\d.]+)px[,\s]+(-?[\d.]+)px/);
    if (!m) throw new Error(`Cannot parse node transform: "${transform}"`);
    return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
}

/**
 * Collects { id, x, y } for every non-lane React Flow node visible on the page.
 * Runs inside page.evaluate so it has access to the live DOM.
 */
async function collectAllNodePositions(
    page: import('@playwright/test').Page,
): Promise<{ id: string; x: number; y: number }[]> {
    return page.evaluate(() => {
        // React Flow stores the node's data-id on the outer .react-flow__node element.
        const nodeEls = document.querySelectorAll(
            '.react-flow__node:not(.react-flow__node-lane)',
        );
        return Array.from(nodeEls)
            .map(el => {
                const id = (el as HTMLElement).getAttribute('data-id') ?? '';
                const transform = (el as HTMLElement).style.transform ?? '';
                const m = transform.match(/translate(?:3d)?\((-?[\d.]+)px[,\s]+(-?[\d.]+)px/);
                if (!m || !id) return null;
                return { id, x: parseFloat(m[1]), y: parseFloat(m[2]) };
            })
            .filter((n): n is { id: string; x: number; y: number } => n !== null);
    });
}

// ─── tests ──────────────────────────────────────────────────────────────────

test.describe('Layout persistence', () => {
    const TOLERANCE_PX = 8; // graph-coordinate tolerance for position comparisons

    /**
     * Core regression test for the two-snapshot bug.
     *
     * Sequence:
     *   load recipe (no layouts) → dagre runs → hasInitialLayoutRef = true
     *   → admin writes layouts with one node 400 px off from dagre position
     *   → onSnapshot fires (second snapshot, with layouts)
     *   → BUG:   metadata-only path, node stays at dagre position (test FAILS)
     *   → FIXED: runLayout(true) is re-invoked, node moves to saved position (test PASSES)
     */
    test('second onSnapshot with layouts repositions nodes (two-snapshot scenario)', async ({
        page,
        login,
    }) => {
        test.slow();
        const dir = screenshotDir('layout-persistence', 'desktop');
        await page.setViewportSize({ width: 1280, height: 800 });

        // ── Step 1: create a recipe and wait for the graph to render ──────────
        await page.goto('/lanes?new=true');
        await login('layout-persist-user-' + Date.now());
        await create_recipe(page, '3 Eggs\n1 Cup Flour\nMix eggs and flour together', dir);
        await wait_for_graph(page, dir);
        await expect(page).toHaveURL(/id=/);

        // ── Step 2: record dagre-computed positions for ALL nodes ─────────────
        // We need all positions so the admin-written layouts include every node.
        // calculateLayout's preservePositions branch requires at least one node
        // with x defined; if OTHER nodes lack x they snap to 0,0 — so we pass
        // complete layout data.
        const dagrePositions = await collectAllNodePositions(page);
        expect(dagrePositions.length).toBeGreaterThan(0);

        // Pick the first content node as the one we'll "move".
        const targetNodeId = dagrePositions[0].id;
        const dagrePos = dagrePositions[0];

        // The "saved" position is significantly offset from dagre — clearly different.
        const savedX = dagrePos.x + 400;
        const savedY = dagrePos.y + 300;

        await screenshot(page, dir, 'after-dagre-layout');

        // ── Step 3: write updated layouts directly to Firestore ───────────────
        // This simulates what happens after a save: the document now carries
        // layouts[dagre], but the React component's hasInitialLayoutRef is already
        // true from the initial dagre render.
        const recipeId = new URL(page.url()).searchParams.get('id')!;

        const newLayouts = dagrePositions.map(n =>
            n.id === targetNodeId
                ? { id: n.id, x: savedX, y: savedY }
                : { id: n.id, x: n.x, y: n.y },
        );
        await setRecipeLayouts(recipeId, { dagre: newLayouts });

        // ── Step 4: wait for the onSnapshot to fire and React to settle ───────
        // The Firestore emulator delivers updates quickly; 2 s is generous.
        await page.waitForTimeout(2000);
        await screenshot(page, dir, 'after-second-snapshot');

        // ── Step 5: assert the target node is at the saved position ───────────
        // With the bug the node stays at dagrePos (metadata-only path).
        // After the fix it moves to (savedX, savedY).
        const targetNodeLocator = page.locator(`.react-flow__node[data-id="${targetNodeId}"]`);
        await expect(targetNodeLocator).toBeVisible({ timeout: 5000 });

        const finalPos = await readGraphPos(targetNodeLocator);

        expect(
            Math.abs(finalPos.x - savedX),
            `x: expected ≈${savedX} but got ${finalPos.x} (was at dagre ${dagrePos.x})`,
        ).toBeLessThan(TOLERANCE_PX);
        expect(
            Math.abs(finalPos.y - savedY),
            `y: expected ≈${savedY} but got ${finalPos.y} (was at dagre ${dagrePos.y})`,
        ).toBeLessThan(TOLERANCE_PX);

        cleanupScreenshots(dir);
    });

    /**
     * Complementary end-to-end test: move a node, wait for auto-save, hard-reload,
     * verify the node is still at the moved position (not the dagre default).
     *
     * This exercises the full pipeline: drag → auto-save → reload → onSnapshot →
     * runLayout(true) → positions restored.
     */
    test('node positions persist through hard reload after drag-save', async ({
        page,
        login,
    }) => {
        test.slow();
        const dir = screenshotDir('layout-persistence-reload', 'desktop');
        await page.setViewportSize({ width: 1280, height: 800 });


        // ── Step 1: create recipe as owner ────────────────────────────────────
        await page.goto('/lanes?new=true');
        await login('layout-reload-user-' + Date.now());
        await create_recipe(page, '2 Eggs\n1 Cup Sugar\nWhisk eggs with sugar', dir);
        await wait_for_graph(page, dir);
        await expect(page).toHaveURL(/id=/);
        const recipeUrl = page.url();

        // ── Step 2: collect dagre positions and identify node to move ─────────
        const beforePositions = await collectAllNodePositions(page);
        expect(beforePositions.length).toBeGreaterThan(0);
        const targetId = beforePositions[0].id;
        const dagrePos = beforePositions[0];

        // ── Step 3: drag the node 350 px away ─────────────────────────────────
        const targetEl = page.locator(`.react-flow__node[data-id="${targetId}"]`);
        await expect(targetEl).toBeVisible({ timeout: 10000 });

        const box = await targetEl.boundingBox();
        expect(box).toBeTruthy();
        await targetEl.hover();
        await page.mouse.down();
        await page.mouse.move(
            box!.x + box!.width / 2 + 350,
            box!.y + box!.height / 2 + 250,
            { steps: 20 },
        );
        await page.mouse.up();
        await page.waitForTimeout(500);

        // ── Step 4: wait for auto-save notification ───────────────────────────
        await expect(page.getByText('Saved changes', { exact: false })).toBeVisible({
            timeout: 10000,
        });
        await screenshot(page, dir, 'after-save');

        // Capture where the node is NOW (post-drag, post-save, pre-reload).
        const savedPos = await readGraphPos(targetEl);
        // Sanity: confirm the node actually moved from its dagre position.
        expect(
            Math.abs(savedPos.x - dagrePos.x) + Math.abs(savedPos.y - dagrePos.y),
            'Node should have moved from its dagre position',
        ).toBeGreaterThan(50);

        // ── Step 5: hard reload ───────────────────────────────────────────────
        await page.goto(recipeUrl);
        await wait_for_graph(page, dir);
        // Allow runLayout to settle (includes any async fitView timer).
        await page.waitForTimeout(1500);
        await screenshot(page, dir, 'after-reload');

        // ── Step 6: verify position matches what was saved ────────────────────
        const targetAfterReload = page.locator(`.react-flow__node[data-id="${targetId}"]`);
        await expect(targetAfterReload).toBeVisible({ timeout: 10000 });

        const reloadedPos = await readGraphPos(targetAfterReload);

        expect(
            Math.abs(reloadedPos.x - savedPos.x),
            `x after reload: expected ≈${savedPos.x} but got ${reloadedPos.x}`,
        ).toBeLessThan(TOLERANCE_PX);
        expect(
            Math.abs(reloadedPos.y - savedPos.y),
            `y after reload: expected ≈${savedPos.y} but got ${reloadedPos.y}`,
        ).toBeLessThan(TOLERANCE_PX);

        cleanupScreenshots(dir);
    });
});
