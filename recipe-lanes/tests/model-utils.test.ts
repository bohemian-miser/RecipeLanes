/*
 * Copyright (C) 2026 Bohemian Miser
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RecipeGraph, RecipeNode } from '../lib/recipe-lanes/types';
import { getNodeStatus, setNodeStatus, prependToShortlist, buildShortlistEntry, toRecipeIcon, getThemeCanvas } from '../lib/recipe-lanes/model-utils';

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

describe('getThemeCanvas (butcher-paper background theme, issue #111)', () => {
    const DEFAULT = { background: 'transparent', patternColor: '#f4f4f5' };

    it('returns a warm kraft-paper pane for butcher_paper', () => {
        const canvas = getThemeCanvas('butcher_paper');
        assert.equal(canvas.background, '#e9dcc3');
        // The dots must stay a distinct colour so they remain visible on paper.
        assert.notEqual(canvas.patternColor, DEFAULT.patternColor);
        assert.equal(canvas.patternColor, '#cbb892');
    });

    it('leaves the default background on the original transparent pane', () => {
        assert.deepEqual(getThemeCanvas('default'), DEFAULT);
    });

    it('falls back to the default canvas for unknown or missing themes', () => {
        assert.deepEqual(getThemeCanvas(undefined), DEFAULT);
        assert.deepEqual(getThemeCanvas('nonsense' as any), DEFAULT);
    });
});
