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

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useRecipeStore } from '../lib/stores/recipe-store';
import { RecipeGraph, RecipeNode, ShortlistEntry } from '../lib/recipe-lanes/types';
import { buildShortlistEntry, toRecipeIcon } from '../lib/recipe-lanes/model-utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIcon(id: string) {
    return toRecipeIcon({ id, visualDescription: `icon-${id}` });
}

function makeEntry(id: string, matchType: 'generated' | 'search' = 'generated'): ShortlistEntry {
    return buildShortlistEntry(makeIcon(id), matchType);
}

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

// Reset the store between tests.
function resetStore() {
    useRecipeStore.getState().reset();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useRecipeStore', () => {

    beforeEach(() => resetStore());

    describe('initial state', () => {
        it('starts idle with no graph', () => {
            const s = useRecipeStore.getState();
            assert.equal(s.graph, null);
            assert.equal(s.status, 'idle');
            assert.equal(s.isDirty, false);
            assert.equal(s.recipeId, null);
        });
    });

    describe('mergeSnapshot — first load', () => {
        it('accepts the graph wholesale on first load', () => {
            const node = makeNode('a');
            const graph = makeGraph([node]);
            useRecipeStore.getState().mergeSnapshot(graph, { ownerId: 'user-1' });

            const s = useRecipeStore.getState();
            assert.equal(s.status, 'complete');
            assert.equal(s.ownerId, 'user-1');
            assert.equal(s.graph?.nodes.length, 1);
            assert.equal(s.graph?.nodes[0].id, 'a');
        });

        it('does not mark isDirty on first load', () => {
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a')]));
            assert.equal(useRecipeStore.getState().isDirty, false);
        });
    });

    describe('mergeSnapshot — subsequent snapshots', () => {
        it('preserves node reference when nothing changed', () => {
            const node = makeNode('a', { iconShortlist: [makeEntry('icon-1')] });
            useRecipeStore.getState().mergeSnapshot(makeGraph([node]));
            const original = useRecipeStore.getState().graph!.nodes[0];

            // Snapshot with identical node
            useRecipeStore.getState().mergeSnapshot(makeGraph([{ ...node }]));
            const after = useRecipeStore.getState().graph!.nodes[0];

            assert.equal(original, after, 'node reference should be preserved when nothing changed');
        });

        it('updates node reference when text changes', () => {
            const node = makeNode('a');
            useRecipeStore.getState().mergeSnapshot(makeGraph([node]));
            const original = useRecipeStore.getState().graph!.nodes[0];

            useRecipeStore.getState().mergeSnapshot(makeGraph([{ ...node, text: 'Updated text' }]));
            const after = useRecipeStore.getState().graph!.nodes[0];

            assert.notEqual(original, after);
            assert.equal(after.text, 'Updated text');
        });

        it('preserves local shortlistIndex when shortlist contents unchanged', () => {
            const entries = [makeEntry('icon-1'), makeEntry('icon-2')];
            const node = makeNode('a', { iconShortlist: entries, shortlistIndex: 0 });
            useRecipeStore.getState().mergeSnapshot(makeGraph([node]));

            // User cycles to index 1
            useRecipeStore.getState().cycleShortlist('a', 2);
            assert.equal(useRecipeStore.getState().graph!.nodes[0].shortlistIndex, 1);

            // Snapshot arrives with same shortlist but index 0 (server hasn't saved yet)
            const snapshot = makeNode('a', { iconShortlist: entries, shortlistIndex: 0 });
            useRecipeStore.getState().mergeSnapshot(makeGraph([snapshot]));

            assert.equal(
                useRecipeStore.getState().graph!.nodes[0].shortlistIndex,
                1,
                'local cycle position should be preserved',
            );
        });

        it('resets shortlistIndex when shortlist contents change (forge)', () => {
            const originalEntries = [makeEntry('icon-1')];
            const node = makeNode('a', { iconShortlist: originalEntries, shortlistIndex: 0 });
            useRecipeStore.getState().mergeSnapshot(makeGraph([node]));

            // User cycles
            useRecipeStore.getState().cycleShortlist('a', 1);

            // Forge: server sends a new shortlist with a different icon
            const newEntries = [makeEntry('icon-99'), makeEntry('icon-1')];
            const forgedNode = makeNode('a', { iconShortlist: newEntries, shortlistIndex: 0 });
            useRecipeStore.getState().mergeSnapshot(makeGraph([forgedNode]));

            assert.equal(
                useRecipeStore.getState().graph!.nodes[0].shortlistIndex,
                0,
                'shortlistIndex should reset when shortlist is regenerated',
            );
        });

        it('does not reset isDirty on snapshot', () => {
            const node = makeNode('a');
            useRecipeStore.getState().mergeSnapshot(makeGraph([node]));
            useRecipeStore.getState().setDirty(true);

            useRecipeStore.getState().mergeSnapshot(makeGraph([{ ...node, text: 'changed' }]));
            assert.equal(useRecipeStore.getState().isDirty, true);
        });

        it('preserves references for unchanged nodes when one node changes', () => {
            const nodeA = makeNode('a', { iconShortlist: [makeEntry('icon-1')] });
            const nodeB = makeNode('b');
            useRecipeStore.getState().mergeSnapshot(makeGraph([nodeA, nodeB]));

            const originalB = useRecipeStore.getState().graph!.nodes[1];

            // Only nodeA changes (new icon)
            const updatedA = makeNode('a', { iconShortlist: [makeEntry('icon-new'), makeEntry('icon-1')] });
            useRecipeStore.getState().mergeSnapshot(makeGraph([updatedA, nodeB]));

            const afterB = useRecipeStore.getState().graph!.nodes[1];
            assert.equal(originalB, afterB, 'nodeB reference should be unchanged');
        });

        it('sets meta fields when provided', () => {
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a')]), {
                ownerId: 'owner-42',
                ownerName: 'Alice',
            });
            const s = useRecipeStore.getState();
            assert.equal(s.ownerId, 'owner-42');
            assert.equal(s.ownerName, 'Alice');
        });
    });

    describe('cycleShortlist', () => {
        it('advances shortlistIndex by 1', () => {
            const entries = [makeEntry('i1'), makeEntry('i2'), makeEntry('i3')];
            const node = makeNode('a', { iconShortlist: entries, shortlistIndex: 0 });
            useRecipeStore.getState().mergeSnapshot(makeGraph([node]));

            useRecipeStore.getState().cycleShortlist('a', 3);
            assert.equal(useRecipeStore.getState().graph!.nodes[0].shortlistIndex, 1);
        });

        it('wraps around at the end of the shortlist', () => {
            const entries = [makeEntry('i1'), makeEntry('i2')];
            const node = makeNode('a', { iconShortlist: entries, shortlistIndex: 1 });
            useRecipeStore.getState().mergeSnapshot(makeGraph([node]));

            useRecipeStore.getState().cycleShortlist('a', 2);
            assert.equal(useRecipeStore.getState().graph!.nodes[0].shortlistIndex, 0);
        });

        it('preserves references for all other nodes', () => {
            const nodeA = makeNode('a', { iconShortlist: [makeEntry('i1'), makeEntry('i2')], shortlistIndex: 0 });
            const nodeB = makeNode('b');
            useRecipeStore.getState().mergeSnapshot(makeGraph([nodeA, nodeB]));

            const originalB = useRecipeStore.getState().graph!.nodes[1];
            useRecipeStore.getState().cycleShortlist('a', 2);

            assert.equal(useRecipeStore.getState().graph!.nodes[1], originalB);
        });

        it('is a no-op when length is 0', () => {
            const node = makeNode('a', { shortlistIndex: 2 });
            useRecipeStore.getState().mergeSnapshot(makeGraph([node]));

            useRecipeStore.getState().cycleShortlist('a', 0);
            assert.equal(useRecipeStore.getState().graph!.nodes[0].shortlistIndex, 2);
        });
    });

    describe('setDirty / reset', () => {
        it('setDirty updates isDirty', () => {
            useRecipeStore.getState().setDirty(true);
            assert.equal(useRecipeStore.getState().isDirty, true);
            useRecipeStore.getState().setDirty(false);
            assert.equal(useRecipeStore.getState().isDirty, false);
        });

        it('reset returns to initial state', () => {
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a')]), { ownerId: 'u1' });
            useRecipeStore.getState().setDirty(true);
            useRecipeStore.getState().reset();

            const s = useRecipeStore.getState();
            assert.equal(s.graph, null);
            assert.equal(s.isDirty, false);
            assert.equal(s.ownerId, null);
            assert.equal(s.status, 'idle');
        });
    });
});
