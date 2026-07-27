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
 * Ticking recipe steps off as you cook (#281).
 *
 * Completion is client-only progress held beside the graph in
 * `completedNodeIds` — never a field on RecipeNode — so it is never written
 * back to a shared recipe document and never marks the recipe dirty.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useRecipeStore } from '../lib/stores/recipe-store';
import { RecipeGraph, RecipeNode } from '../lib/recipe-lanes/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, overrides: Partial<RecipeNode> = {}): RecipeNode {
    return {
        id,
        laneId: 'lane-1',
        text: `Node ${id}`,
        visualDescription: `visual-${id}`,
        type: 'action',
        ...overrides,
    };
}

function makeGraph(nodes: RecipeNode[]): RecipeGraph {
    return { lanes: [], nodes };
}

function completed(): string[] {
    return useRecipeStore.getState().completedNodeIds;
}

function resetStore() {
    useRecipeStore.getState().reset();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useRecipeStore — ticking nodes off (#281)', () => {
    beforeEach(() => resetStore());

    describe('toggleNodeCompleted', () => {
        it('starts with nothing ticked off', () => {
            assert.deepEqual(completed(), []);
        });

        it('ticks a node off and un-ticks it again', () => {
            const { toggleNodeCompleted } = useRecipeStore.getState();

            toggleNodeCompleted('a');
            assert.deepEqual(completed(), ['a']);

            toggleNodeCompleted('a');
            assert.deepEqual(completed(), []);
        });

        it('tracks several nodes independently', () => {
            const { toggleNodeCompleted } = useRecipeStore.getState();

            toggleNodeCompleted('a');
            toggleNodeCompleted('b');
            toggleNodeCompleted('c');
            toggleNodeCompleted('b');

            assert.deepEqual(completed(), ['a', 'c']);
        });

        it('does not touch the graph or mark the recipe dirty', () => {
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a')]));
            const graphBefore = useRecipeStore.getState().graph;

            useRecipeStore.getState().toggleNodeCompleted('a');

            const state = useRecipeStore.getState();
            assert.equal(state.graph, graphBefore, 'graph reference must be untouched');
            assert.equal(state.isDirty, false, 'ticking off must not trigger an autosave');
            assert.equal(
                (state.graph!.nodes[0] as unknown as Record<string, unknown>).completed,
                undefined,
                'completion must not be written onto the node itself',
            );
        });
    });

    describe('setNodeCompleted', () => {
        it('sets and clears explicitly', () => {
            const { setNodeCompleted } = useRecipeStore.getState();

            setNodeCompleted('a', true);
            assert.deepEqual(completed(), ['a']);

            setNodeCompleted('a', false);
            assert.deepEqual(completed(), []);
        });

        it('is idempotent and keeps the array reference on a no-op', () => {
            const { setNodeCompleted } = useRecipeStore.getState();

            setNodeCompleted('a', true);
            const ref = completed();

            setNodeCompleted('a', true);
            assert.equal(completed(), ref, 'a redundant set must not produce a new array');
            assert.deepEqual(completed(), ['a'], 'and must not duplicate the id');

            setNodeCompleted('b', false);
            assert.equal(completed(), ref, 'clearing an unticked node must be a no-op');
        });
    });

    describe('clearCompletedNodes', () => {
        it('resets progress so the recipe can be cooked again', () => {
            const { toggleNodeCompleted, clearCompletedNodes } = useRecipeStore.getState();
            toggleNodeCompleted('a');
            toggleNodeCompleted('b');

            clearCompletedNodes();
            assert.deepEqual(completed(), []);
        });

        it('keeps the array reference when there is nothing to clear', () => {
            const ref = completed();
            useRecipeStore.getState().clearCompletedNodes();
            assert.equal(completed(), ref);
        });
    });

    describe('mergeSnapshot', () => {
        it('survives a Firestore snapshot that does not know about the tick', () => {
            const node = makeNode('a');
            useRecipeStore.getState().mergeSnapshot(makeGraph([node]));
            useRecipeStore.getState().toggleNodeCompleted('a');

            // A background write (e.g. resolveRecipeIcons) pushes a fresh snapshot.
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a')]));

            assert.deepEqual(completed(), ['a'], 'a snapshot must never un-tick a step');
        });

        it('keeps a tick while its node lingers after an upstream delete', () => {
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a'), makeNode('b')]));
            useRecipeStore.getState().toggleNodeCompleted('a');
            useRecipeStore.getState().toggleNodeCompleted('b');

            // 'b' was deleted on another device. mergeNodes deliberately keeps
            // nodes the snapshot omits (they are indistinguishable from local
            // additions awaiting autosave), so 'b' is still on screen here —
            // and a tick on a node you can still see must stay ticked.
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a')]));

            const nodeIds = useRecipeStore.getState().graph!.nodes.map(n => n.id);
            assert.ok(nodeIds.includes('b'), 'precondition: the node lingers locally');
            assert.deepEqual(completed(), ['a', 'b'], 'ticks track what is on screen');
        });

        it('drops a tick whose node is not in the merged graph', () => {
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a')]));
            useRecipeStore.getState().toggleNodeCompleted('a');
            useRecipeStore.getState().toggleNodeCompleted('ghost');

            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a')]));

            assert.deepEqual(completed(), ['a'], 'ids with no node behind them are pruned');
        });

        it('keeps ticks on locally-added nodes the snapshot has not caught up with', () => {
            // mergeNodes deliberately preserves local-only nodes, so pruning has
            // to run against the merged graph rather than the incoming snapshot —
            // otherwise autosave lag silently un-ticks a step the cook just did.
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a')]));

            const withLocal = makeGraph([makeNode('a'), makeNode('local-1')]);
            useRecipeStore.getState().setGraph(withLocal);
            useRecipeStore.getState().toggleNodeCompleted('local-1');

            // Snapshot predates the local addition: it only carries 'a'.
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a')]));

            const nodeIds = useRecipeStore.getState().graph!.nodes.map(n => n.id);
            assert.ok(nodeIds.includes('local-1'), 'precondition: local node is preserved');
            assert.deepEqual(completed(), ['local-1'], 'its tick must be preserved too');
        });

        it('keeps the array reference when nothing is pruned', () => {
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a')]));
            useRecipeStore.getState().toggleNodeCompleted('a');
            const ref = completed();

            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a')]));
            assert.equal(completed(), ref);
        });

        it('prunes on first load too', () => {
            useRecipeStore.getState().toggleNodeCompleted('ghost');
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a')]));

            assert.deepEqual(completed(), [], 'a tick with no matching node is dropped');
        });
    });

    describe('markNodeDeleted', () => {
        it('un-ticks a node the user deletes', () => {
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a'), makeNode('b')]));
            useRecipeStore.getState().toggleNodeCompleted('a');
            useRecipeStore.getState().toggleNodeCompleted('b');

            useRecipeStore.getState().markNodeDeleted('a');

            assert.deepEqual(completed(), ['b']);
        });

        it('keeps the array reference when the deleted node was not ticked', () => {
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a'), makeNode('b')]));
            useRecipeStore.getState().toggleNodeCompleted('b');
            const ref = completed();

            useRecipeStore.getState().markNodeDeleted('a');
            assert.equal(completed(), ref);
        });
    });

    describe('setRecipeId', () => {
        it('clears progress when switching to a different recipe', () => {
            useRecipeStore.getState().setRecipeId('recipe-1');
            useRecipeStore.getState().toggleNodeCompleted('a');

            useRecipeStore.getState().setRecipeId('recipe-2');

            assert.deepEqual(completed(), [], 'a new recipe starts a fresh cook');
            assert.equal(useRecipeStore.getState().recipeId, 'recipe-2');
        });

        it('keeps progress when the same recipe id is re-set', () => {
            useRecipeStore.getState().setRecipeId('recipe-1');
            useRecipeStore.getState().toggleNodeCompleted('a');

            useRecipeStore.getState().setRecipeId('recipe-1');

            assert.deepEqual(completed(), ['a']);
        });

        it('keeps progress when the id is set for the first time', () => {
            // The page ticks nodes only after load, but the id lands via an
            // effect — a null -> id transition must not wipe anything.
            useRecipeStore.getState().toggleNodeCompleted('a');
            useRecipeStore.getState().setRecipeId('recipe-1');

            assert.deepEqual(completed(), ['a']);
        });
    });

    describe('reset', () => {
        it('clears progress', () => {
            useRecipeStore.getState().toggleNodeCompleted('a');
            useRecipeStore.getState().reset();

            assert.deepEqual(completed(), []);
        });
    });
});
