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

// Icon editor modal state + shortlist selection in the store. Same
// load-bearing guarantees as cycleShortlist: no dirty flag, no undo entry,
// per-node reference preservation, and client-owned fields surviving
// mergeSnapshot.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useRecipeStore } from '../lib/stores/recipe-store';
import { buildShortlistEntry } from '../lib/recipe-lanes/model-utils';
import { RecipeGraph, RecipeNode, ShortlistEntry } from '../lib/recipe-lanes/types';

function makeEntries(n: number): ShortlistEntry[] {
    return Array.from({ length: n }, (_, i) =>
        buildShortlistEntry({ id: `icon-${i}`, visualDescription: 'Carrot' }, 'generated'),
    );
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

function seedGraph(nodes: RecipeNode[]) {
    useRecipeStore.getState().mergeSnapshot(makeGraph(nodes));
    useRecipeStore.getState().setDirty(false);
}

const state = () => useRecipeStore.getState();

describe('useRecipeStore — icon editor', () => {
    beforeEach(() => state().reset());

    describe('openIconEditor / closeIconEditor', () => {
        it('tracks the open node id and clears it on close', () => {
            seedGraph([makeNode('n1', { iconShortlist: makeEntries(2) })]);
            state().openIconEditor('n1');
            assert.equal(state().iconEditorNodeId, 'n1');
            state().closeIconEditor();
            assert.equal(state().iconEditorNodeId, null);
        });

        it('stamps shortlistSeenAll on the opened node without dirty or undo', () => {
            const other = makeNode('n2');
            seedGraph([makeNode('n1', { iconShortlist: makeEntries(3) }), other]);
            const before = state().graph!;

            state().openIconEditor('n1');

            const node = state().graph!.nodes.find(n => n.id === 'n1')!;
            assert.equal(node.shortlistSeenAll, true);
            assert.equal(state().isDirty, false, 'opening the editor must not dirty the recipe');
            assert.equal(state().undoPast.length, 0, 'opening the editor must not push undo history');
            // Other node keeps its reference so its selector does not re-render.
            assert.equal(state().graph!.nodes.find(n => n.id === 'n2'), before.nodes.find(n => n.id === 'n2'));
        });

        it('opens even for a node without a shortlist (no seenAll stamp)', () => {
            seedGraph([makeNode('n1')]);
            const before = state().graph!;

            state().openIconEditor('n1');

            assert.equal(state().iconEditorNodeId, 'n1');
            assert.equal(state().graph, before, 'graph must be untouched when there is nothing to stamp');
        });

        it('reset() clears the open editor', () => {
            seedGraph([makeNode('n1', { iconShortlist: makeEntries(2) })]);
            state().openIconEditor('n1');
            state().reset();
            assert.equal(state().iconEditorNodeId, null);
        });
    });

    describe('setShortlistIndex', () => {
        it('sets the picked index without dirty or undo', () => {
            seedGraph([makeNode('n1', { iconShortlist: makeEntries(4), shortlistIndex: 0 })]);

            state().setShortlistIndex('n1', 2);

            assert.equal(state().graph!.nodes[0].shortlistIndex, 2);
            assert.equal(state().isDirty, false);
            assert.equal(state().undoPast.length, 0);
        });

        it('ignores out-of-bounds picks and keeps the graph reference', () => {
            seedGraph([makeNode('n1', { iconShortlist: makeEntries(2), shortlistIndex: 1 })]);
            const before = state().graph;

            state().setShortlistIndex('n1', 5);

            assert.equal(state().graph, before);
            assert.equal(state().graph!.nodes[0].shortlistIndex, 1);
        });
    });

    describe('mergeSnapshot interplay', () => {
        it('preserves shortlistSeenAll and the picked index when the shortlist is unchanged', () => {
            seedGraph([makeNode('n1', { iconShortlist: makeEntries(3), shortlistIndex: 0 })]);
            state().openIconEditor('n1');
            state().setShortlistIndex('n1', 2);

            // Background snapshot with the same shortlist but a server-side
            // status change (forces the merge path, not the fast path).
            state().mergeSnapshot(makeGraph([
                makeNode('n1', { iconShortlist: makeEntries(3), shortlistIndex: 0, status: 'failed' }),
            ]));

            const node = state().graph!.nodes[0];
            assert.equal(node.shortlistSeenAll, true, 'client-owned seenAll must survive the snapshot');
            assert.equal(node.shortlistIndex, 2, 'locally picked index must survive the snapshot');
            assert.equal(node.status, 'failed', 'server field must still merge');
        });

        it('resets shortlistSeenAll when the incoming shortlist was regenerated', () => {
            seedGraph([makeNode('n1', { iconShortlist: makeEntries(3), shortlistIndex: 0 })]);
            state().openIconEditor('n1');

            // Forge result: different shortlist contents, server cleared the flag.
            const forged = [
                buildShortlistEntry({ id: 'icon-new', visualDescription: 'Carrot' }, 'generated'),
                ...makeEntries(3),
            ];
            state().mergeSnapshot(makeGraph([
                makeNode('n1', { iconShortlist: forged, shortlistIndex: 0 }),
            ]));

            const node = state().graph!.nodes[0];
            assert.equal(node.shortlistSeenAll, undefined, 'stale seenAll must not leak onto a new shortlist');
            assert.equal(node.shortlistIndex, 0);
        });
    });
});
