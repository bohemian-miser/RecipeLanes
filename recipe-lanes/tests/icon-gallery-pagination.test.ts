/*
 * Regression tests for issue #280 — "fix pagination on icon_overview".
 *
 * The shared gallery pager derives its page count from the `total` returned by
 * getPagedIcons (`Math.ceil(total / limit)`). The old implementation returned an
 * *estimate* computed from the current page — `(page * limit) + icons.length` —
 * which always overshot by a full page, so the pager offered a "next" page that
 * did not exist and rendered empty. These tests pin `total` to the real size of
 * the matching set on both the unfiltered and the search path.
 *
 * Pure tier: the Firestore handle is patched on the service instance
 * (`service._db`), the same way tests/icon-search.test.ts does it, so no
 * emulator is needed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { FirebaseDataService } from '../lib/data-service';
import { DB_COLLECTION_ICON_INDEX, ICON_SEARCH_SCAN_LIMIT } from '../lib/config';

// ---------------------------------------------------------------------------
// Fake Firestore
// ---------------------------------------------------------------------------

type FakeDoc = { id: string; data: () => Record<string, any> };

interface RecordedCalls {
    collections: string[];
    orderBy: [string, string][];
    offsets: number[];
    limits: number[];
    countCalls: number;
}

/**
 * A minimal stand-in for the chained Firestore query builder. Each chaining call
 * returns a *new* query object, so a builder can be branched (the unfiltered path
 * reuses the ordered base query for both the page fetch and the count).
 *
 * `count()` reports the size of the whole collection regardless of offset/limit,
 * matching Firestore's aggregation semantics.
 */
function makeFakeDb(docs: FakeDoc[]) {
    const calls: RecordedCalls = { collections: [], orderBy: [], offsets: [], limits: [], countCalls: 0 };

    const makeQuery = (state: { offset?: number; limit?: number }): any => ({
        orderBy: (field: string, direction: string) => {
            calls.orderBy.push([field, direction]);
            return makeQuery(state);
        },
        offset: (n: number) => {
            calls.offsets.push(n);
            return makeQuery({ ...state, offset: n });
        },
        limit: (n: number) => {
            calls.limits.push(n);
            return makeQuery({ ...state, limit: n });
        },
        count: () => {
            calls.countCalls += 1;
            return { get: async () => ({ data: () => ({ count: docs.length }) }) };
        },
        get: async () => {
            const start = state.offset ?? 0;
            const end = state.limit === undefined ? docs.length : start + state.limit;
            return { docs: docs.slice(start, end) };
        },
    });

    return {
        db: {
            collection: (name: string) => {
                calls.collections.push(name);
                return makeQuery({});
            },
        },
        calls,
    };
}

const makeDoc = (index: number, name = `ingredient-${index}`): FakeDoc => ({
    id: `icon-${index}`,
    data: () => ({
        ingredient_name: name,
        visualDescription: name,
        created_at: null,
        // Embeddings are large and must never be shipped to the gallery client.
        embedding: [0.1, 0.2, 0.3],
        embedding_minilm: [0.4, 0.5],
    }),
});

const makeDocs = (count: number, name?: (i: number) => string): FakeDoc[] =>
    Array.from({ length: count }, (_, i) => makeDoc(i, name ? name(i) : undefined));

function serviceWith(docs: FakeDoc[]) {
    const fake = makeFakeDb(docs);
    const service = new FirebaseDataService();
    // @ts-expect-error — patching the internal Firestore handle for the test
    service._db = fake.db;
    return { service, calls: fake.calls };
}

// ---------------------------------------------------------------------------
// Unfiltered pagination
// ---------------------------------------------------------------------------

describe('getPagedIcons — unfiltered pagination (#280)', () => {

    it('reports the true collection size as total, not a page-derived estimate', async () => {
        // Exactly one full page exists. The old estimate returned (1 * 20) + 20 = 40,
        // which made the pager show "Page 1 of 2" and enable a next page that was empty.
        const { service, calls } = serviceWith(makeDocs(20));

        const res = await service.getPagedIcons(1, 20);

        assert.strictEqual(res.total, 20, 'total must be the real number of icons');
        assert.strictEqual(res.icons.length, 20);
        assert.strictEqual(Math.ceil(res.total / 20), 1, 'a single full page must not advertise a second page');
        assert.strictEqual(calls.countCalls, 1, 'the unfiltered path must use a count() aggregation');
    });

    it('queries icon_index newest-first and translates page/limit into offset/limit', async () => {
        const { service, calls } = serviceWith(makeDocs(100));

        const res = await service.getPagedIcons(3, 20);

        assert.deepStrictEqual(calls.collections, [DB_COLLECTION_ICON_INDEX]);
        assert.deepStrictEqual(calls.orderBy, [['created_at', 'desc']]);
        assert.ok(calls.offsets.includes(40), 'page 3 at limit 20 must skip 40 documents');
        assert.ok(calls.limits.includes(20), 'the page size must be pushed down to Firestore');
        assert.deepStrictEqual(res.icons.map((i: any) => i.id), makeDocs(100).slice(40, 60).map(d => d.id));
        assert.strictEqual(res.total, 100);
    });

    it('reports the full total on a partial last page', async () => {
        // 25 icons, page 2 of 20 → 5 icons. Old estimate: (2 * 20) + 5 = 45 → 3 pages.
        const { service } = serviceWith(makeDocs(25));

        const res = await service.getPagedIcons(2, 20);

        assert.strictEqual(res.icons.length, 5);
        assert.strictEqual(res.total, 25);
        assert.strictEqual(Math.ceil(res.total / 20), 2, 'the last page must be the last page');
    });

    it('still reports the real total when the requested page is past the end', async () => {
        // The old code returned (page - 1) * limit here, so an over-scrolled pager
        // reported a total that agreed with the bogus page it was already on and
        // the user was stranded on an empty view.
        const { service } = serviceWith(makeDocs(25));

        const res = await service.getPagedIcons(5, 20);

        assert.deepStrictEqual(res.icons, []);
        assert.strictEqual(res.total, 25, 'an over-scrolled page must still report the real total');
    });

    it('strips embeddings from gallery results', async () => {
        const { service } = serviceWith(makeDocs(1));

        const res = await service.getPagedIcons(1, 20);

        assert.strictEqual(res.icons.length, 1);
        assert.ok(!('embedding' in res.icons[0]), 'embedding must not be sent to the gallery');
        assert.ok(!('embedding_minilm' in res.icons[0]), 'embedding_minilm must not be sent to the gallery');
        assert.strictEqual(res.icons[0].id, 'icon-0');
    });

    it('treats a whitespace-only query as no query', async () => {
        // Previously `!query` was false for '   ' but `query.trim()` was falsy, so the
        // request fell between the two branches: 1000 unpaged icons, unsliced.
        const { service, calls } = serviceWith(makeDocs(50));

        const res = await service.getPagedIcons(1, 20, '   ');

        assert.strictEqual(res.icons.length, 20, 'a blank search must still be paged');
        assert.strictEqual(res.total, 50);
        assert.strictEqual(calls.countCalls, 1);
    });

    it('clamps a non-positive page to the first page', async () => {
        const { service, calls } = serviceWith(makeDocs(30));

        const res = await service.getPagedIcons(0, 20);

        assert.deepStrictEqual(calls.offsets, [0], 'page 0 must not produce a negative offset');
        assert.strictEqual(res.icons.length, 20);
        assert.strictEqual(res.total, 30);
    });
});

// ---------------------------------------------------------------------------
// Search pagination
// ---------------------------------------------------------------------------

describe('getPagedIcons — search pagination (#280)', () => {

    // 30 matching icons interleaved with 30 non-matching ones.
    const searchDocs = () => makeDocs(60, i => (i % 2 === 0 ? `tomato-${i}` : `onion-${i}`));

    it('reports the number of matches as total, not a page-derived estimate', async () => {
        const { service } = serviceWith(searchDocs());

        const res = await service.getPagedIcons(1, 20, 'tomato');

        assert.strictEqual(res.total, 30, 'total must count every match, not just this page');
        assert.strictEqual(res.icons.length, 20);
        assert.strictEqual(Math.ceil(res.total / 20), 2);
        assert.ok(res.icons.every((i: any) => i.ingredient_name.startsWith('tomato')));
    });

    it('slices the correct page out of the filtered set', async () => {
        const { service } = serviceWith(searchDocs());

        const res = await service.getPagedIcons(2, 20, 'tomato');

        assert.strictEqual(res.icons.length, 10, 'page 2 holds the remaining 10 matches');
        assert.strictEqual(res.total, 30);
        assert.strictEqual(res.icons[0].id, 'icon-40');
    });

    it('does not count the whole collection on the search path', async () => {
        // A count() here would return every icon in icon_index, not the matches,
        // and put the pager straight back into phantom-page territory.
        const { service, calls } = serviceWith(searchDocs());

        await service.getPagedIcons(1, 20, 'tomato');

        assert.strictEqual(calls.countCalls, 0);
        assert.ok(calls.limits.includes(ICON_SEARCH_SCAN_LIMIT), 'search scans the newest icons in one window');
        assert.deepStrictEqual(calls.offsets, [], 'search must not push an offset down to Firestore');
    });

    it('matches case-insensitively on visual description as well as ingredient name', async () => {
        const docs: FakeDoc[] = [
            { id: 'a', data: () => ({ ingredient_name: 'Onion', visualDescription: 'A ripe TOMATO', created_at: null }) },
            { id: 'b', data: () => ({ ingredient_name: 'Tomato', visualDescription: 'red thing', created_at: null }) },
            { id: 'c', data: () => ({ ingredient_name: 'Garlic', visualDescription: 'white bulb', created_at: null }) },
        ];
        const { service } = serviceWith(docs);

        const res = await service.getPagedIcons(1, 20, '  ToMaTo  ');

        assert.strictEqual(res.total, 2);
        assert.deepStrictEqual(res.icons.map((i: any) => i.id), ['a', 'b']);
    });

    it('returns an empty page and a zero total when nothing matches', async () => {
        const { service } = serviceWith(searchDocs());

        const res = await service.getPagedIcons(1, 20, 'saffron');

        assert.deepStrictEqual(res.icons, []);
        assert.strictEqual(res.total, 0);
    });
});
