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
 * Regression tests for issue #278 — "Graph resets when deleting a node in the
 * timeline/notation view (mobile)".
 *
 * The timeline view used to delete a node with a plain `setGraph`, which does
 * NOT register the deletion in `pendingDeletedIds`. The live Firestore snapshot
 * listener then re-merged the still-present node back in via `mergeSnapshot`,
 * so the graph appeared to "reset to how it was at the start". The fix routes
 * timeline deletes through the store's protected `deleteNode` action, which
 * populates `pendingDeletedIds` so `mergeSnapshot` strips the node out of every
 * incoming snapshot until the delete reaches the server.
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
    };
}

function makeGraph(nodes: RecipeNode[]): RecipeGraph {
    return { lanes: [], nodes };
}

function nodeIds(): string[] {
    return (useRecipeStore.getState().graph?.nodes ?? []).map(n => n.id);
}

describe('issue #278 — timeline delete must not be resurrected by a snapshot', () => {
    beforeEach(() => useRecipeStore.getState().reset());

    // Control: reproduces the pre-fix behaviour. A plain `setGraph` delete does
    // not touch pendingDeletedIds, so the very next server snapshot re-adds the
    // node. This documents exactly why the protected path is required.
    it('CONTROL: a plain setGraph delete IS resurrected by the next snapshot', () => {
        const store = useRecipeStore.getState();
        store.mergeSnapshot(makeGraph([makeNode('a'), makeNode('b')]));

        // Old timeline delete path — remove locally only.
        const g = useRecipeStore.getState().graph!;
        store.setGraph({ ...g, nodes: g.nodes.filter(n => n.id !== 'a') });
        assert.deepEqual(nodeIds(), ['b']);

        // Server echoes the pre-delete state (e.g. an icon write-back).
        store.mergeSnapshot(makeGraph([makeNode('a'), makeNode('b')]));

        // Bug: the deleted node comes back — the "reset".
        assert.deepEqual(nodeIds().sort(), ['a', 'b']);
    });

    it('deleteNode removes the node, marks it pending, and marks the graph dirty', () => {
        const store = useRecipeStore.getState();
        store.mergeSnapshot(makeGraph([makeNode('a'), makeNode('b')]));

        store.deleteNode('a');

        const s = useRecipeStore.getState();
        assert.deepEqual(s.graph!.nodes.map(n => n.id), ['b']);
        assert.ok(s.pendingDeletedIds.includes('a'));
        assert.equal(s.isDirty, true);
    });

    it('a node deleted via deleteNode is NOT resurrected by a later snapshot', () => {
        const store = useRecipeStore.getState();
        store.mergeSnapshot(makeGraph([makeNode('a'), makeNode('b')]));

        store.deleteNode('a');

        // Server snapshot still contains the deleted node (delete not yet flushed).
        store.mergeSnapshot(makeGraph([makeNode('a'), makeNode('b')]));

        assert.deepEqual(nodeIds(), ['b']);
    });

    it('clears the pending id once the server confirms the deletion', () => {
        const store = useRecipeStore.getState();
        store.mergeSnapshot(makeGraph([makeNode('a'), makeNode('b')]));

        store.deleteNode('a');
        assert.ok(useRecipeStore.getState().pendingDeletedIds.includes('a'));

        // Snapshot that no longer contains 'a' => delete reached Firestore.
        store.mergeSnapshot(makeGraph([makeNode('b')]));

        const s = useRecipeStore.getState();
        assert.deepEqual(s.pendingDeletedIds, []);
        assert.deepEqual(s.graph!.nodes.map(n => n.id), ['b']);
    });

    it('is a no-op when there is no graph', () => {
        const store = useRecipeStore.getState();
        assert.doesNotThrow(() => store.deleteNode('missing'));
        assert.equal(useRecipeStore.getState().graph, null);
    });
});

describe('issue #278 — restoreGraph clears the pending-delete guard on undo', () => {
    beforeEach(() => useRecipeStore.getState().reset());

    it('undoing a delete via restoreGraph brings the node back and keeps it', () => {
        const store = useRecipeStore.getState();
        const original = makeGraph([makeNode('a'), makeNode('b')]);
        store.mergeSnapshot(original);

        // Delete, then undo by restoring the pre-delete snapshot.
        store.deleteNode('a');
        assert.ok(useRecipeStore.getState().pendingDeletedIds.includes('a'));
        store.restoreGraph(original);

        // The node is back AND no longer pending, so a later snapshot keeps it.
        assert.deepEqual(nodeIds().sort(), ['a', 'b']);
        assert.deepEqual(useRecipeStore.getState().pendingDeletedIds, []);

        store.mergeSnapshot(makeGraph([makeNode('a'), makeNode('b')]));
        assert.deepEqual(nodeIds().sort(), ['a', 'b']);
    });

    it('only clears pending ids that the restored snapshot actually contains', () => {
        const store = useRecipeStore.getState();
        store.mergeSnapshot(makeGraph([makeNode('a'), makeNode('b'), makeNode('c')]));

        store.deleteNode('a');
        // Undo only back to a snapshot that still lacks 'a' but is otherwise fine.
        store.restoreGraph(makeGraph([makeNode('b'), makeNode('c')]));

        // 'a' was not in the restored snapshot, so it stays pending/deleted.
        assert.deepEqual(useRecipeStore.getState().pendingDeletedIds, ['a']);
        assert.deepEqual(nodeIds().sort(), ['b', 'c']);
    });
});
