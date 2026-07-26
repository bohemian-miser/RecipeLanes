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

/*
 * Regression tests for Issue #278 — "Graph resets when deleting a node in the
 * timeline/notation view".
 *
 * Root cause: the timeline (Classic) view deleted a node with a plain
 * `setGraph` filter and never recorded the deletion in the store's
 * `pendingDeletedIds` guard. Because a node delete is not immediately persisted
 * to Firestore, a background server write (e.g. resolveRecipeIcons writing an
 * icon shortlist back) produces a snapshot that STILL contains the deleted node.
 * `mergeSnapshot` then re-added it — the graph visibly "reset to how it was at
 * the start". The ReactFlow/notation path avoided this by calling
 * `markNodeDeleted`; the fix routes the timeline delete through the same guard.
 *
 * These tests pin the store contract that the component fix relies on: the
 * guard suppresses resurrection, a naive delete does not, and undo reconciles
 * the guard so a restored node is not silently re-deleted.
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
        x: 0,
        y: 0,
        ...overrides,
    };
}

function makeGraph(nodes: RecipeNode[]): RecipeGraph {
    return { lanes: [], nodes };
}

function ids(graph: RecipeGraph | null): string[] {
    return (graph?.nodes ?? []).map(n => n.id).sort();
}

function resetStore() {
    useRecipeStore.getState().reset();
}

describe('Issue #278 — node deletion survives a background snapshot', () => {
    beforeEach(() => resetStore());

    it('BUG REPRO: a naive setGraph delete is resurrected by a stale snapshot', () => {
        const store = useRecipeStore.getState;

        // Initial load: two nodes.
        store().mergeSnapshot(makeGraph([makeNode('n1'), makeNode('n2')]));

        // Naive delete (the OLD timeline behaviour): filter the node out via
        // setGraph only, WITHOUT recording it in pendingDeletedIds.
        const g = store().graph!;
        store().setGraph({ ...g, nodes: g.nodes.filter(n => n.id !== 'n2') });
        assert.deepEqual(ids(store().graph), ['n1'], 'node removed locally');

        // A background write (e.g. resolveRecipeIcons) fires a snapshot built
        // from the pre-delete Firestore state — n2 is still present.
        store().mergeSnapshot(makeGraph([makeNode('n1'), makeNode('n2')]));

        // Without the guard the deleted node comes back — the reported bug.
        assert.deepEqual(ids(store().graph), ['n1', 'n2'],
            'demonstrates the bug: n2 is resurrected by the stale snapshot');
    });

    it('FIX: markNodeDeleted suppresses the deleted node in a stale snapshot', () => {
        const store = useRecipeStore.getState;

        store().mergeSnapshot(makeGraph([makeNode('n1'), makeNode('n2')]));

        // Correct delete: route through the resurrection guard.
        store().markNodeDeleted('n2');
        store().setDirty(true);
        assert.deepEqual(ids(store().graph), ['n1'], 'node removed from graph');
        assert.ok(store().pendingDeletedIds.includes('n2'), 'delete recorded in guard');
        assert.equal(store().isDirty, true, 'recipe marked dirty');

        // Same stale snapshot that still contains n2.
        store().mergeSnapshot(makeGraph([makeNode('n1'), makeNode('n2')]));

        assert.deepEqual(ids(store().graph), ['n1'],
            'n2 stays deleted — the guard filtered it out of the incoming snapshot');
        assert.ok(store().pendingDeletedIds.includes('n2'),
            'guard is retained until the delete is confirmed absent from a snapshot');
    });

    it('FIX: the guard clears once a snapshot confirms the deletion persisted', () => {
        const store = useRecipeStore.getState;

        store().mergeSnapshot(makeGraph([makeNode('n1'), makeNode('n2')]));
        store().markNodeDeleted('n2');

        // A snapshot reflecting the persisted delete (n2 gone from Firestore).
        store().mergeSnapshot(makeGraph([makeNode('n1')]));

        assert.deepEqual(ids(store().graph), ['n1']);
        assert.deepEqual(store().pendingDeletedIds, [],
            'pending guard is cleared once the deletion is confirmed');
    });

    it('FIX: undoing a delete restores the node and does not re-delete it', () => {
        const store = useRecipeStore.getState;

        store().mergeSnapshot(makeGraph([makeNode('n1'), makeNode('n2')]));

        // Capture the pre-delete graph (what the timeline undo stack stores),
        // then delete through the guard.
        const preDelete = store().graph!;
        store().markNodeDeleted('n2');
        assert.deepEqual(ids(store().graph), ['n1']);

        // Undo: restore the graph AND reconcile the guard (mirrors the fixed
        // timeline undo, which calls restoreNodes for the restored nodes).
        store().setGraph(preDelete);
        store().restoreNodes(preDelete.nodes.map(n => ({ id: n.id, data: n })));

        assert.deepEqual(ids(store().graph), ['n1', 'n2'], 'node restored by undo');
        assert.ok(!store().pendingDeletedIds.includes('n2'),
            'guard cleared so the restored node will not be re-deleted');

        // A subsequent snapshot that still contains n2 must NOT drop it now.
        store().mergeSnapshot(makeGraph([makeNode('n1'), makeNode('n2')]));
        assert.deepEqual(ids(store().graph), ['n1', 'n2'],
            'restored node survives the next snapshot');
    });
});
