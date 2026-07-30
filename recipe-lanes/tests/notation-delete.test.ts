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
 * Regression tests for issue #278 — "Graph resets when deleting a node in
 * notation view" (reported on mobile).
 *
 * Root cause: the notation/timeline view's delete handler
 * (components/recipe-lanes/timeline-view.tsx `deleteNode`) mutated only local
 * Zustand state via `setGraph` and never called `markNodeDeleted`. The
 * `pendingDeletedIds` list is the ONLY thing that stops `mergeSnapshot` from
 * re-merging a still-present-on-server node back into the local graph, so the
 * next Firestore snapshot (e.g. an icon write-back, or the listener
 * reconnecting after the app was backgrounded on mobile) silently resurrected
 * the node and reverted the graph to its saved state — the reported "resets to
 * how it was at the start".
 *
 * These tests drive the store the same way the fixed component now does:
 *   delete  → deleteNodeWithUndo(id)          + persist via onSave
 *   undo    → store.undo() (single history, issue #216) — reconciles flags
 * and assert that a subsequent snapshot behaves correctly.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useRecipeStore } from '../lib/stores/recipe-store';
import { RecipeGraph, RecipeNode } from '../lib/recipe-lanes/types';

function makeNode(id: string, overrides: Partial<RecipeNode> = {}): RecipeNode {
    return {
        id,
        laneId: 'lane-1',
        text: `Node ${id}`,
        visualDescription: `visual-${id}`,
        type: 'ingredient',
        ...overrides,
    } as RecipeNode;
}

function makeGraph(nodes: RecipeNode[]): RecipeGraph {
    return { lanes: [], nodes };
}

const ids = (g: RecipeGraph | null) => (g?.nodes ?? []).map(n => n.id);

/**
 * Drives the store exactly as TimelineView's `deleteNode` now does (issue
 * #216 unified this on the store): one action that removes the node, pushes a
 * history entry and records the pending-delete flag.
 */
function notationDelete(nodeId: string) {
    useRecipeStore.getState().deleteNodeWithUndo(nodeId);
}

describe('notation-view delete (issue #278)', () => {
    beforeEach(() => useRecipeStore.getState().reset());

    it('does NOT resurrect a deleted node when a later snapshot still contains it', () => {
        // Initial load of a 3-node recipe.
        useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a'), makeNode('b'), makeNode('c')]));

        // User deletes 'b' in notation view (fixed handler).
        notationDelete('b');
        assert.deepEqual(ids(useRecipeStore.getState().graph), ['a', 'c']);
        assert.deepEqual(useRecipeStore.getState().pendingDeletedIds, ['b']);

        // A stale snapshot arrives before the delete has propagated (server still
        // has 'b', e.g. an icon write-back or a reconnecting mobile listener).
        useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a'), makeNode('b'), makeNode('c')]));

        // The graph must NOT reset to its 3-node saved state.
        assert.deepEqual(ids(useRecipeStore.getState().graph), ['a', 'c'],
            'deleted node must stay deleted after a stale snapshot');
        assert.deepEqual(useRecipeStore.getState().pendingDeletedIds, ['b'],
            'the pending flag survives until the delete is confirmed on the server');
    });

    it('reproduces the bug when markNodeDeleted is omitted (setGraph only)', () => {
        useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a'), makeNode('b'), makeNode('c')]));

        // Old, buggy handler: local removal only, no pending-delete flag.
        const g = useRecipeStore.getState().graph!;
        useRecipeStore.getState().setGraph({ ...g, nodes: g.nodes.filter(n => n.id !== 'b') });
        assert.deepEqual(ids(useRecipeStore.getState().graph), ['a', 'c']);

        // Next snapshot silently brings 'b' back — the graph "resets to how it was".
        useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a'), makeNode('b'), makeNode('c')]));
        assert.deepEqual(ids(useRecipeStore.getState().graph), ['a', 'b', 'c'],
            'without markNodeDeleted the deleted node is resurrected (the reported bug)');
    });

    it('clears the pending flag once the deletion is confirmed on the server', () => {
        useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a'), makeNode('b'), makeNode('c')]));
        notationDelete('b');

        // The delete is persisted; the server now echoes a snapshot without 'b'.
        useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a'), makeNode('c')]));

        assert.deepEqual(ids(useRecipeStore.getState().graph), ['a', 'c']);
        assert.deepEqual(useRecipeStore.getState().pendingDeletedIds, [],
            'pending flag is cleared once the node is absent from an incoming snapshot');
    });

    describe('undo after delete', () => {
        it('clears the pending flag so a restored node accepts future snapshot updates', () => {
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a'), makeNode('b'), makeNode('c')]));
            notationDelete('b');
            assert.deepEqual(useRecipeStore.getState().pendingDeletedIds, ['b']);

            // Undo restores the prior 3-node graph AND clears the pending
            // flags (the store's single history — issue #216 — does the
            // reconciliation the old view-local undo did by hand).
            useRecipeStore.getState().undo();
            assert.deepEqual(useRecipeStore.getState().pendingDeletedIds, []);

            // A later snapshot updating the restored node must be applied, not suppressed.
            useRecipeStore.getState().mergeSnapshot(
                makeGraph([makeNode('a'), makeNode('b', { text: 'Updated b' }), makeNode('c')]),
            );
            const b = useRecipeStore.getState().graph!.nodes.find(n => n.id === 'b');
            assert.equal(b?.text, 'Updated b', 'restored node receives snapshot updates after unmark');
        });

        it('would keep suppressing the restored node if the pending flag were left set', () => {
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a'), makeNode('b'), makeNode('c')]));
            notationDelete('b');

            // Restore WITHOUT clearing the flag (the pre-fix undo path).
            useRecipeStore.getState().setGraph(makeGraph([makeNode('a'), makeNode('b'), makeNode('c')]));

            // The stale flag makes mergeSnapshot drop the incoming 'b', so its
            // update is lost and the node is stuck on the local (old) copy.
            useRecipeStore.getState().mergeSnapshot(
                makeGraph([makeNode('a'), makeNode('b', { text: 'Updated b' }), makeNode('c')]),
            );
            const b = useRecipeStore.getState().graph!.nodes.find(n => n.id === 'b');
            assert.equal(b?.text, 'Node b', 'stale pending flag suppresses the update (why unmark is required)');
            assert.deepEqual(useRecipeStore.getState().pendingDeletedIds, ['b']);
        });
    });

    describe('unmarkNodesDeleted', () => {
        it('removes only the given ids from pendingDeletedIds', () => {
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a'), makeNode('b'), makeNode('c')]));
            useRecipeStore.getState().markNodeDeleted('a');
            useRecipeStore.getState().markNodeDeleted('b');
            assert.deepEqual(useRecipeStore.getState().pendingDeletedIds, ['a', 'b']);

            useRecipeStore.getState().unmarkNodesDeleted(['a', 'z']);
            assert.deepEqual(useRecipeStore.getState().pendingDeletedIds, ['b']);
        });

        it('keeps the array reference stable when nothing matches', () => {
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a')]));
            useRecipeStore.getState().markNodeDeleted('a');
            const before = useRecipeStore.getState().pendingDeletedIds;

            useRecipeStore.getState().unmarkNodesDeleted(['x', 'y']);
            assert.equal(useRecipeStore.getState().pendingDeletedIds, before,
                'no-op unmark preserves the reference');
        });
    });
});
