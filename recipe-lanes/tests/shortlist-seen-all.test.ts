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

// shortlistSeenAll (icon editor modal): opening the modal shows the WHOLE
// shortlist at once, which must count as an impression for every entry —
// but, unlike shortlistCycled, must NOT count as a rejection for entries
// beyond the selected index.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    computeShortlistDelta,
    buildShortlistEntry,
    setShortlistIndexNodes,
    markShortlistSeenAllNodes,
    assignNodeShortlist,
    getEntryHasImpressed,
    getEntryHasRejected,
} from '../lib/recipe-lanes/model-utils';
import { RecipeGraph, RecipeNode, ShortlistEntry } from '../lib/recipe-lanes/types';

function makeEntries(n: number): ShortlistEntry[] {
    return Array.from({ length: n }, (_, i) =>
        buildShortlistEntry({ id: `icon-${i}`, visualDescription: `Carrot` }, 'generated'),
    );
}

function makeNode(overrides: Partial<RecipeNode> = {}): RecipeNode {
    return {
        id: 'n1',
        laneId: 'lane-1',
        text: '2 Carrots',
        visualDescription: 'Carrot',
        type: 'ingredient',
        ...overrides,
    };
}

function makeGraph(nodes: RecipeNode[]): RecipeGraph {
    return { lanes: [], nodes };
}

describe('computeShortlistDelta with shortlistSeenAll', () => {
    it('records an impression for every entry, rejections only up to the selected index', () => {
        const oldNode = makeNode({ iconShortlist: makeEntries(4), shortlistIndex: 0 });
        const newNode = makeNode({
            iconShortlist: makeEntries(4),
            shortlistIndex: 1,
            shortlistSeenAll: true,
        });

        const delta = computeShortlistDelta(oldNode, newNode);

        // All four entries were shown in the modal → all impressed.
        assert.deepEqual(delta.toImpres.map(d => d.id).sort(), ['icon-0', 'icon-1', 'icon-2', 'icon-3']);
        // Only icon-0 was passed over for the selection at index 1; icons 2-3
        // were merely shown, never rejected.
        assert.deepEqual(delta.toReject.map(d => d.id), ['icon-0']);
        assert.deepEqual(delta.toUnreject, []);

        // The updated shortlist carries the flags for the next diff.
        assert.ok(delta.updatedShortlist.every(e => getEntryHasImpressed(e)));
        assert.equal(getEntryHasRejected(delta.updatedShortlist[2]), false);
        assert.equal(getEntryHasRejected(delta.updatedShortlist[3]), false);
    });

    it('with selection kept at index 0, impresses the rest without any rejections', () => {
        const oldNode = makeNode({ iconShortlist: makeEntries(3), shortlistIndex: 0 });
        const newNode = makeNode({
            iconShortlist: makeEntries(3),
            shortlistIndex: 0,
            shortlistSeenAll: true,
        });

        const delta = computeShortlistDelta(oldNode, newNode);

        assert.deepEqual(delta.toImpres.map(d => d.id).sort(), ['icon-0', 'icon-1', 'icon-2']);
        assert.deepEqual(delta.toReject, []);
    });

    it('is idempotent: a second save after flags landed produces an empty delta', () => {
        const first = computeShortlistDelta(
            makeNode({ iconShortlist: makeEntries(3), shortlistIndex: 0 }),
            makeNode({ iconShortlist: makeEntries(3), shortlistIndex: 0, shortlistSeenAll: true }),
        );

        const savedNode = makeNode({
            iconShortlist: first.updatedShortlist,
            shortlistIndex: 0,
            shortlistSeenAll: true,
        });
        const second = computeShortlistDelta(savedNode, savedNode);

        assert.deepEqual(second.toImpres, []);
        assert.deepEqual(second.toReject, []);
        assert.deepEqual(second.toUnreject, []);
    });

    it('does not disturb shortlistCycled semantics (cycled still rejects all non-selected)', () => {
        const oldNode = makeNode({ iconShortlist: makeEntries(3), shortlistIndex: 0 });
        const newNode = makeNode({
            iconShortlist: makeEntries(3),
            shortlistIndex: 1,
            shortlistCycled: true,
        });

        const delta = computeShortlistDelta(oldNode, newNode);

        assert.deepEqual(delta.toImpres.map(d => d.id).sort(), ['icon-0', 'icon-1', 'icon-2']);
        assert.deepEqual(delta.toReject.map(d => d.id).sort(), ['icon-0', 'icon-2']);
    });
});

describe('setShortlistIndexNodes', () => {
    it('sets the index on the target node only, preserving other node references', () => {
        const other = makeNode({ id: 'n2' });
        const target = makeNode({ iconShortlist: makeEntries(3), shortlistIndex: 0 });
        const graph = makeGraph([target, other]);

        const nodes = setShortlistIndexNodes(graph, 'n1', 2);

        assert.equal(nodes[0].shortlistIndex, 2);
        assert.notEqual(nodes[0], target);
        assert.equal(nodes[1], other);
    });

    it('ignores out-of-bounds and non-integer indices', () => {
        const target = makeNode({ iconShortlist: makeEntries(3), shortlistIndex: 1 });
        const graph = makeGraph([target]);

        for (const bad of [-1, 3, 99, 1.5, NaN]) {
            const nodes = setShortlistIndexNodes(graph, 'n1', bad);
            assert.equal(nodes[0], target, `index ${bad} must be a no-op`);
        }
    });

    it('is a reference-preserving no-op when the index is unchanged', () => {
        const target = makeNode({ iconShortlist: makeEntries(3), shortlistIndex: 1 });
        const graph = makeGraph([target]);

        const nodes = setShortlistIndexNodes(graph, 'n1', 1);
        assert.equal(nodes[0], target);
    });
});

describe('assignNodeShortlist clears stale seen flags', () => {
    it('an indexed (re)assignment resets shortlistSeenAll and shortlistCycled', () => {
        const node = makeNode({
            iconShortlist: makeEntries(3),
            shortlistIndex: 1,
            shortlistSeenAll: true,
            shortlistCycled: true,
        });

        // Forge/search replace the shortlist with an explicit index — the new
        // list has not been shown, so the seen-everything flags must clear.
        assignNodeShortlist(node, makeEntries(4), 0);

        assert.equal(node.shortlistSeenAll, undefined);
        assert.equal(node.shortlistCycled, undefined);
        assert.equal(node.shortlistIndex, 0);
    });

    it('the index-less flag-persistence call leaves the seen flags alone', () => {
        const node = makeNode({
            iconShortlist: makeEntries(3),
            shortlistIndex: 1,
            shortlistSeenAll: true,
        });

        assignNodeShortlist(node, makeEntries(3));

        assert.equal(node.shortlistSeenAll, true);
        assert.equal(node.shortlistIndex, 1);
    });
});

describe('markShortlistSeenAllNodes', () => {
    it('flags the target node', () => {
        const target = makeNode({ iconShortlist: makeEntries(2) });
        const nodes = markShortlistSeenAllNodes(makeGraph([target]), 'n1');
        assert.equal(nodes[0].shortlistSeenAll, true);
    });

    it('is a no-op for a node without a shortlist or already flagged', () => {
        const bare = makeNode({ id: 'n1' });
        assert.equal(markShortlistSeenAllNodes(makeGraph([bare]), 'n1')[0], bare);

        const flagged = makeNode({ iconShortlist: makeEntries(2), shortlistSeenAll: true });
        assert.equal(markShortlistSeenAllNodes(makeGraph([flagged]), 'n1')[0], flagged);
    });
});
