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

// The comparison table's label → {category, raw ingredient} join: cache hits,
// the bounded classify-on-miss call, its write-through, and every degradation
// path.
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
    type IngredientLookupEntry,
} from '../lib/ingredient-category-lookup';
import {
    MAX_RAW_INGREDIENT_LENGTH,
    RAW_INGREDIENT_RULES,
    RAW_RULES_VERSION,
} from '../lib/recipe-lanes/ingredient-taxonomy';
import { ingredientCategoryDocId, ingredientCategoryKey } from '../lib/recipe-lanes/ingredient-label-extract';

/** The lookup returns a null-prototype object; deep-equality needs a plain one. */
function plain(
    result: Record<string, IngredientLookupEntry>,
): Record<string, IngredientLookupEntry> {
    return Object.fromEntries(Object.entries(result));
}

/**
 * One entry of the pretend collection. A bare value is shorthand for a doc
 * carrying only that category — the shape most of these tests care about — and
 * an object is the doc's fields verbatim, so a test can store a raw ingredient
 * (or a deliberately broken one) alongside.
 */
function storedDoc(id: string, value: unknown): IngredientCategoryDoc {
    return typeof value === 'object' && value !== null
        ? { id, ...(value as Omit<IngredientCategoryDoc, 'id'>) }
        : { id, category: value };
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
            return docIds.filter(id => id in stored).map(id => storedDoc(id, stored[id]));
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

/**
 * A classifier that answers every label it was asked about with `category`.
 *
 * With no `rawFor` it answers in the bare-id shape, which is what a model that
 * ignored the object contract would send. With one it answers in the object
 * shape the `includeRaw` prompt asks for; a `rawFor` returning undefined omits
 * the field entirely, the way a model that had no name for a label would.
 */
function answersEverythingWith(category: string, rawFor?: (label: string) => unknown) {
    return async (prompt: string): Promise<ClassifierResponse> => {
        const labels = promptLabels(prompt);
        return {
            text: JSON.stringify(Object.fromEntries(labels.map(l => [
                l,
                rawFor ? { category, raw: rawFor(l) } : category,
            ]))),
            model: 'test-model',
        };
    };
}

/** The labels a prompt asked about — one JSON string per line in its label block. */
function promptLabels(prompt: string): string[] {
    return [...prompt.matchAll(/^"(.*)"$/gm)].map(m => JSON.parse(`"${m[1]}"`) as string);
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
        assert.deepEqual(plain(result), {
            'olive oil': { category: 'fats_oils' },
            garlic: { category: 'aromatics' },
        });
        assert.deepEqual(h.prompts, []);
        assert.deepEqual(h.writes, []);
    });

    it('returns the stored raw ingredient alongside the category', async () => {
        const h = harness({
            stored: {
                [ingredientCategoryDocId('Carrot, Chopped')!]: {
                    category: 'vegetables',
                    rawIngredient: 'Carrot',
                },
            },
        });
        const result = await lookupIngredientCategories(['Carrot, Chopped'], h.deps);
        assert.deepEqual(plain(result), {
            'carrot, chopped': { category: 'vegetables', raw: 'Carrot' },
        });
        assert.deepEqual(h.prompts, [], 'a complete doc is a hit, not a miss');
    });

    it('leaves raw absent on a doc the pre-raw backfill wrote', async () => {
        // The entire production corpus looks like this until the raw pass runs:
        // a perfectly good category and no rawIngredient field at all. Absence
        // must read as identity, not as a reason to re-classify.
        const h = harness({ stored: { [ingredientCategoryDocId('Garlic')!]: 'aromatics' } });
        const result = await lookupIngredientCategories(['Garlic'], h.deps);
        assert.deepEqual(plain(result), { garlic: { category: 'aromatics' } });
        assert.equal('raw' in result['garlic'], false, 'absent, not undefined');
        assert.deepEqual(h.prompts, []);
    });

    it('ignores a stored raw ingredient that is not a usable name', async () => {
        // The bound is the parser's, applied to the DATABASE too: every
        // writer bounds what it stores today, but docs written before those
        // bounds existed are still there and docs get hand-edited, and
        // whatever survives here becomes a row label.
        //
        // Over-long values are REJECTED rather than truncated — see the read
        // site for why an over-merge on a shared 80-character prefix is the
        // worse trade than keeping the row where it already is.
        for (const rawIngredient of [
            '',
            '   ',
            42,
            null,
            { name: 'Carrot' },
            ['Carrot'],
            'C'.repeat(MAX_RAW_INGREDIENT_LENGTH + 1),
            'Carrot\nStick',
            'Carrot\u2028Stick',
        ]) {
            const h = harness({
                stored: {
                    [ingredientCategoryDocId('Carrot, Chopped')!]: {
                        category: 'vegetables',
                        rawIngredient,
                    },
                },
            });
            const result = await lookupIngredientCategories(['Carrot, Chopped'], h.deps);
            // The category survives — a bad raw only costs the merge.
            assert.deepEqual(
                plain(result),
                { 'carrot, chopped': { category: 'vegetables' } },
                `raw ${JSON.stringify(rawIngredient)} must be dropped`,
            );
        }
    });

    it('drops a stored raw ingredient the ambiguous-word guard refuses', async () => {
        // A doc written before a word joined AMBIGUOUS_RAW (or by any writer
        // that skipped the parser) must not key rows on it: the read side
        // re-applies the guard, so the row falls back to its own label.
        const h = harness({
            stored: {
                [ingredientCategoryDocId('Pepper, Sliced')!]: { category: 'vegetables', rawIngredient: 'Pepper' },
                [ingredientCategoryDocId('Cloves, Minced')!]: { category: 'aromatics', rawIngredient: 'Garlic Clove' },
                [ingredientCategoryDocId('Garlic Cloves, Minced')!]: { category: 'aromatics', rawIngredient: 'Garlic Clove' },
            },
        });
        const result = await lookupIngredientCategories(
            ['Pepper, Sliced', 'Cloves, Minced', 'Garlic Cloves, Minced'],
            h.deps,
        );
        assert.deepEqual(plain(result), {
            'pepper, sliced': { category: 'vegetables' },
            'cloves, minced': { category: 'aromatics' },
            'garlic cloves, minced': { category: 'aromatics', raw: 'Garlic Clove' },
        });
        assert.deepEqual(h.prompts, [], 'a guarded raw is still a hit, not a reason to re-classify');
    });

    it('keeps a stored raw ingredient exactly at the bound', async () => {
        const name = 'C'.repeat(MAX_RAW_INGREDIENT_LENGTH);
        const h = harness({
            stored: {
                [ingredientCategoryDocId('Carrot, Chopped')!]: {
                    category: 'vegetables',
                    rawIngredient: name,
                },
            },
        });
        const result = await lookupIngredientCategories(['Carrot, Chopped'], h.deps);
        assert.equal(result['carrot, chopped'].raw, name, 'the cap is inclusive');
    });

    it('trims a stored raw ingredient', async () => {
        const h = harness({
            stored: {
                [ingredientCategoryDocId('Carrot, Chopped')!]: {
                    category: 'vegetables',
                    rawIngredient: '  Carrot  ',
                },
            },
        });
        const result = await lookupIngredientCategories(['Carrot, Chopped'], h.deps);
        assert.equal(result['carrot, chopped'].raw, 'Carrot');
    });

    it('drops the whole entry when the category is unusable, raw and all', async () => {
        // A doc with a dead category is a miss: the classifier re-answers both
        // fields, so keeping half of the stale doc would only confuse the row.
        const h = harness({
            stored: {
                [ingredientCategoryDocId('Carrot, Chopped')!]: {
                    category: 'legacy_bucket',
                    rawIngredient: 'Carrot',
                },
            },
            classify: async () => ({ text: '{}', model: 'test-model' }),
        });
        const result = await lookupIngredientCategories(['Carrot, Chopped'], h.deps);
        assert.deepEqual(plain(result), {});
        assert.equal(h.prompts.length, 1, 'it is re-classified, not half-kept');
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
            garlic: { category: 'aromatics' },
            kohlrabi: { category: 'vegetables' },
            salsify: { category: 'vegetables' },
        });
        assert.equal(h.prompts.length, 1);
        // Only the misses are prompted about.
        assert.ok(h.prompts[0].includes('"Kohlrabi"'));
        assert.ok(!h.prompts[0].includes('"Garlic"'));
    });

    it('asks for the raw ingredient in that same one call', async () => {
        // One round trip answers both fields: a miss already pays for a model
        // call, and asking separately would make it two.
        const h = harness({ classify: answersEverythingWith('vegetables', () => 'Carrot') });
        const result = await lookupIngredientCategories(['Carrot, Chopped'], h.deps);
        assert.equal(h.prompts.length, 1);
        assert.ok(h.prompts[0].includes('RAW INGREDIENT:'), 'includeRaw prompt');
        assert.ok(h.prompts[0].includes(RAW_INGREDIENT_RULES), 'the rules verbatim');
        assert.deepEqual(plain(result), {
            'carrot, chopped': { category: 'vegetables', raw: 'Carrot' },
        });
    });

    it('standardizes the casing of the raw name the model returned', async () => {
        // The backfill stores `standardizeIngredientName(raw)`; if this path
        // stored the model's casing instead, the two writers would disagree
        // about the same doc's rawIngredient.
        const h = harness({ classify: answersEverythingWith('vegetables', () => 'cARROT') });
        const result = await lookupIngredientCategories(['Carrot, Chopped'], h.deps);
        assert.equal(result['carrot, chopped'].raw, 'Carrot');
    });

    // Executable version of the arithmetic in MAX_CLASSIFY_ON_MISS's doc
    // comment. Asking for a raw name took an entry from roughly 10 output
    // tokens to roughly 25, and the user is waiting on the generation, so the
    // cap and the timeout are one decision — raising either alone reopens the
    // regression where a full batch always loses the race and every label
    // renders in `other`. This fails if a later change moves one without the
    // other.
    it('keeps a full on-miss batch inside the latency budget', () => {
        const OUTPUT_TOKENS_PER_LABEL = 25;
        const TOKENS_PER_SECOND = 100; // conservative end of Flash's range
        // Whatever this leaves unspent is the allowance for connection setup
        // and prefill, which a flat token rate does not model.
        const budget = (CLASSIFY_TIMEOUT_MS / 1000) * TOKENS_PER_SECOND;
        assert.ok(
            MAX_CLASSIFY_ON_MISS * OUTPUT_TOKENS_PER_LABEL <= budget,
            `${MAX_CLASSIFY_ON_MISS} labels need `
            + `~${MAX_CLASSIFY_ON_MISS * OUTPUT_TOKENS_PER_LABEL} output tokens, `
            + `but ${CLASSIFY_TIMEOUT_MS}ms buys only ~${budget}`,
        );
    });

    it(`caps one request at ${MAX_CLASSIFY_ON_MISS} labels`, async () => {
        const labels = Array.from({ length: MAX_CLASSIFY_ON_MISS + 5 }, (_, i) => `Mystery ${i}`);
        const h = harness({ classify: answersEverythingWith('other', label => label) });
        const result = await lookupIngredientCategories(labels, h.deps);
        assert.equal(h.prompts.length, 1);
        assert.equal(promptLabels(h.prompts[0]).length, MAX_CLASSIFY_ON_MISS);
        assert.equal(Object.keys(plain(result)).length, MAX_CLASSIFY_ON_MISS);
        // The overflow is left uncategorised for a later view, not dropped.
        assert.equal(result[ingredientCategoryKey(labels[labels.length - 1])], undefined);
        await h.writeSettled;
        assert.equal(h.writes[0].length, MAX_CLASSIFY_ON_MISS, 'the write is capped too');
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

    it('writes the raw name through with its own rules version stamp', async () => {
        const h = harness({ classify: answersEverythingWith('vegetables', () => 'Carrot') });
        await lookupIngredientCategories(['Carrot, Chopped'], h.deps);
        await h.writeSettled;
        assert.deepEqual(h.writes, [[{
            docId: ingredientCategoryDocId('Carrot, Chopped')!,
            label: 'Carrot, Chopped',
            category: 'vegetables',
            rawIngredient: 'Carrot',
            rawRulesVersion: RAW_RULES_VERSION,
            source: ON_MISS_SOURCE,
            model: 'test-model',
            classifiedAt: new Date('2026-09-16T00:00:00.000Z'),
        }]]);
    });

    it('writes neither raw field when the model gave no usable name', async () => {
        // A stamp with no value would make the backfill read the doc as done
        // and never fill the raw name in — the rollout gap the separate
        // version counter exists to close. Absent means absent, both fields.
        for (const bad of [undefined, '', '   ', 'a'.repeat(200), 'Carrot\nStick', 7]) {
            const h = harness({ classify: answersEverythingWith('vegetables', () => bad) });
            const result = await lookupIngredientCategories(['Carrot, Chopped'], h.deps);
            await h.writeSettled;
            assert.deepEqual(
                plain(result),
                { 'carrot, chopped': { category: 'vegetables' } },
                `raw ${JSON.stringify(bad)} must be dropped`,
            );
            assert.deepEqual(Object.keys(h.writes[0][0]).sort(), [
                'category', 'classifiedAt', 'docId', 'label', 'model', 'source',
            ]);
        }
    });

    it('writes no raw name the ambiguous-word guard refuses', async () => {
        const h = harness({ classify: answersEverythingWith('vegetables', () => 'Pepper') });
        const result = await lookupIngredientCategories(['Pepper, Sliced'], h.deps);
        await h.writeSettled;
        assert.deepEqual(plain(result), { 'pepper, sliced': { category: 'vegetables' } });
        assert.equal('rawIngredient' in h.writes[0][0], false);
        assert.equal('rawRulesVersion' in h.writes[0][0], false);
    });

    it('returns the categories even when the write-through fails', async () => {
        const h = harness({ classify: answersEverythingWith('fruits') });
        h.deps.writeCategories = async () => { throw new Error('firestore down'); };
        const result = await lookupIngredientCategories(['Feijoa'], h.deps);
        assert.deepEqual(result[ingredientCategoryKey('Feijoa')], { category: 'fruits' });
    });

    it('keeps a category whose entry came back in the bare-id shape', async () => {
        // The option governs what we ASK for, not what arrives: a model that
        // ignores the object contract still contributes its categories, it
        // just contributes no merge hints.
        const h = harness({ classify: answersEverythingWith('fruits') });
        const result = await lookupIngredientCategories(['Feijoa'], h.deps);
        assert.deepEqual(plain(result), { feijoa: { category: 'fruits' } });
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
        assert.deepEqual(plain(result), { garlic: { category: 'aromatics' } });
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
            garlic: { category: 'aromatics' },
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
        assert.deepEqual(plain(result), { garlic: { category: 'aromatics' } });
        assert.deepEqual(h.writes, []);
        // And no raw name either — the unmerged path e2e exercises today.
        assert.equal(result['garlic'].raw, undefined);
    });
});
