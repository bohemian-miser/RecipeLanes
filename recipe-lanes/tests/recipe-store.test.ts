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
            useRecipeStore.getState().cycleShortlist('a');
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
            useRecipeStore.getState().cycleShortlist('a');

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

            useRecipeStore.getState().cycleShortlist('a');
            assert.equal(useRecipeStore.getState().graph!.nodes[0].shortlistIndex, 1);
        });

        it('wraps around at the end of the shortlist', () => {
            const entries = [makeEntry('i1'), makeEntry('i2')];
            const node = makeNode('a', { iconShortlist: entries, shortlistIndex: 1 });
            useRecipeStore.getState().mergeSnapshot(makeGraph([node]));

            useRecipeStore.getState().cycleShortlist('a');
            assert.equal(useRecipeStore.getState().graph!.nodes[0].shortlistIndex, 0);
        });

        it('preserves references for all other nodes', () => {
            const nodeA = makeNode('a', { iconShortlist: [makeEntry('i1'), makeEntry('i2')], shortlistIndex: 0 });
            const nodeB = makeNode('b');
            useRecipeStore.getState().mergeSnapshot(makeGraph([nodeA, nodeB]));

            const originalB = useRecipeStore.getState().graph!.nodes[1];
            useRecipeStore.getState().cycleShortlist('a');

            assert.equal(useRecipeStore.getState().graph!.nodes[1], originalB);
        });

        it('is a no-op when length is 0', () => {
            const node = makeNode('a', { shortlistIndex: 2 });
            useRecipeStore.getState().mergeSnapshot(makeGraph([node]));
            useRecipeStore.getState().cycleShortlist('a');
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

    describe('canvasBackground (issue #111) — independent of iconStyle', () => {
        it('defaults to "default"', () => {
            assert.equal(useRecipeStore.getState().canvasBackground, 'default');
        });

        it('setCanvasBackground updates the background', () => {
            useRecipeStore.getState().setCanvasBackground('butcher');
            assert.equal(useRecipeStore.getState().canvasBackground, 'butcher');
            useRecipeStore.getState().setCanvasBackground('default');
            assert.equal(useRecipeStore.getState().canvasBackground, 'default');
        });

        it('does not change the icon style (the two are decoupled)', () => {
            const styleBefore = useRecipeStore.getState().iconStyle;
            useRecipeStore.getState().setCanvasBackground('butcher');
            assert.equal(useRecipeStore.getState().iconStyle, styleBefore);
        });

        it('setIconStyle does not change the canvas background', () => {
            useRecipeStore.getState().setCanvasBackground('butcher');
            useRecipeStore.getState().setIconStyle('modern');
            assert.equal(useRecipeStore.getState().canvasBackground, 'butcher');
        });
    });

    // Regression: issue #276 — switching between notation and lanes views and
    // hitting undo injected synthetic ReactFlow decoration (lane background bands
    // / notation station anchors) into graph.nodes, which then rendered as empty
    // "hollow" nodes (one per lane) and persisted to Firestore.
    describe('restoreNodes (issue #276 — hollow nodes on undo)', () => {
        // ReactFlow node shapes as captured in an undo snapshot. Content nodes
        // carry `...originalNode` in their data (so data.type is set); synthetic
        // lane/station nodes only carry presentational data.
        const rfContentNode = (id: string, type: 'ingredient' | 'action' = 'ingredient') => ({
            id,
            type: 'minimal',
            data: { id, laneId: 'lane-1', text: `Node ${id}`, visualDescription: `v-${id}`, type },
        });
        const rfLaneBand = (id: string) => ({ id, type: 'lane', data: { label: id, color: '#abc' } });
        const rfStationAnchor = (id: string) => ({ id, type: 'notation-station', data: { label: id } });

        it('does not inject synthetic lane/station nodes into graph.nodes', () => {
            useRecipeStore.getState().setGraph(makeGraph([makeNode('n1')]));

            useRecipeStore.getState().restoreNodes([
                rfLaneBand('lane-1'),
                rfLaneBand('lane-2'),
                rfStationAnchor('station-x'),
            ] as any);

            const nodes = useRecipeStore.getState().graph!.nodes;
            // Only the original content node remains — no lane/station junk added.
            assert.deepEqual(nodes.map(n => n.id), ['n1']);
            // Invariant the bug violated: every graph node has a real model type.
            assert.ok(nodes.every(n => n.type === 'ingredient' || n.type === 'action'));
        });

        it('leaves the graph reference untouched when only decoration is restored', () => {
            const graph = makeGraph([makeNode('n1')]);
            useRecipeStore.getState().setGraph(graph);
            const before = useRecipeStore.getState().graph;

            useRecipeStore.getState().restoreNodes([rfLaneBand('lane-1')] as any);

            assert.equal(useRecipeStore.getState().graph, before);
        });

        it('still restores genuine deleted content nodes', () => {
            useRecipeStore.getState().setGraph(makeGraph([makeNode('n1')]));

            // Snapshot captured while in lanes view: real content node + lane bands.
            useRecipeStore.getState().restoreNodes([
                rfContentNode('n1'),
                rfContentNode('n2', 'action'),
                rfLaneBand('lane-1'),
            ] as any);

            const nodes = useRecipeStore.getState().graph!.nodes;
            const ids = nodes.map(n => n.id).sort();
            // n2 comes back; n1 (already present) is preserved once; no lane band.
            assert.deepEqual(ids, ['n1', 'n2']);
            const n2 = nodes.find(n => n.id === 'n2')!;
            assert.equal(n2.type, 'action');
            assert.equal(n2.text, 'Node n2');
            assert.ok(nodes.every(n => n.type === 'ingredient' || n.type === 'action'));
        });
    });
});
