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

// Ticking nodes off while cooking (#281). The tick lives in the store as
// `completedNodeIds` rather than on the RecipeNode, because the save path
// persists node fields verbatim — see the field comment in recipe-store.ts.

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
        type: 'ingredient',
        ...overrides,
    };
}

function makeGraph(nodes: RecipeNode[]): RecipeGraph {
    return { lanes: [], nodes };
}

function resetStore() {
    useRecipeStore.getState().reset();
}

const completed = () => useRecipeStore.getState().completedNodeIds;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useRecipeStore — node completion (#281)', () => {

    beforeEach(() => resetStore());

    describe('initial state', () => {
        it('starts with nothing ticked off', () => {
            assert.deepEqual(completed(), []);
        });
    });

    describe('toggleNodeCompleted', () => {
        it('ticks a node off', () => {
            useRecipeStore.getState().toggleNodeCompleted('n1');
            assert.deepEqual(completed(), ['n1']);
        });

        it('un-ticks the same node on a second call', () => {
            const { toggleNodeCompleted } = useRecipeStore.getState();
            toggleNodeCompleted('n1');
            toggleNodeCompleted('n1');
            assert.deepEqual(completed(), []);
        });

        it('tracks several nodes independently', () => {
            const { toggleNodeCompleted } = useRecipeStore.getState();
            toggleNodeCompleted('n1');
            toggleNodeCompleted('n2');
            toggleNodeCompleted('n3');
            toggleNodeCompleted('n2');

            assert.deepEqual(completed(), ['n1', 'n3']);
        });

        it('never records the same node twice', () => {
            const { toggleNodeCompleted } = useRecipeStore.getState();
            toggleNodeCompleted('n1');
            toggleNodeCompleted('n2');
            toggleNodeCompleted('n1');
            toggleNodeCompleted('n1');

            assert.deepEqual(completed(), ['n2', 'n1']);
        });

        // The tick is view state: it must not dirty the recipe or trigger a save.
        it('does not touch the graph or mark the recipe dirty', () => {
            const graph = makeGraph([makeNode('n1'), makeNode('n2')]);
            useRecipeStore.getState().mergeSnapshot(graph);
            const before = useRecipeStore.getState().graph;

            useRecipeStore.getState().toggleNodeCompleted('n1');

            const after = useRecipeStore.getState().graph;
            assert.equal(after, before, 'graph reference should be untouched');
            assert.equal(useRecipeStore.getState().isDirty, false);
        });

        // Guards the reason this lives off the node: nothing completion-related
        // may end up on a RecipeNode, or the next save writes it to Firestore
        // and leaks one cook's progress to every viewer of a shared recipe.
        it('writes no completion flag onto the node itself', () => {
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('n1')]));
            useRecipeStore.getState().toggleNodeCompleted('n1');

            const node = useRecipeStore.getState().graph!.nodes[0];
            assert.deepEqual(Object.keys(node).sort(), [
                'id', 'laneId', 'text', 'type', 'visualDescription',
            ].sort());
        });

        it('does not push an undo entry', () => {
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('n1')]));
            useRecipeStore.getState().toggleNodeCompleted('n1');

            assert.deepEqual(useRecipeStore.getState().undoStack, []);
        });

        it('accepts an ID that is not in the graph', () => {
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('n1')]));
            useRecipeStore.getState().toggleNodeCompleted('ghost');

            assert.deepEqual(completed(), ['ghost']);
        });
    });

    describe('ticks survive Firestore snapshots', () => {
        // The whole point of the feature: a background write (icon forge, another
        // device saving) must not wipe the cook's progress mid-recipe.
        it('keeps ticks when a snapshot updates the graph', () => {
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('n1'), makeNode('n2')]));
            useRecipeStore.getState().toggleNodeCompleted('n1');

            useRecipeStore.getState().mergeSnapshot(
                makeGraph([makeNode('n1', { text: 'renamed' }), makeNode('n2')]),
            );

            assert.deepEqual(completed(), ['n1']);
        });
    });

    // Backs the "clear all ticks" toolbar button, which sits with undo/redo/save
    // and activates as soon as anything is ticked.
    describe('clearCompletedNodes', () => {
        it('un-ticks every node at once', () => {
            const { toggleNodeCompleted, clearCompletedNodes } = useRecipeStore.getState();
            toggleNodeCompleted('n1');
            toggleNodeCompleted('n2');
            toggleNodeCompleted('n3');

            clearCompletedNodes();

            assert.deepEqual(completed(), []);
        });

        it('leaves the graph and isDirty alone', () => {
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('n1')]));
            useRecipeStore.getState().toggleNodeCompleted('n1');
            const before = useRecipeStore.getState().graph;

            useRecipeStore.getState().clearCompletedNodes();

            assert.equal(useRecipeStore.getState().graph, before);
            assert.equal(useRecipeStore.getState().isDirty, false);
        });

        it('keeps the array reference when there is nothing to clear', () => {
            const before = completed();

            useRecipeStore.getState().clearCompletedNodes();

            assert.equal(completed(), before, 'no-op should not re-render subscribers');
        });

        it('can be ticked again after clearing', () => {
            const { toggleNodeCompleted, clearCompletedNodes } = useRecipeStore.getState();
            toggleNodeCompleted('n1');
            clearCompletedNodes();
            toggleNodeCompleted('n1');

            assert.deepEqual(completed(), ['n1']);
        });
    });

    describe('reset', () => {
        // This is how ticks get cleared when the cook opens a different recipe:
        // the recipeId-keyed effect in app/lanes/page.tsx calls reset() before
        // subscribing to the new doc, so node IDs never bleed across recipes.
        it('clears ticks, so they do not bleed into the next recipe', () => {
            useRecipeStore.getState().toggleNodeCompleted('n1');

            useRecipeStore.getState().reset();

            assert.deepEqual(completed(), []);
        });
    });
});
