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
 * Regression test for issue #278 — "Graph resets when deleting a node in
 * notation view" (reported on mobile).
 *
 * The notation/timeline (timeline2 "Classic Timeline") view's delete handler
 * used to mutate only local state: it never persisted the delete and never
 * flagged the node as pending-deleted, so the next Firestore snapshot (or a
 * reload) brought the node straight back.
 *
 * This is the user-visible outcome test that a unit test cannot fully cover:
 * delete a node in the timeline view, wait for the auto-save, hard-reload, and
 * assert the node is STILL gone. The unit test (tests/notation-delete.test.ts)
 * covers the snapshot-resurrection race deterministically; this covers the
 * persistence half end-to-end.
 */

import { test, expect } from './utils/fixtures';
import { create_recipe, wait_for_graph } from './utils/actions';

const NODE_SELECTOR = 'g[data-testid^="node-"]';

test.describe('notation-view delete persistence (issue #278)', () => {
    test('deleting a node in timeline view persists across a hard reload', async ({
        page,
        login,
    }) => {
        test.slow();
        await page.setViewportSize({ width: 1280, height: 800 });

        // ── create a recipe as owner so edits auto-save ───────────────────────
        await page.goto('/lanes?new=true');
        await login('notation-delete-user-' + Date.now());
        // "test eggs" is the mock AI's deterministic fixture: 3 nodes
        // (2 Eggs, 100g Flour, Mix). Free-form text would be split per LINE by
        // the mock, so a single-line recipe yields only one node.
        await create_recipe(page, 'test eggs');
        await wait_for_graph(page);
        await expect(page).toHaveURL(/id=/);
        const recipeUrl = page.url();

        // ── switch to the timeline2 view; wait on the auto-save POST ───────────
        const layoutSelect = page.locator('select[title="Layout Mode"]');
        await Promise.all([
            page.waitForResponse(
                r => r.request().method() === 'POST' && r.url().includes('/lanes'),
            ),
            layoutSelect.selectOption('timeline2'),
        ]);
        await expect(layoutSelect).toHaveValue('timeline2');

        // ── wait for the timeline nodes to render, then pick a target ──────────
        const nodes = page.locator(NODE_SELECTOR);
        await expect(nodes.first().locator('circle').first()).toBeVisible({ timeout: 15000 });

        // Delete "Mix" — the terminal action node. Nothing takes it as an input,
        // so removing it cannot leave another node with a dangling `inputs` ref
        // and the assertion stays about persistence, not layout recovery.
        // Waiting on this specific node also guarantees the timeline has finished
        // rendering before the count below is taken.
        const targetGroup = nodes.filter({ hasText: 'Mix' });
        await expect(targetGroup).toHaveCount(1, { timeout: 15000 });

        const countBefore = await nodes.count();
        expect(countBefore).toBeGreaterThan(1);
        const targetTestId = await targetGroup.getAttribute('data-testid');
        expect(targetTestId).toBeTruthy();

        // ── hover to reveal the per-node controls, then delete the node ───────
        await targetGroup.hover();
        const deleteControl = targetGroup.locator('[data-testid="node-delete"]');
        await expect(deleteControl).toBeVisible({ timeout: 10000 });

        // The delete triggers onSave → saveRecipeAction (a POST to /lanes).
        await Promise.all([
            page.waitForResponse(
                r => r.request().method() === 'POST' && r.url().includes('/lanes'),
            ),
            deleteControl.click({ force: true }),
        ]);

        // The node is gone locally straight away.
        await expect(page.locator(`[data-testid="${targetTestId}"]`)).toHaveCount(0, { timeout: 10000 });

        // ── hard reload and assert the delete PERSISTED (did not reset) ───────
        await page.goto(recipeUrl);
        await expect(layoutSelect).toHaveValue('timeline2', { timeout: 15000 });
        // The remaining nodes render again…
        await expect(page.locator(NODE_SELECTOR).first().locator('circle').first())
            .toBeVisible({ timeout: 15000 });
        // …but the deleted node did NOT come back.
        await expect(page.locator(`[data-testid="${targetTestId}"]`)).toHaveCount(0, { timeout: 15000 });
        await expect
            .poll(async () => page.locator(NODE_SELECTOR).count(), {
                timeout: 15000,
                message: 'deleted timeline node must stay deleted after reload',
            })
            .toBe(countBefore - 1);
    });
});
