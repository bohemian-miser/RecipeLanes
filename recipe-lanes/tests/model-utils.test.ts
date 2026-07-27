/*
 * Copyright (C) 2026 Bohemian Miser
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RecipeGraph, RecipeNode } from '../lib/recipe-lanes/types';
import { getNodeStatus, setNodeStatus, prependToShortlist, buildShortlistEntry, toRecipeIcon, buildIngredientText, computeIngredientRowPatch } from '../lib/recipe-lanes/model-utils';

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

describe('model-utils setNodeStatus/getNodeStatus', () => {
    it('returns undefined for missing graph/node', () => {
        assert.equal(getNodeStatus(null, 'a'), undefined);
        assert.equal(getNodeStatus(makeGraph([]), 'nope'), undefined);
    });

    it('sets status when none present and reports change', () => {
        const n = makeNode('a');
        const g = makeGraph([n]);

        assert.equal(getNodeStatus(g, 'a'), undefined);
        const changed = setNodeStatus(g, 'a', 'pending');
        assert.equal(changed, true);
        assert.equal(getNodeStatus(g, 'a'), 'pending');
    });

    it('overwrites pending/processing status', () => {
        const n = makeNode('b', { status: 'pending' as any });
        const g = makeGraph([n]);

        const changed = setNodeStatus(g, 'b', 'failed');
        assert.equal(changed, true);
        assert.equal(getNodeStatus(g, 'b'), 'failed');
    });

    it('returns false when setting to same status', () => {
        const n = makeNode('c', { status: 'failed' as any });
        const g = makeGraph([n]);

        const changed = setNodeStatus(g, 'c', 'failed');
        assert.equal(changed, false);
        assert.equal(getNodeStatus(g, 'c'), 'failed');
    });
});

describe('prependToShortlist', () => {
    function makeIcon(id: string) {
        return toRecipeIcon({ id, visualDescription: `icon-${id}` } as any);
    }

    function makeEntry(id: string) {
        return buildShortlistEntry(makeIcon(id), 'generated');
    }

    it('prepends to empty list', () => {
        const e = makeEntry('a');
        const res = prependToShortlist([], e);
        assert.equal(res.length, 1);
        assert.equal(res[0], e);
    });

    it('deduplicates existing id', () => {
        const e1 = makeEntry('x');
        const existing = [e1];
        const eNew = buildShortlistEntry(makeIcon('x'), 'generated');
        const res = prependToShortlist(existing, eNew);
        assert.equal(res.length, 1);
        assert.equal(res[0], eNew);
    });

    it('keeps other entries after prepending', () => {
        const e1 = makeEntry('1');
        const e2 = makeEntry('2');
        const res = prependToShortlist([e1, e2], makeEntry('new'));
        assert.equal(res.length, 3);
        assert.equal(res[0].icon.id, 'new');
    });
});

describe('buildIngredientText', () => {
    it('joins quantity, unit and name', () => {
        assert.equal(buildIngredientText(2, 'cup', 'Flour'), '2 cup Flour');
    });

    it('collapses the gap left by a missing unit', () => {
        assert.equal(buildIngredientText(3, '', 'Onions'), '3 Onions');
        assert.equal(buildIngredientText(3, undefined, 'Onions'), '3 Onions');
    });

    it('keeps fractional quantities as rendered', () => {
        assert.equal(buildIngredientText(0.5, 'tsp', 'Salt'), '0.5 tsp Salt');
    });
});

describe('computeIngredientRowPatch', () => {
    const node = makeNode('a', { quantity: 2, unit: 'cup', canonicalName: 'Flour', text: '2 cup Flour' });

    it('returns an empty patch when nothing changed (scale 1)', () => {
        const patch = computeIngredientRowPatch(node, { qty: '2', unit: 'cup', name: 'Flour' }, 1);
        assert.deepEqual(patch, {});
    });

    it('updates the quantity and rebuilds the label', () => {
        const patch = computeIngredientRowPatch(node, { qty: '3', unit: 'cup', name: 'Flour' }, 1);
        assert.equal(patch.quantity, 3);
        assert.equal(patch.text, '3 cup Flour');
        assert.equal(patch.unit, undefined); // unchanged fields are omitted
        assert.equal(patch.canonicalName, undefined);
    });

    it('stores the unscaled base quantity when serves are scaled', () => {
        // displayed 4 at scale 2 -> base 2 is unchanged, so only text (if any) changes
        const patch2 = computeIngredientRowPatch(node, { qty: '6', unit: 'cup', name: 'Flour' }, 2);
        assert.equal(patch2.quantity, 3); // 6 / 2
        assert.equal(patch2.text, '6 cup Flour'); // label shows the scaled amount
    });

    it('updates only the unit', () => {
        const patch = computeIngredientRowPatch(node, { qty: '2', unit: 'tbsp', name: 'Flour' }, 1);
        assert.equal(patch.unit, 'tbsp');
        assert.equal(patch.quantity, undefined);
        assert.equal(patch.canonicalName, undefined);
        assert.equal(patch.text, '2 tbsp Flour');
    });

    it('updates only the ingredient name', () => {
        const patch = computeIngredientRowPatch(node, { qty: '2', unit: 'cup', name: 'Bread Flour' }, 1);
        assert.equal(patch.canonicalName, 'Bread Flour');
        assert.equal(patch.text, '2 cup Bread Flour');
        assert.equal(patch.quantity, undefined);
    });

    it('handles a node with no canonicalName (seeds the name from text)', () => {
        const salt = makeNode('b', { text: 'Salt' }); // no quantity/unit/canonicalName
        // Unchanged: name seeded from text -> no-op
        assert.deepEqual(computeIngredientRowPatch(salt, { qty: '', unit: '', name: 'Salt' }, 1), {});
        // Editing the name sets canonicalName and rebuilds text
        const patch = computeIngredientRowPatch(salt, { qty: '', unit: '', name: 'Sea Salt' }, 1);
        assert.equal(patch.canonicalName, 'Sea Salt');
        assert.equal(patch.text, 'Sea Salt');
    });

    it('clears the quantity when the number box is emptied', () => {
        const patch = computeIngredientRowPatch(node, { qty: '', unit: 'cup', name: 'Flour' }, 1);
        assert.equal(patch.quantity, undefined);
        assert.equal('quantity' in patch, true); // present, set to undefined (cleared)
        assert.equal(patch.text, 'cup Flour');
    });
});
