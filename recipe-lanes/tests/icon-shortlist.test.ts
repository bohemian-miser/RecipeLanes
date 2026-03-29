import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    isIconSearchMatched,
    currentShortlistIndex,
    nextShortlistIcon,
} from '../lib/recipe-lanes/model-utils';
import type { RecipeNode, IconStats } from '../lib/recipe-lanes/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeIcon = (id: string): IconStats => ({
    id,
    url: `https://example.com/icons/${id}.png`,
    score: 0.9,
});

const baseNode = (): RecipeNode => ({
    id: 'n1',
    laneId: 'l1',
    text: 'Slice carrots',
    visualDescription: 'A carrot being sliced',
    type: 'ingredient',
});

// ---------------------------------------------------------------------------
// isIconSearchMatched — confidence indicator logic
// ---------------------------------------------------------------------------

describe('isIconSearchMatched', () => {

    it('returns true when iconQuery exists and method is not exact_name', () => {
        const node: RecipeNode = {
            ...baseNode(),
            iconQuery: { queryUsed: 'sliced carrot', method: 'hyde_avg_firestore' },
        };
        assert.strictEqual(isIconSearchMatched(node), true);
    });

    it('returns false when iconQuery is absent', () => {
        const node: RecipeNode = { ...baseNode() };
        assert.strictEqual(isIconSearchMatched(node), false);
    });

    it('returns false when iconQuery.method is exact_name', () => {
        const node: RecipeNode = {
            ...baseNode(),
            iconQuery: { queryUsed: 'carrot', method: 'exact_name' },
        };
        assert.strictEqual(isIconSearchMatched(node), false);
    });

    it('returns true for any non-exact_name method string', () => {
        const methods = ['siglip', 'clip', 'text_embed', 'hyde_avg_firestore'];
        for (const method of methods) {
            const node: RecipeNode = {
                ...baseNode(),
                iconQuery: { queryUsed: 'test', method },
            };
            assert.strictEqual(
                isIconSearchMatched(node),
                true,
                `expected true for method="${method}"`,
            );
        }
    });
});

// ---------------------------------------------------------------------------
// currentShortlistIndex
// ---------------------------------------------------------------------------

describe('currentShortlistIndex', () => {

    it('returns -1 when iconShortlist is absent', () => {
        const node: RecipeNode = { ...baseNode(), icon: makeIcon('a') };
        assert.strictEqual(currentShortlistIndex(node), -1);
    });

    it('returns -1 when icon is absent', () => {
        const node: RecipeNode = {
            ...baseNode(),
            iconShortlist: [makeIcon('a'), makeIcon('b')],
        };
        assert.strictEqual(currentShortlistIndex(node), -1);
    });

    it('returns the correct index when the current icon is in the shortlist', () => {
        const icons = [makeIcon('a'), makeIcon('b'), makeIcon('c')];
        const node: RecipeNode = {
            ...baseNode(),
            icon: makeIcon('b'),
            iconShortlist: icons,
        };
        assert.strictEqual(currentShortlistIndex(node), 1);
    });

    it('returns -1 when the current icon id is not present in the shortlist', () => {
        const node: RecipeNode = {
            ...baseNode(),
            icon: makeIcon('z'),
            iconShortlist: [makeIcon('a'), makeIcon('b')],
        };
        assert.strictEqual(currentShortlistIndex(node), -1);
    });
});

// ---------------------------------------------------------------------------
// nextShortlistIcon — shortlist cycling
// ---------------------------------------------------------------------------

describe('nextShortlistIcon', () => {

    it('returns null when iconShortlist is absent', () => {
        const node: RecipeNode = { ...baseNode(), icon: makeIcon('a') };
        assert.strictEqual(nextShortlistIcon(node), null);
    });

    it('returns null when iconShortlist is empty', () => {
        const node: RecipeNode = {
            ...baseNode(),
            icon: makeIcon('a'),
            iconShortlist: [],
        };
        assert.strictEqual(nextShortlistIcon(node), null);
    });

    it('returns the next shortlist entry when there are remaining entries after current', () => {
        const icons = [makeIcon('a'), makeIcon('b'), makeIcon('c')];
        const node: RecipeNode = {
            ...baseNode(),
            icon: makeIcon('a'),
            iconShortlist: icons,
        };
        const next = nextShortlistIcon(node);
        assert.ok(next !== null, 'should return a next icon');
        assert.strictEqual(next!.id, 'b');
    });

    it('returns null when the current icon is already the last shortlist entry', () => {
        const icons = [makeIcon('a'), makeIcon('b'), makeIcon('c')];
        const node: RecipeNode = {
            ...baseNode(),
            icon: makeIcon('c'),
            iconShortlist: icons,
        };
        assert.strictEqual(nextShortlistIcon(node), null,
            'shortlist is exhausted — should fall through to Firestore path');
    });

    it('returns the first shortlist entry when the current icon is not in the shortlist', () => {
        // idx === -1, so nextIdx === 0 which is valid
        const icons = [makeIcon('x'), makeIcon('y')];
        const node: RecipeNode = {
            ...baseNode(),
            icon: makeIcon('unknown'),
            iconShortlist: icons,
        };
        const next = nextShortlistIcon(node);
        assert.ok(next !== null);
        assert.strictEqual(next!.id, 'x');
    });

    it('cycles through the full shortlist before returning null', () => {
        const icons = [makeIcon('a'), makeIcon('b'), makeIcon('c')];

        // Simulate cycling by advancing the node each step
        let node: RecipeNode = {
            ...baseNode(),
            icon: makeIcon('a'),
            iconShortlist: icons,
        };

        const visited: string[] = [node.icon!.id];

        let next = nextShortlistIcon(node);
        while (next !== null) {
            visited.push(next.id);
            node = { ...node, icon: next };
            next = nextShortlistIcon(node);
        }

        assert.deepStrictEqual(visited, ['a', 'b', 'c'],
            'should cycle through all shortlist entries before exhausting');
    });
});
