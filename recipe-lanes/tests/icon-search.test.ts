import { describe, it } from 'node:test';
import assert from 'node:assert';
import { searchIconsForNode, IconSearchResult } from '../lib/recipe-lanes/icon-search';
import type { SearchTerm } from '../lib/recipe-lanes/types';
import type { IconStats } from '../lib/recipe-lanes/types';
import { FirebaseDataService } from '../lib/data-service';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const makeIcon = (id: string): IconStats => ({
    id,
    url: `https://example.com/icons/${id}.png`,
    score: 0.9,
});

/** A minimal embedText stub — returns a fixed 3-element embedding. */
const stubEmbedText = async (_texts: string[]): Promise<number[]> =>
    [0.1, 0.2, 0.3];

// ---------------------------------------------------------------------------
// searchIconsForNode
// ---------------------------------------------------------------------------

describe('searchIconsForNode', () => {

    it('returns shortlist in the order provided by findNearest, and populates queryUsed and method', async () => {
        const icons = [makeIcon('a'), makeIcon('b'), makeIcon('c')];

        const findNearest = async (_vec: number[], _limit: number): Promise<IconStats[]> =>
            icons;

        const result: IconSearchResult = await searchIconsForNode(
            ['slice thinly', 'sharp knife', 'julienne cut'],
            stubEmbedText,
            findNearest,
        );

        assert.strictEqual(result.shortlist.length, 3);
        assert.strictEqual(result.shortlist[0].id, 'a');
        assert.strictEqual(result.shortlist[1].id, 'b');
        assert.strictEqual(result.shortlist[2].id, 'c');

        // queryUsed must be a non-empty string
        assert.ok(typeof result.queryUsed === 'string' && result.queryUsed.length > 0,
            'queryUsed should be a non-empty string');

        // method must be a non-empty string
        assert.ok(typeof result.method === 'string' && result.method.length > 0,
            'method should be a non-empty string');
    });

    it('filters out icons whose ids appear in excludeIds', async () => {
        const icons = [makeIcon('a'), makeIcon('b'), makeIcon('c')];

        const findNearest = async (_vec: number[], _limit: number): Promise<IconStats[]> =>
            icons;

        const result = await searchIconsForNode(
            ['sauté briefly'],
            stubEmbedText,
            findNearest,
            { excludeIds: ['b'] },
        );

        assert.strictEqual(result.shortlist.length, 2);
        assert.ok(result.shortlist.every(icon => icon.id !== 'b'),
            'excluded id "b" must not appear in shortlist');
    });

    it('returns only up to opts.limit icons when provided', async () => {
        const icons = [makeIcon('a'), makeIcon('b'), makeIcon('c'), makeIcon('d')];

        const findNearest = async (_vec: number[], limit: number): Promise<IconStats[]> =>
            icons.slice(0, limit);

        const result = await searchIconsForNode(
            ['roast at 200c'],
            stubEmbedText,
            findNearest,
            { limit: 2 },
        );

        assert.ok(result.shortlist.length <= 2,
            'shortlist length should not exceed opts.limit');
    });

    it('returns an empty shortlist gracefully when hydeQueries is empty', async () => {
        let findNearestCalled = false;
        const findNearest = async (_vec: number[], _limit: number): Promise<IconStats[]> => {
            findNearestCalled = true;
            return [];
        };

        const result = await searchIconsForNode(
            [],            // empty hydeQueries
            stubEmbedText,
            findNearest,
        );

        // Must not throw; shortlist must be an array
        assert.ok(Array.isArray(result.shortlist), 'shortlist must be an array');
        assert.strictEqual(result.shortlist.length, 0);
    });

    it('excludeIds with an empty list does not filter anything', async () => {
        const icons = [makeIcon('x'), makeIcon('y')];

        const findNearest = async (_vec: number[], _limit: number): Promise<IconStats[]> =>
            icons;

        const result = await searchIconsForNode(
            ['blend until smooth'],
            stubEmbedText,
            findNearest,
            { excludeIds: [] },
        );

        assert.strictEqual(result.shortlist.length, 2);
    });

    it('filters multiple excludeIds simultaneously', async () => {
        const icons = [makeIcon('a'), makeIcon('b'), makeIcon('c'), makeIcon('d')];

        const findNearest = async (_vec: number[], _limit: number): Promise<IconStats[]> =>
            icons;

        const result = await searchIconsForNode(
            ['fold gently'],
            stubEmbedText,
            findNearest,
            { excludeIds: ['a', 'c'] },
        );

        assert.strictEqual(result.shortlist.length, 2);
        assert.ok(result.shortlist.every(i => i.id !== 'a' && i.id !== 'c'));
    });

    it('forwards the averaged embedding vector to findNearest', async () => {
        let capturedVec: number[] | null = null;
        const findNearest = async (vec: number[], _limit: number): Promise<IconStats[]> => {
            capturedVec = vec;
            return [];
        };

        const fixedEmbedding = [0.5, 0.6, 0.7];
        const embedText = async (_texts: string[]): Promise<number[]> => fixedEmbedding;

        await searchIconsForNode(['whisk eggs'], embedText, findNearest);

        assert.deepStrictEqual(capturedVec, fixedEmbedding,
            'the embedding returned by embedText must be forwarded to findNearest');
    });
});

// ---------------------------------------------------------------------------
// FirebaseDataService.searchIconsByEmbedding
// ---------------------------------------------------------------------------

describe('FirebaseDataService.searchIconsByEmbedding', () => {

    it('calls collection("icon_index").findNearest with field "embedding" and the provided vector', async () => {
        const queryVec = [0.1, 0.2, 0.3];
        const limit = 5;

        // Capture calls made on the fake Firestore collection
        const capturedArgs: { fieldPath?: string, queryVector?: number[], limit?: number } = {};

        const fakeQuerySnapshot = {
            docs: [
                {
                    data: () => ({ id: 'icon1', url: 'https://example.com/icon1.png', score: 0.88 }),
                    id: 'icon1',
                },
            ],
        };

        const fakeCollection = {
            findNearest: (fieldPath: string, queryVector: number[], opts: { limit: number }) => {
                capturedArgs.fieldPath = fieldPath;
                capturedArgs.queryVector = queryVector;
                capturedArgs.limit = opts.limit;
                return { get: async () => fakeQuerySnapshot };
            },
        };

        // Patch db on the service instance
        const service = new FirebaseDataService();
        // @ts-ignore — patching internal db for the test
        service._db = { collection: (name: string) => {
            assert.strictEqual(name, 'icon_index',
                'must query the "icon_index" collection');
            return fakeCollection;
        }};

        const results: IconStats[] = await service.searchIconsByEmbedding(queryVec, limit);

        assert.strictEqual(capturedArgs.fieldPath, 'embedding',
            'findNearest must be called with field path "embedding"');
        assert.deepStrictEqual(capturedArgs.queryVector, queryVec,
            'query vector must be passed through unchanged');
        assert.strictEqual(capturedArgs.limit, limit,
            'limit must be passed through to findNearest');

        assert.ok(Array.isArray(results), 'result must be an array');
    });

    it('maps Firestore documents back to IconStats objects', async () => {
        const fakeDoc = {
            data: () => ({
                id: 'icon42',
                url: 'https://example.com/icon42.png',
                score: 0.75,
                prompt: 'a sliced lemon',
                impressions: 3,
                rejections: 1,
            }),
            id: 'icon42',
        };

        const fakeQuerySnapshot = { docs: [fakeDoc] };

        const fakeCollection = {
            findNearest: (_fp: string, _vec: number[], _opts: any) => ({
                get: async () => fakeQuerySnapshot,
            }),
        };

        const service = new FirebaseDataService();
        // @ts-ignore
        service._db = { collection: () => fakeCollection };

        const results: IconStats[] = await service.searchIconsByEmbedding([0.1, 0.2], 10);

        assert.strictEqual(results.length, 1);
        const icon = results[0];
        assert.strictEqual(icon.id, 'icon42');
        assert.strictEqual(icon.url, 'https://example.com/icon42.png');
        assert.strictEqual(icon.score, 0.75);
    });
});

// ---------------------------------------------------------------------------
// SearchTerm type shape (compile-time check via instantiation)
// ---------------------------------------------------------------------------

describe('SearchTerm type shape', () => {

    it('accepts a valid SearchTerm with all fields', () => {
        const term: SearchTerm = {
            text: 'diced onion',
            embedding: [0.1, 0.2, 0.3],
            source: 'hyde_from_img',
            addedAt: Date.now(),
        };
        assert.strictEqual(term.text, 'diced onion');
        assert.strictEqual(term.source, 'hyde_from_img');
        assert.ok(Array.isArray(term.embedding));
        assert.ok(typeof term.addedAt === 'number');
    });

    it('accepts a SearchTerm without the optional embedding field', () => {
        const term: SearchTerm = {
            text: 'coarsely chopped walnut',
            source: 'user_desc',
            addedAt: 1700000000000,
        };
        assert.strictEqual(term.source, 'user_desc');
        assert.strictEqual(term.embedding, undefined);
    });

    it('accepts all valid source values', () => {
        const sources: SearchTerm['source'][] = ['hyde_from_img', 'user_desc', 'llm_vision'];
        for (const source of sources) {
            const term: SearchTerm = { text: 'test', source, addedAt: 0 };
            assert.strictEqual(term.source, source);
        }
    });
});

// ---------------------------------------------------------------------------
// RecipeNode iconShortlist / iconQuery fields (compile-time + runtime shape)
// ---------------------------------------------------------------------------

describe('RecipeNode extended fields', () => {

    it('accepts iconShortlist on a RecipeNode', () => {
        // Import RecipeNode type to ensure the field exists at compile time
        const node: import('../lib/recipe-lanes/types').RecipeNode = {
            id: 'n1',
            laneId: 'l1',
            text: 'Slice carrots',
            visualDescription: 'A carrot being sliced',
            type: 'action',
            iconShortlist: [makeIcon('icon1'), makeIcon('icon2')],
        };
        assert.strictEqual(node.iconShortlist?.length, 2);
        assert.strictEqual(node.iconShortlist?.[0].id, 'icon1');
    });

    it('accepts iconQuery on a RecipeNode', () => {
        const node: import('../lib/recipe-lanes/types').RecipeNode = {
            id: 'n2',
            laneId: 'l1',
            text: 'Roast garlic',
            visualDescription: 'Garlic cloves roasting',
            type: 'action',
            iconQuery: {
                queryUsed: 'roasted garlic cloves golden brown',
                method: 'hyde_avg_firestore',
                outcome: 'accepted',
            },
        };
        assert.strictEqual(node.iconQuery?.method, 'hyde_avg_firestore');
        assert.strictEqual(node.iconQuery?.outcome, 'accepted');
    });

    it('accepts iconQuery without outcome (optional field)', () => {
        const node: import('../lib/recipe-lanes/types').RecipeNode = {
            id: 'n3',
            laneId: 'l1',
            text: 'Boil pasta',
            visualDescription: 'Pasta boiling in water',
            type: 'action',
            iconQuery: {
                queryUsed: 'pasta boiling water',
                method: 'hyde_avg_firestore',
            },
        };
        assert.strictEqual(node.iconQuery?.outcome, undefined);
    });

    it('accepts searchTerms on IconStats', () => {
        const icon: IconStats = {
            id: 'i1',
            url: 'https://example.com/i1.png',
            searchTerms: [
                { text: 'boiling pasta', source: 'hyde_from_img', addedAt: 1000 },
                { text: 'al dente noodles', source: 'llm_vision', addedAt: 2000, embedding: [0.4, 0.5] },
            ],
        };
        assert.strictEqual(icon.searchTerms?.length, 2);
        assert.strictEqual(icon.searchTerms?.[1].source, 'llm_vision');
    });
});
