import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    isIconSearchMatched,
    getIconMatchType,
    currentShortlistIndex,
    nextShortlistIcon,
    advanceShortlistIndex,
    buildShortlistEntry,
} from '../lib/recipe-lanes/model-utils';
import type { RecipeNode, IconStats, ShortlistEntry } from '../lib/recipe-lanes/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeIcon = (id: string): IconStats => ({
    id,
    url: `https://example.com/icons/${id}.png`,
    score: 0.9,
});

const makeEntry = (id: string, matchType: 'generated' | 'search'): ShortlistEntry =>
    buildShortlistEntry(makeIcon(id), matchType);

const baseNode = (): RecipeNode => ({
    id: 'n1',
    laneId: 'l1',
    text: 'Slice carrots',
    visualDescription: 'A carrot being sliced',
    type: 'ingredient',
});

// ---------------------------------------------------------------------------
// isIconSearchMatched — reads matchType from current shortlist entry
// ---------------------------------------------------------------------------

describe('isIconSearchMatched', () => {

    it('returns true when the current shortlist entry has matchType "search"', () => {
        const node: RecipeNode = {
            ...baseNode(),
            iconShortlist: [makeEntry('a', 'search')],
            shortlistIndex: 0,
        };
        assert.strictEqual(isIconSearchMatched(node), true);
    });

    it('returns false when the current shortlist entry has matchType "generated"', () => {
        const node: RecipeNode = {
            ...baseNode(),
            iconShortlist: [makeEntry('a', 'generated')],
            shortlistIndex: 0,
        };
        assert.strictEqual(isIconSearchMatched(node), false);
    });

    it('returns false when iconShortlist is absent', () => {
        const node: RecipeNode = { ...baseNode() };
        assert.strictEqual(isIconSearchMatched(node), false);
    });

    it('reads matchType from the correct shortlistIndex position', () => {
        const entries: ShortlistEntry[] = [
            makeEntry('a', 'generated'),
            makeEntry('b', 'search'),
        ];
        const nodeAtGenerated: RecipeNode = { ...baseNode(), iconShortlist: entries, shortlistIndex: 0 };
        const nodeAtSearch: RecipeNode = { ...baseNode(), iconShortlist: entries, shortlistIndex: 1 };
        assert.strictEqual(isIconSearchMatched(nodeAtGenerated), false);
        assert.strictEqual(isIconSearchMatched(nodeAtSearch), true);
    });
});

// ---------------------------------------------------------------------------
// getIconMatchType — returns matchType from current shortlist entry
// ---------------------------------------------------------------------------

describe('getIconMatchType', () => {

    it('returns "search" when current entry has matchType "search"', () => {
        const node: RecipeNode = { ...baseNode(), iconShortlist: [makeEntry('a', 'search')], shortlistIndex: 0 };
        assert.strictEqual(getIconMatchType(node), 'search');
    });

    it('returns "generated" when current entry has matchType "generated"', () => {
        const node: RecipeNode = { ...baseNode(), iconShortlist: [makeEntry('a', 'generated')], shortlistIndex: 0 };
        assert.strictEqual(getIconMatchType(node), 'generated');
    });

    it('returns undefined when iconShortlist is absent', () => {
        const node: RecipeNode = { ...baseNode() };
        assert.strictEqual(getIconMatchType(node), undefined);
    });

    it('returns undefined when shortlistIndex is absent', () => {
        const node: RecipeNode = { ...baseNode(), iconShortlist: [makeEntry('a', 'generated')] };
        assert.strictEqual(getIconMatchType(node), undefined);
    });
});

// ---------------------------------------------------------------------------
// currentShortlistIndex — reads node.shortlistIndex directly
// ---------------------------------------------------------------------------

describe('currentShortlistIndex', () => {

    it('returns -1 when iconShortlist is absent', () => {
        const node: RecipeNode = { ...baseNode(), shortlistIndex: 0 };
        assert.strictEqual(currentShortlistIndex(node), -1);
    });

    it('returns -1 when shortlistIndex is absent', () => {
        const node: RecipeNode = {
            ...baseNode(),
            iconShortlist: [makeEntry('a', 'generated'), makeEntry('b', 'generated')],
        };
        assert.strictEqual(currentShortlistIndex(node), -1);
    });

    it('returns node.shortlistIndex when present', () => {
        const entries = [makeEntry('a', 'generated'), makeEntry('b', 'generated'), makeEntry('c', 'generated')];
        const node: RecipeNode = {
            ...baseNode(),
            iconShortlist: entries,
            shortlistIndex: 1,
        };
        assert.strictEqual(currentShortlistIndex(node), 1);
    });

    it('returns 0 when shortlistIndex is explicitly 0', () => {
        const node: RecipeNode = {
            ...baseNode(),
            iconShortlist: [makeEntry('a', 'generated'), makeEntry('b', 'generated')],
            shortlistIndex: 0,
        };
        assert.strictEqual(currentShortlistIndex(node), 0);
    });

    it('returns the stored shortlistIndex regardless of which icon is current', () => {
        // Unlike the old scan-based approach, the index is authoritative
        const entries = [makeEntry('a', 'generated'), makeEntry('b', 'generated'), makeEntry('c', 'generated')];
        const node: RecipeNode = {
            ...baseNode(),
            iconShortlist: entries,
            shortlistIndex: 2,
        };
        assert.strictEqual(currentShortlistIndex(node), 2);
    });
});

// ---------------------------------------------------------------------------
// nextShortlistIcon — shortlist cycling
// ---------------------------------------------------------------------------

describe('nextShortlistIcon', () => {

    it('returns null when iconShortlist is absent', () => {
        const node: RecipeNode = { ...baseNode(), shortlistIndex: 0 };
        assert.strictEqual(nextShortlistIcon(node), null);
    });

    it('returns null when iconShortlist is empty', () => {
        const node: RecipeNode = {
            ...baseNode(),
            iconShortlist: [],
            shortlistIndex: 0,
        };
        assert.strictEqual(nextShortlistIcon(node), null);
    });

    it('returns the next shortlist entry when there are remaining entries after current', () => {
        const entries = [makeEntry('a', 'generated'), makeEntry('b', 'generated'), makeEntry('c', 'generated')];
        const node: RecipeNode = {
            ...baseNode(),
            iconShortlist: entries,
            shortlistIndex: 0,
        };
        const next = nextShortlistIcon(node);
        assert.ok(next !== null, 'should return a next icon');
        assert.strictEqual(next!.id, 'b');
    });

    it('returns null when shortlistIndex is already at the last entry', () => {
        const entries = [makeEntry('a', 'generated'), makeEntry('b', 'generated'), makeEntry('c', 'generated')];
        const node: RecipeNode = {
            ...baseNode(),
            iconShortlist: entries,
            shortlistIndex: 2,
        };
        assert.strictEqual(nextShortlistIcon(node), null,
            'shortlist is exhausted — should fall through to Firestore path');
    });

    it('returns shortlist[1] when shortlistIndex is absent (defaults to 0)', () => {
        // shortlistIndex ?? 0, so nextIdx = 1
        const entries = [makeEntry('x', 'generated'), makeEntry('y', 'generated')];
        const node: RecipeNode = {
            ...baseNode(),
            iconShortlist: entries,
        };
        const next = nextShortlistIcon(node);
        assert.ok(next !== null);
        assert.strictEqual(next!.id, 'y');
    });

    it('cycles through the full shortlist before returning null', () => {
        const entries = [makeEntry('a', 'generated'), makeEntry('b', 'generated'), makeEntry('c', 'generated')];

        // Simulate cycling by advancing shortlistIndex on each step
        let node: RecipeNode = {
            ...baseNode(),
            iconShortlist: entries,
            shortlistIndex: 0,
        };

        const visited: string[] = [entries[0].icon.id];

        let next = nextShortlistIcon(node);
        while (next !== null) {
            visited.push(next.id);
            node = { ...node, shortlistIndex: (node.shortlistIndex ?? 0) + 1 };
            next = nextShortlistIcon(node);
        }

        assert.deepStrictEqual(visited, ['a', 'b', 'c'],
            'should cycle through all shortlist entries before exhausting');
    });
});

// ---------------------------------------------------------------------------
// advanceShortlistIndex — returns the next index value to store on the node
// ---------------------------------------------------------------------------

describe('advanceShortlistIndex', () => {

    it('returns 1 when shortlistIndex is 0', () => {
        const node: RecipeNode = {
            ...baseNode(),
            iconShortlist: [makeEntry('a', 'generated'), makeEntry('b', 'generated')],
            shortlistIndex: 0,
        };
        assert.strictEqual(advanceShortlistIndex(node), 1);
    });

    it('returns 1 when shortlistIndex is absent (defaults to 0)', () => {
        const node: RecipeNode = {
            ...baseNode(),
            iconShortlist: [makeEntry('a', 'generated'), makeEntry('b', 'generated')],
        };
        assert.strictEqual(advanceShortlistIndex(node), 1);
    });

    it('returns the incremented index for any starting value', () => {
        const entries = [
            makeEntry('a', 'generated'),
            makeEntry('b', 'generated'),
            makeEntry('c', 'generated'),
            makeEntry('d', 'generated'),
        ];
        for (let i = 0; i < entries.length; i++) {
            const node: RecipeNode = {
                ...baseNode(),
                iconShortlist: entries,
                shortlistIndex: i,
            };
            assert.strictEqual(advanceShortlistIndex(node), i + 1,
                `expected ${i + 1} when shortlistIndex is ${i}`);
        }
    });
});
