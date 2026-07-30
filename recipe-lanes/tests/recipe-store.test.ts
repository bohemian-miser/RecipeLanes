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

    describe('updateNodeVisualDescription (issue #62)', () => {
        it('updates the target node visualDescription, leaving others untouched', () => {
            const store = useRecipeStore.getState();
            store.setGraph(makeGraph([makeNode('a'), makeNode('b')]));

            store.updateNodeVisualDescription('a', 'a carrot on a grater');

            const nodes = useRecipeStore.getState().graph!.nodes;
            assert.equal(nodes.find(n => n.id === 'a')!.visualDescription, 'a carrot on a grater');
            assert.equal(nodes.find(n => n.id === 'b')!.visualDescription, 'visual-b');
        });

        it('preserves the object reference of unedited nodes', () => {
            const store = useRecipeStore.getState();
            store.setGraph(makeGraph([makeNode('a'), makeNode('b')]));
            const beforeB = useRecipeStore.getState().graph!.nodes.find(n => n.id === 'b')!;

            store.updateNodeVisualDescription('a', 'changed');

            const afterB = useRecipeStore.getState().graph!.nodes.find(n => n.id === 'b')!;
            assert.equal(afterB, beforeB, 'unedited node keeps its object reference');
        });

        it('is undoable — pushes the prior graph and undo restores it', () => {
            const store = useRecipeStore.getState();
            store.setGraph(makeGraph([makeNode('a')]));
            assert.equal(useRecipeStore.getState().undoPast.length, 0);

            store.updateNodeVisualDescription('a', 'new desc');
            assert.equal(useRecipeStore.getState().undoPast.length, 1);
            assert.equal(useRecipeStore.getState().graph!.nodes[0].visualDescription, 'new desc');

            useRecipeStore.getState().undo();
            assert.equal(useRecipeStore.getState().graph!.nodes[0].visualDescription, 'visual-a');
        });

        it('is a no-op when the value is unchanged (no undo entry)', () => {
            const store = useRecipeStore.getState();
            store.setGraph(makeGraph([makeNode('a')]));
            const before = useRecipeStore.getState().graph!;

            store.updateNodeVisualDescription('a', 'visual-a'); // identical to the default

            assert.equal(useRecipeStore.getState().graph, before, 'graph reference unchanged');
            assert.equal(useRecipeStore.getState().undoPast.length, 0);
        });

        it('is a no-op when the node id is not found', () => {
            const store = useRecipeStore.getState();
            store.setGraph(makeGraph([makeNode('a')]));
            const before = useRecipeStore.getState().graph!;

            store.updateNodeVisualDescription('missing', 'x');

            assert.equal(useRecipeStore.getState().graph, before);
            assert.equal(useRecipeStore.getState().undoPast.length, 0);
        });

        it('does not throw when there is no graph', () => {
            assert.equal(useRecipeStore.getState().graph, null);
            assert.doesNotThrow(() => useRecipeStore.getState().updateNodeVisualDescription('a', 'x'));
        });
    });

    describe('updateNode (issue #62 — generic field patch)', () => {
        it('applies a multi-field patch to the target node only', () => {
            const store = useRecipeStore.getState();
            store.setGraph(makeGraph([makeNode('a'), makeNode('b')]));

            store.updateNode('a', { text: '3 cup Flour', quantity: 3 });

            const a = useRecipeStore.getState().graph!.nodes.find(n => n.id === 'a')!;
            const b = useRecipeStore.getState().graph!.nodes.find(n => n.id === 'b')!;
            assert.equal(a.text, '3 cup Flour');
            assert.equal(a.quantity, 3);
            assert.equal(b.text, 'Node b'); // untouched
        });

        it('preserves the object reference of unedited nodes', () => {
            const store = useRecipeStore.getState();
            store.setGraph(makeGraph([makeNode('a'), makeNode('b')]));
            const beforeB = useRecipeStore.getState().graph!.nodes.find(n => n.id === 'b')!;

            store.updateNode('a', { text: 'changed' });

            const afterB = useRecipeStore.getState().graph!.nodes.find(n => n.id === 'b')!;
            assert.equal(afterB, beforeB, 'unedited node keeps its object reference');
        });

        it('is undoable — pushes the prior graph and undo restores it', () => {
            const store = useRecipeStore.getState();
            store.setGraph(makeGraph([makeNode('a', { quantity: 1 })]));
            assert.equal(useRecipeStore.getState().undoPast.length, 0);

            store.updateNode('a', { quantity: 5 });
            assert.equal(useRecipeStore.getState().undoPast.length, 1);
            assert.equal(useRecipeStore.getState().graph!.nodes[0].quantity, 5);

            useRecipeStore.getState().undo();
            assert.equal(useRecipeStore.getState().graph!.nodes[0].quantity, 1);
        });

        it('is a no-op when the patch changes nothing (no undo entry)', () => {
            const store = useRecipeStore.getState();
            store.setGraph(makeGraph([makeNode('a', { quantity: 2 })]));
            const before = useRecipeStore.getState().graph!;

            store.updateNode('a', { quantity: 2, text: 'Node a' }); // identical to current

            assert.equal(useRecipeStore.getState().graph, before, 'graph reference unchanged');
            assert.equal(useRecipeStore.getState().undoPast.length, 0);
        });

        it('is a no-op when the node id is not found, and does not throw with no graph', () => {
            const store = useRecipeStore.getState();
            store.setGraph(makeGraph([makeNode('a')]));
            const before = useRecipeStore.getState().graph!;
            store.updateNode('missing', { text: 'x' });
            assert.equal(useRecipeStore.getState().graph, before);
            assert.equal(useRecipeStore.getState().undoPast.length, 0);

            useRecipeStore.getState().reset();
            assert.equal(useRecipeStore.getState().graph, null);
            assert.doesNotThrow(() => useRecipeStore.getState().updateNode('a', { text: 'x' }));
        });

        it('updateNodeVisualDescription still delegates correctly', () => {
            const store = useRecipeStore.getState();
            store.setGraph(makeGraph([makeNode('a')]));
            store.updateNodeVisualDescription('a', 'a whisk in a bowl');
            assert.equal(useRecipeStore.getState().graph!.nodes[0].visualDescription, 'a whisk in a bowl');
            assert.equal(useRecipeStore.getState().undoPast.length, 1);
        });
    });

    // Single store-level undo history (issue #216): graph edits, drags and
    // deletes share ONE timeline, so one undo reverts exactly one action.
    // (This also structurally retires the issue #276 "hollow nodes on undo"
    // class: history entries are graph snapshots — synthetic ReactFlow
    // decoration like lane bands / station anchors never enters graph.nodes,
    // so undo cannot inject it.)
    describe('store history (issue #216 — single undo owner)', () => {
        it('undo/redo round-trips a graph edit', () => {
            const store = useRecipeStore.getState();
            store.setGraph(makeGraph([makeNode('a')]));
            const before = useRecipeStore.getState().graph!;

            store.setGraphWithUndo({ ...before, nodes: [...before.nodes, makeNode('b')] });
            assert.deepEqual(useRecipeStore.getState().graph!.nodes.map(n => n.id), ['a', 'b']);

            useRecipeStore.getState().undo();
            assert.deepEqual(useRecipeStore.getState().graph!.nodes.map(n => n.id), ['a']);

            useRecipeStore.getState().redo();
            assert.deepEqual(useRecipeStore.getState().graph!.nodes.map(n => n.id), ['a', 'b']);
        });

        it('undo of an added node suppresses snapshot resurrection (pendingDeletedIds)', () => {
            const store = useRecipeStore.getState();
            store.setGraph(makeGraph([makeNode('a')]));
            const before = useRecipeStore.getState().graph!;

            // e.g. an AI adjustment added node b…
            store.setGraphWithUndo({ ...before, nodes: [...before.nodes, makeNode('b')] });
            // …and the user undoes it.
            useRecipeStore.getState().undo();

            // b is now pending-deleted: a background Firestore snapshot that
            // still contains b must not bring it back.
            assert.ok(useRecipeStore.getState().pendingDeletedIds.includes('b'));
            useRecipeStore.getState().mergeSnapshot(makeGraph([makeNode('a'), makeNode('b')]));
            assert.deepEqual(useRecipeStore.getState().graph!.nodes.map(n => n.id), ['a']);
        });

        it('undo of a delete clears the pending-delete flag so the node can live again', () => {
            const store = useRecipeStore.getState();
            store.setGraph(makeGraph([makeNode('a'), makeNode('b')]));

            store.deleteNodeWithUndo('b');
            assert.ok(useRecipeStore.getState().pendingDeletedIds.includes('b'));

            useRecipeStore.getState().undo();
            assert.deepEqual(useRecipeStore.getState().graph!.nodes.map(n => n.id).sort(), ['a', 'b']);
            assert.ok(!useRecipeStore.getState().pendingDeletedIds.includes('b'));
        });

        it('redo of a delete re-suppresses the node', () => {
            const store = useRecipeStore.getState();
            store.setGraph(makeGraph([makeNode('a'), makeNode('b')]));
            store.deleteNodeWithUndo('b');
            useRecipeStore.getState().undo();
            useRecipeStore.getState().redo();
            assert.deepEqual(useRecipeStore.getState().graph!.nodes.map(n => n.id), ['a']);
            assert.ok(useRecipeStore.getState().pendingDeletedIds.includes('b'));
        });

        it('deleteNodeWithUndo bridges children onto the deleted node\'s inputs', () => {
            const store = useRecipeStore.getState();
            // a → b → c: deleting b must leave a → c.
            store.setGraph(makeGraph([
                makeNode('a'),
                makeNode('b', { inputs: ['a'] }),
                makeNode('c', { inputs: ['b'] }),
            ]));

            store.deleteNodeWithUndo('b');

            const nodes = useRecipeStore.getState().graph!.nodes;
            assert.deepEqual(nodes.map(n => n.id), ['a', 'c']);
            assert.deepEqual(nodes.find(n => n.id === 'c')!.inputs, ['a']);
        });

        it('commitNodePositions pushes ONE history entry and writes x/y + layouts', () => {
            const store = useRecipeStore.getState();
            store.setGraph(makeGraph([makeNode('a'), makeNode('b')]));

            store.commitNodePositions('dagre', [
                { id: 'a', x: 100, y: 200 },
                { id: 'b', x: 300, y: 400 },
            ]);

            const state = useRecipeStore.getState();
            assert.equal(state.undoPast.length, 1);
            assert.equal(state.isDirty, true);
            assert.equal(state.graph!.nodes.find(n => n.id === 'a')!.x, 100);
            assert.deepEqual(state.graph!.layouts!['dagre'].map(l => l.id), ['a', 'b']);

            // Undo restores the pre-move graph (no x on the nodes, no layout entry).
            state.undo();
            const undone = useRecipeStore.getState().graph!;
            assert.equal(undone.nodes.find(n => n.id === 'a')!.x, undefined);
            assert.equal(undone.layouts?.['dagre'], undefined);
            // Redo re-applies the move.
            useRecipeStore.getState().redo();
            assert.equal(useRecipeStore.getState().graph!.nodes.find(n => n.id === 'a')!.x, 100);
        });

        it('commitNodePositions is a no-op when nothing moved (no history spam)', () => {
            const store = useRecipeStore.getState();
            store.setGraph(makeGraph([makeNode('a')]));
            store.commitNodePositions('dagre', [{ id: 'a', x: 10, y: 20 }]);
            assert.equal(useRecipeStore.getState().undoPast.length, 1);

            const before = useRecipeStore.getState().graph;
            useRecipeStore.getState().commitNodePositions('dagre', [{ id: 'a', x: 10, y: 20 }]);
            assert.equal(useRecipeStore.getState().graph, before, 'graph reference unchanged');
            assert.equal(useRecipeStore.getState().undoPast.length, 1);
        });

        it('syncNodePositions mirrors x/y but never touches history, dirty or layouts', () => {
            const store = useRecipeStore.getState();
            store.setGraph(makeGraph([makeNode('a')]));
            useRecipeStore.getState().setDirty(false);

            useRecipeStore.getState().syncNodePositions('dagre', [{ id: 'a', x: 50, y: 60 }]);

            const state = useRecipeStore.getState();
            assert.equal(state.graph!.nodes[0].x, 50);
            assert.equal(state.undoPast.length, 0, 'no history entry');
            assert.equal(state.isDirty, false, 'not marked dirty');
            // The layouts map must stay untouched: the diagram's "saved layouts
            // just arrived" detection compares layouts[mode] against null.
            assert.equal(state.graph!.layouts?.['dagre'], undefined);
        });

        it('undo bumps historyVersion so views re-apply positions', () => {
            const store = useRecipeStore.getState();
            store.setGraph(makeGraph([makeNode('a')]));
            const v0 = useRecipeStore.getState().historyVersion;
            store.commitNodePositions('dagre', [{ id: 'a', x: 1, y: 2 }]);
            useRecipeStore.getState().undo();
            assert.equal(useRecipeStore.getState().historyVersion, v0 + 1);
            useRecipeStore.getState().redo();
            assert.equal(useRecipeStore.getState().historyVersion, v0 + 2);
        });

        it('mergeSnapshot keeps node identity when only x/y differ (client-owned positions)', () => {
            const store = useRecipeStore.getState();
            store.mergeSnapshot(makeGraph([makeNode('a'), makeNode('b')]));
            // The local mirror of rendered positions (syncNodePositions).
            useRecipeStore.getState().syncNodePositions('dagre', [
                { id: 'a', x: 111, y: 222 },
                { id: 'b', x: 333, y: 444 },
            ]);
            const beforeA = useRecipeStore.getState().graph!.nodes.find(n => n.id === 'a')!;

            // Background snapshot with different (server-side) coordinates.
            store.mergeSnapshot(makeGraph([
                makeNode('a', { x: 1, y: 2 }),
                makeNode('b', { x: 3, y: 4 }),
            ]));

            const afterA = useRecipeStore.getState().graph!.nodes.find(n => n.id === 'a')!;
            assert.equal(afterA, beforeA, 'node keeps identity — no re-render storm on icon writes');
            assert.equal(afterA.x, 111, 'local position mirror survives the snapshot');
        });

        it('mergeSnapshot preserves the local position mirror through a structural change', () => {
            const store = useRecipeStore.getState();
            store.mergeSnapshot(makeGraph([makeNode('a')]));
            useRecipeStore.getState().syncNodePositions('dagre', [{ id: 'a', x: 50, y: 60 }]);

            // Server-side text edit arrives with stale/absent coordinates.
            store.mergeSnapshot(makeGraph([makeNode('a', { text: 'Renamed a' })]));

            const a = useRecipeStore.getState().graph!.nodes.find(n => n.id === 'a')!;
            assert.equal(a.text, 'Renamed a', 'structural change is adopted');
            assert.equal(a.x, 50, 'client-owned position mirror is kept');
        });

        it('undo/redo are no-ops on empty stacks', () => {
            const store = useRecipeStore.getState();
            store.setGraph(makeGraph([makeNode('a')]));
            const before = useRecipeStore.getState().graph;
            useRecipeStore.getState().undo();
            useRecipeStore.getState().redo();
            assert.equal(useRecipeStore.getState().graph, before);
            assert.equal(useRecipeStore.getState().historyVersion, 0);
        });
    });

    // Field-ownership-driven merge (issue #220): a server write that changes
    // ONLY an uncompared field (e.g. failRecipeIcon setting status:'failed')
    // used to hit mergeNode's fast path and be silently dropped, leaving the
    // UI stuck on an infinite spinner. mergeNode is now driven exhaustively by
    // lib/recipe-lanes/node-fields.ts's ownership map instead of a hand-picked
    // field subset.
    describe('mergeNode field ownership (issue #220)', () => {
        it('(identity) keeps the same reference when only CLIENT fields (x/y) differ', () => {
            const store = useRecipeStore.getState();
            const node = makeNode('a', { x: 1, y: 1, status: 'pending' });
            store.mergeSnapshot(makeGraph([node]));
            const before = useRecipeStore.getState().graph!.nodes[0];

            store.mergeSnapshot(makeGraph([{ ...node, x: 999, y: 999 }]));
            const after = useRecipeStore.getState().graph!.nodes[0];

            assert.strictEqual(after, before, 'STRUCTURAL and SERVER fields unchanged -> same reference');
        });

        it('(array identity) mergeSnapshot with an all-identical node array returns the same array reference', () => {
            const store = useRecipeStore.getState();
            const nodeA = makeNode('a');
            const nodeB = makeNode('b');
            store.mergeSnapshot(makeGraph([nodeA, nodeB]));
            const before = useRecipeStore.getState().graph!.nodes;

            store.mergeSnapshot(makeGraph([{ ...nodeA }, { ...nodeB }]));
            const after = useRecipeStore.getState().graph!.nodes;

            assert.strictEqual(after, before, 'identical incoming array -> same array reference');
        });

        it('(server change reflected) a status-only change is reflected, and every other node keeps identity', () => {
            const store = useRecipeStore.getState();
            const nodeA = makeNode('a', { status: 'pending' });
            const nodeB = makeNode('b');
            const nodeC = makeNode('c');
            store.mergeSnapshot(makeGraph([nodeA, nodeB, nodeC]));
            const beforeB = useRecipeStore.getState().graph!.nodes.find(n => n.id === 'b')!;
            const beforeC = useRecipeStore.getState().graph!.nodes.find(n => n.id === 'c')!;

            store.mergeSnapshot(makeGraph([{ ...nodeA, status: 'failed' }, nodeB, nodeC]));

            const state = useRecipeStore.getState();
            const afterA = state.graph!.nodes.find(n => n.id === 'a')!;
            assert.equal(afterA.status, 'failed', 'status change must be reflected');
            assert.strictEqual(state.graph!.nodes.find(n => n.id === 'b')!, beforeB);
            assert.strictEqual(state.graph!.nodes.find(n => n.id === 'c')!, beforeC);
        });

        it('(structural change reflected) a laneId-only change is reflected', () => {
            const store = useRecipeStore.getState();
            const node = makeNode('a', { laneId: 'lane-1' });
            store.mergeSnapshot(makeGraph([node]));

            store.mergeSnapshot(makeGraph([{ ...node, laneId: 'lane-2' }]));

            assert.equal(useRecipeStore.getState().graph!.nodes[0].laneId, 'lane-2');
        });

        it('(structural change reflected) an inputs-only change is reflected', () => {
            const store = useRecipeStore.getState();
            const node = makeNode('a', { inputs: ['x'] });
            store.mergeSnapshot(makeGraph([node]));

            store.mergeSnapshot(makeGraph([{ ...node, inputs: ['x', 'y'] }]));

            assert.deepEqual(useRecipeStore.getState().graph!.nodes[0].inputs, ['x', 'y']);
        });

        it('(structural change reflected) a duration-only change is reflected', () => {
            const store = useRecipeStore.getState();
            const node = makeNode('a', { duration: '5 min' });
            store.mergeSnapshot(makeGraph([node]));

            store.mergeSnapshot(makeGraph([{ ...node, duration: '10 min' }]));

            assert.equal(useRecipeStore.getState().graph!.nodes[0].duration, '10 min');
        });

        it('(client-owned preserved) an x/y-only change keeps the existing reference (client owns position)', () => {
            const store = useRecipeStore.getState();
            const node = makeNode('a', { x: 5, y: 5 });
            store.mergeSnapshot(makeGraph([node]));
            const before = useRecipeStore.getState().graph!.nodes[0];

            store.mergeSnapshot(makeGraph([{ ...node, x: 50, y: 50 }]));

            assert.strictEqual(useRecipeStore.getState().graph!.nodes[0], before);
        });

        it('(shortlist index preserved) local shortlistIndex survives a merge when the shortlist key is unchanged', () => {
            const store = useRecipeStore.getState();
            const entries = [makeEntry('icon-1'), makeEntry('icon-2')];
            const node = makeNode('a', { iconShortlist: entries, shortlistIndex: 0, status: 'pending' });
            store.mergeSnapshot(makeGraph([node]));

            // User cycles to index 1 locally.
            store.cycleShortlist('a');
            assert.equal(useRecipeStore.getState().graph!.nodes[0].shortlistIndex, 1);

            // Server writes back a status change; shortlist is unchanged.
            store.mergeSnapshot(makeGraph([{ ...node, status: 'failed' }]));

            const after = useRecipeStore.getState().graph!.nodes[0];
            assert.equal(after.status, 'failed', 'server change is reflected');
            assert.equal(after.shortlistIndex, 1, 'local cycle position survives an unrelated server merge');
        });

        it('(shortlist regeneration resets index) a regenerated shortlist resets shortlistIndex to the incoming value', () => {
            const store = useRecipeStore.getState();
            const originalEntries = [makeEntry('icon-1')];
            const node = makeNode('a', { iconShortlist: originalEntries, shortlistIndex: 0 });
            store.mergeSnapshot(makeGraph([node]));
            store.cycleShortlist('a');

            const newEntries = [makeEntry('icon-99'), makeEntry('icon-1')];
            store.mergeSnapshot(makeGraph([makeNode('a', { iconShortlist: newEntries, shortlistIndex: 0 })]));

            assert.equal(useRecipeStore.getState().graph!.nodes[0].shortlistIndex, 0);
        });

        it('(x/y adoption) incoming x/y are adopted when the existing node has no local mirror', () => {
            const store = useRecipeStore.getState();
            const node = makeNode('a', { status: 'pending' });
            store.mergeSnapshot(makeGraph([node])); // x/y undefined locally

            store.mergeSnapshot(makeGraph([{ ...node, status: 'failed', x: 7, y: 8 }]));

            const after = useRecipeStore.getState().graph!.nodes[0];
            assert.equal(after.x, 7);
            assert.equal(after.y, 8);
        });
    });
});
