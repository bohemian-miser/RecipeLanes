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

// The comparison table's label → category join: cache hits, the bounded
// classify-on-miss call, its write-through, and every degradation path.
//
// Pure tier: Firestore, Genkit and the clock are all injected, so nothing here
// touches an emulator or a model. (Importing the module must not reach them
// either — the production deps are lazily imported inside the module.)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    lookupIngredientCategories,
    CLASSIFY_TIMEOUT_MS,
    MAX_CLASSIFY_ON_MISS,
    ON_MISS_SOURCE,
    type ClassifierResponse,
    type IngredientCategoryDoc,
    type IngredientCategoryWrite,
} from '../lib/ingredient-category-lookup';
import { ingredientCategoryDocId, ingredientCategoryKey } from '../lib/recipe-lanes/ingredient-label-extract';

/** The lookup returns a null-prototype object; deep-equality needs a plain one. */
function plain(result: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(result));
}

/**
 * A stub set with recording, so a test can assert both the answer and what the
 * lookup did to get it. `stored` is the pretend `ingredient_categories`
 * collection, keyed by doc id.
 */
function harness(options: {
    stored?: Record<string, unknown>;
    classify?: (prompt: string) => Promise<ClassifierResponse>;
    readCategories?: (docIds: string[]) => Promise<IngredientCategoryDoc[]>;
} = {}) {
    const prompts: string[] = [];
    const writes: IngredientCategoryWrite[][] = [];
    const reads: string[][] = [];
    const stored = options.stored ?? {};
    let writeResolved!: () => void;
    const writeSettled = new Promise<void>(resolve => { writeResolved = resolve; });

    const deps = {
        readCategories: options.readCategories ?? (async (docIds: string[]) => {
            reads.push(docIds);
            return docIds
                .filter(id => id in stored)
                .map(id => ({ id, category: stored[id] }));
        }),
        classify: async (prompt: string): Promise<ClassifierResponse> => {
            prompts.push(prompt);
            if (options.classify) return options.classify(prompt);
            return { text: '{}', model: 'test-model' };
        },
        writeCategories: async (entries: IngredientCategoryWrite[]) => {
            writes.push(entries);
            writeResolved();
        },
        now: () => new Date('2026-09-16T00:00:00.000Z'),
        timeoutMs: 50,
    };

    return { deps, prompts, writes, reads, writeSettled };
}

/** A classifier that answers every label it was asked about with `category`. */
function answersEverythingWith(category: string) {
    return async (prompt: string): Promise<ClassifierResponse> => {
        const labels = [...prompt.matchAll(/^"(.*)"$/gm)].map(m => JSON.parse(`"${m[1]}"`) as string);
        return {
            text: JSON.stringify(Object.fromEntries(labels.map(l => [l, category]))),
            model: 'test-model',
        };
    };
}

describe('ingredient-category-lookup — cache hits', () => {
    it('returns stored categories keyed by the row key, with no model call', async () => {
        const h = harness({
            stored: {
                [ingredientCategoryDocId('Olive Oil')!]: 'fats_oils',
                [ingredientCategoryDocId('Garlic')!]: 'aromatics',
            },
        });
        const result = await lookupIngredientCategories(['Olive Oil', 'Garlic'], h.deps);
        assert.deepEqual(plain(result), { 'olive oil': 'fats_oils', garlic: 'aromatics' });
        assert.deepEqual(h.prompts, []);
        assert.deepEqual(h.writes, []);
    });

    it('reads each distinct label once, in chunks of at most 100 refs', async () => {
        const labels = Array.from({ length: 250 }, (_, i) => `Label ${i}`);
        const h = harness();
        await lookupIngredientCategories([...labels, ...labels], h.deps);
        assert.deepEqual(h.reads.map(r => r.length), [100, 100, 50]);
    });

    it('needs only one read round trip for a realistic comparison', async () => {
        const h = harness();
        await lookupIngredientCategories(Array.from({ length: 80 }, (_, i) => `Label ${i}`), h.deps);
        assert.equal(h.reads.length, 1);
    });

    it('ignores a stored category that is not in the taxonomy', async () => {
        const h = harness({ stored: { [ingredientCategoryDocId('Garlic')!]: 'legacy_bucket' } });
        const result = await lookupIngredientCategories(['Garlic'], h.deps);
        assert.equal(result[ingredientCategoryKey('Garlic')], undefined);
    });

    it('skips labels that cannot be a document id, and returns {} for none left', async () => {
        const h = harness();
        const result = await lookupIngredientCategories(['   ', '__proto__'], h.deps);
        assert.deepEqual(plain(result), {});
        assert.deepEqual(h.reads, []);
        assert.deepEqual(h.prompts, []);
    });
});

describe('ingredient-category-lookup — classify on miss', () => {
    it('classifies misses in ONE call and returns them alongside the hits', async () => {
        const h = harness({
            stored: { [ingredientCategoryDocId('Garlic')!]: 'aromatics' },
            classify: answersEverythingWith('vegetables'),
        });
        const result = await lookupIngredientCategories(['Garlic', 'Kohlrabi', 'Salsify'], h.deps);
        assert.deepEqual(plain(result), {
            garlic: 'aromatics',
            kohlrabi: 'vegetables',
            salsify: 'vegetables',
        });
        assert.equal(h.prompts.length, 1);
        // Only the misses are prompted about.
        assert.ok(h.prompts[0].includes('"Kohlrabi"'));
        assert.ok(!h.prompts[0].includes('"Garlic"'));
    });

    it(`caps one request at ${MAX_CLASSIFY_ON_MISS} labels`, async () => {
        const labels = Array.from({ length: MAX_CLASSIFY_ON_MISS + 5 }, (_, i) => `Mystery ${i}`);
        const h = harness({ classify: answersEverythingWith('other') });
        const result = await lookupIngredientCategories(labels, h.deps);
        assert.equal(h.prompts.length, 1);
        assert.equal(Object.keys(plain(result)).length, MAX_CLASSIFY_ON_MISS);
        // The overflow is left uncategorised for a later view, not dropped.
        assert.equal(result[ingredientCategoryKey('Mystery 44')], undefined);
    });

    it('writes the classified labels through to the lookup collection', async () => {
        const h = harness({ classify: answersEverythingWith('nuts_seeds') });
        await lookupIngredientCategories(['Pili Nuts'], h.deps);
        await h.writeSettled;
        assert.deepEqual(h.writes, [[{
            docId: ingredientCategoryDocId('Pili Nuts')!,
            label: 'Pili Nuts',
            category: 'nuts_seeds',
            source: ON_MISS_SOURCE,
            model: 'test-model',
            classifiedAt: new Date('2026-09-16T00:00:00.000Z'),
        }]]);
    });

    it('returns the categories even when the write-through fails', async () => {
        const h = harness({ classify: answersEverythingWith('fruits') });
        h.deps.writeCategories = async () => { throw new Error('firestore down'); };
        const result = await lookupIngredientCategories(['Feijoa'], h.deps);
        assert.equal(result[ingredientCategoryKey('Feijoa')], 'fruits');
    });

    it('drops labels the model answered with a bogus category', async () => {
        const h = harness({
            classify: async () => ({ text: '{"Feijoa": "snacks"}', model: 'test-model' }),
        });
        const result = await lookupIngredientCategories(['Feijoa'], h.deps);
        assert.deepEqual(plain(result), {});
        assert.deepEqual(h.writes, []);
    });

    it('survives a response that is not JSON at all', async () => {
        const h = harness({
            classify: async () => ({ text: 'ai failed', model: 'test-model' }),
        });
        assert.deepEqual(plain(await lookupIngredientCategories(['Feijoa'], h.deps)), {});
    });
});

describe('ingredient-category-lookup — degradation', () => {
    it('returns the hits it already has when the classifier times out', async () => {
        const h = harness({
            stored: { [ingredientCategoryDocId('Garlic')!]: 'aromatics' },
            classify: () => new Promise<ClassifierResponse>(() => { /* never settles */ }),
        });
        const started = Date.now();
        const result = await lookupIngredientCategories(['Garlic', 'Kohlrabi'], h.deps);
        assert.deepEqual(plain(result), { garlic: 'aromatics' });
        // Bounded by the injected timeout (50ms), not by the model.
        assert.ok(Date.now() - started < CLASSIFY_TIMEOUT_MS);
        assert.deepEqual(h.writes, []);
    });

    it('still fills the cache when the answer lands after the timeout', async () => {
        // The timeout bounds how long the USER waits, not whether a paid-for
        // answer is worth keeping: the next viewer should get a cache hit
        // rather than repeating the identical slow call forever.
        let answer!: (r: ClassifierResponse) => void;
        const h = harness({ classify: () => new Promise<ClassifierResponse>(res => { answer = res; }) });

        const result = await lookupIngredientCategories(['Feijoa'], h.deps);
        assert.deepEqual(plain(result), {}, 'too late for this request');

        answer({ text: '{"Feijoa": "fruits"}', model: 'test-model' });
        await h.writeSettled;
        assert.equal(h.writes.length, 1);
        assert.equal(h.writes[0][0].category, 'fruits');
    });

    it('returns the hits it already has when the classifier throws', async () => {
        const h = harness({
            stored: { [ingredientCategoryDocId('Garlic')!]: 'aromatics' },
            classify: async () => { throw new Error('vertex 503'); },
        });
        assert.deepEqual(plain(await lookupIngredientCategories(['Garlic', 'Kohlrabi'], h.deps)), {
            garlic: 'aromatics',
        });
    });

    it('returns an empty map, and never classifies, when the read fails', async () => {
        const h = harness({
            readCategories: async () => { throw new Error('firestore down'); },
            classify: answersEverythingWith('vegetables'),
        });
        assert.deepEqual(plain(await lookupIngredientCategories(['Kohlrabi'], h.deps)), {});
        assert.deepEqual(h.prompts, []);
    });

    it('returns {} for no labels without touching Firestore', async () => {
        const h = harness();
        assert.deepEqual(plain(await lookupIngredientCategories([], h.deps)), {});
        assert.deepEqual(h.reads, []);
    });
});

describe('ingredient-category-lookup — mock AI', () => {
    // The mock is selected by DI, never by an env flag (see
    // tests/verify-production-logic.test.ts), so what matters is that the
    // MockAIService's canned answer degrades cleanly rather than that some
    // flag short-circuits the call.
    it('degrades to "no category" on the MockAIService response, and writes nothing', async () => {
        const h = harness({
            stored: { [ingredientCategoryDocId('Garlic')!]: 'aromatics' },
            // Shape MockAIService.generateText falls through to for an
            // unrecognised prompt: a recipe graph, not a label→category map.
            classify: async () => ({
                text: JSON.stringify({
                    title: 'Mock Recipe',
                    lanes: [{ id: 'l1', label: 'Prep', type: 'prep' }],
                    nodes: [{ id: '1', laneId: 'l1', text: 'Mock Ingredient 1', type: 'ingredient' }],
                }),
                model: 'mock',
            }),
        });
        const result = await lookupIngredientCategories(['Garlic', 'Kohlrabi'], h.deps);
        // Cache hits still resolve; only the unclassifiable miss drops out.
        assert.deepEqual(plain(result), { garlic: 'aromatics' });
        assert.deepEqual(h.writes, []);
    });
});
