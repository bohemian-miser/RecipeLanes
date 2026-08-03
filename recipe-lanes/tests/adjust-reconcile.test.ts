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
 * Pure unit tests for reconcileAdjustedGraph (issue #219).
 *
 * The LLM adjust/forge round-trip is slow. While it runs, the server writes
 * icon data (shortlists/status/fastMatches) into the store, and the user can
 * drag/cycle nodes. The LLM result is derived from the PRE-call graph, so
 * applying it wholesale erases those concurrent writes. reconcileAdjustedGraph
 * restores SERVER- and CLIENT-owned fields from the latest store graph while
 * keeping the LLM's structural changes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RecipeGraph, RecipeNode, ShortlistEntry } from '../lib/recipe-lanes/types';
import { reconcileAdjustedGraph, buildShortlistEntry, toRecipeIcon } from '../lib/recipe-lanes/model-utils';

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

function makeShortlist(id: string): ShortlistEntry[] {
    return [buildShortlistEntry(toRecipeIcon({ id, visualDescription: `icon-${id}` } as any), 'search')];
}

describe('reconcileAdjustedGraph (issue #219)', () => {
    it('restores server-written icon fields while keeping the adjusted structural change', () => {
        const shortlist = makeShortlist('srv-1');
        const latest = makeGraph([
            makeNode('a', {
                text: 'old text',
                iconShortlist: shortlist,
                status: 'processing',
                fastMatches: [{ icon_id: 'srv-1', score: 0.9 } as any],
            }),
        ]);
        const adjusted = makeGraph([makeNode('a', { text: 'new text from LLM' })]);

        const result = reconcileAdjustedGraph(adjusted, latest);
        const node = result.nodes.find((n) => n.id === 'a')!;

        assert.equal(node.text, 'new text from LLM', 'structural change from the adjust should apply');
        assert.deepEqual(node.iconShortlist, shortlist, 'iconShortlist should be restored from latest');
        assert.equal(node.status, 'processing', 'status should be restored from latest');
        assert.deepEqual(node.fastMatches, [{ icon_id: 'srv-1', score: 0.9 }], 'fastMatches should be restored');
    });

    it('keeps the latest x/y when the user dragged the node during the call', () => {
        const latest = makeGraph([makeNode('a', { x: 100, y: 200 })]);
        const adjusted = makeGraph([makeNode('a', { x: 0, y: 0, text: 'renamed' })]);

        const result = reconcileAdjustedGraph(adjusted, latest);
        const node = result.nodes.find((n) => n.id === 'a')!;

        assert.equal(node.x, 100, 'x should come from latest, not the adjusted graph');
        assert.equal(node.y, 200, 'y should come from latest, not the adjusted graph');
        assert.equal(node.text, 'renamed', 'structural change should still apply');
    });

    it('keeps a node new to the adjusted graph verbatim', () => {
        const latest = makeGraph([makeNode('a')]);
        const newNode = makeNode('b', { text: 'brand new node' });
        const adjusted = makeGraph([makeNode('a'), newNode]);

        const result = reconcileAdjustedGraph(adjusted, latest);
        const node = result.nodes.find((n) => n.id === 'b');

        assert.deepEqual(node, newNode, 'a node absent from latest should pass through unchanged');
    });

    it('keeps a node deleted by the adjust dropped', () => {
        const latest = makeGraph([makeNode('a'), makeNode('b')]);
        const adjusted = makeGraph([makeNode('a')]);

        const result = reconcileAdjustedGraph(adjusted, latest);

        assert.equal(result.nodes.length, 1);
        assert.equal(result.nodes.find((n) => n.id === 'b'), undefined, 'deleted node should stay dropped');
    });

    it('preserves the local shortlistIndex from latest', () => {
        const latest = makeGraph([makeNode('a', { iconShortlist: makeShortlist('x'), shortlistIndex: 2 })]);
        const adjusted = makeGraph([makeNode('a', { text: 'edited' })]);

        const result = reconcileAdjustedGraph(adjusted, latest);
        const node = result.nodes.find((n) => n.id === 'a')!;

        assert.equal(node.shortlistIndex, 2, 'shortlistIndex should survive reconciliation');
    });

    it('takes graph.layouts from latest, not the stale adjusted copy', () => {
        // A drag mid-call writes latest.layouts[mode]; adjusted still holds the
        // pre-call positions, which would otherwise revert the drag on restore.
        const latest = makeGraph([makeNode('a')]);
        latest.layouts = { notation: [{ id: 'a', x: 500, y: 600 }] };
        const adjusted = makeGraph([makeNode('a', { text: 'edited' })]);
        adjusted.layouts = { notation: [{ id: 'a', x: 10, y: 20 }] };

        const result = reconcileAdjustedGraph(adjusted, latest);

        assert.deepEqual(result.layouts, { notation: [{ id: 'a', x: 500, y: 600 }] });
        assert.equal(result.nodes[0].text, 'edited', 'structural edit still applies');
    });

    it('drops a node the user deleted mid-call (in deletedIds), but keeps genuinely new nodes', () => {
        const latest = makeGraph([makeNode('a')]);
        // 'b' was deleted during the call; 'c' is new from the LLM.
        const adjusted = makeGraph([makeNode('a'), makeNode('b'), makeNode('c')]);

        const result = reconcileAdjustedGraph(adjusted, latest, ['b']);

        assert.deepEqual(result.nodes.map((n) => n.id), ['a', 'c']);
    });

    it('falls back to the adjusted layouts when latest has none', () => {
        const latest = makeGraph([makeNode('a')]);
        const adjusted = makeGraph([makeNode('a')]);
        adjusted.layouts = { notation: [{ id: 'a', x: 10, y: 20 }] };

        const result = reconcileAdjustedGraph(adjusted, latest);

        assert.deepEqual(result.layouts, { notation: [{ id: 'a', x: 10, y: 20 }] });
    });
});
