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

// The distinct-label census the `backfill-ingredient-categories` script feeds
// to the classifier: which nodes count, how labels are normalised into lookup
// keys, and how usage is counted across a corpus. Pure — no Firestore, no LLM.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    collectIngredientLabels,
    createIngredientLabelCollector,
    ingredientCategoryDocId,
    ingredientCategoryKey,
} from '../lib/recipe-lanes/ingredient-label-extract';
import { ingredientRowKey } from '../lib/recipe-lanes/comparison-table';
import { RecipeGraph, RecipeNode } from '../lib/recipe-lanes/types';

function ingredient(id: string, overrides: Partial<RecipeNode> = {}): RecipeNode {
    return {
        id,
        laneId: 'lane-1',
        type: 'ingredient',
        text: `Node ${id}`,
        visualDescription: `Ingredient ${id}`,
        ...overrides,
    };
}

function action(id: string, overrides: Partial<RecipeNode> = {}): RecipeNode {
    return {
        id,
        laneId: 'lane-1',
        type: 'action',
        text: `Do ${id}`,
        visualDescription: `Doing ${id}`,
        ...overrides,
    };
}

function graph(nodes: RecipeNode[], overrides: Partial<RecipeGraph> = {}): RecipeGraph {
    return { lanes: [{ id: 'lane-1', label: 'Prep', type: 'prep' }], nodes, ...overrides };
}

/** The whole corpus the census cases below run against. */
function fixtureCorpus(): RecipeGraph[] {
    return [
        graph([
            ingredient('a1', { canonicalName: 'olive oil', quantity: 2, unit: 'tbsp', text: '2 tbsp olive oil' }),
            ingredient('a2', { canonicalName: 'Onion', quantity: 1, text: '1 onion' }),
            // Same ingredient twice in ONE recipe: two usages, one recipe.
            ingredient('a3', { canonicalName: 'onion', quantity: 1, text: '1 more onion' }),
            action('a4', { inputs: ['a1', 'a2'] }),
        ]),
        graph([
            // Different casing/accents and a different unit — still one key.
            ingredient('b1', { canonicalName: 'OLIVE OIL', quantity: 50, unit: 'ml' }),
            ingredient('b2', { canonicalName: 'Garlic', quantity: 3 }),
            // Nothing to name it with: skipped entirely.
            ingredient('b3', { canonicalName: '   ', visualDescription: '', text: '' }),
        ]),
    ];
}

describe('ingredient-label-extract — the lookup key', () => {
    it('is the label half of the comparison row key', () => {
        for (const label of ['Olive Oil', 'crème fraîche', 'SALT']) {
            assert.equal(`${ingredientCategoryKey(label)}|`, ingredientRowKey(label, ''));
        }
    });

    it('standardizes casing and strips diacritics, like the table does', () => {
        assert.equal(ingredientCategoryKey('OLIVE OIL'), 'olive oil');
        assert.equal(ingredientCategoryKey('  crème fraîche  '), 'creme fraiche');
        assert.equal(ingredientCategoryKey('   '), '');
    });
});

describe('ingredient-label-extract — the Firestore document id', () => {
    it('percent-encodes the key, so the id decodes back to the join key', () => {
        for (const label of ['Olive Oil', 'crème fraîche', 'Salt/Pepper', '100% Cocoa']) {
            const id = ingredientCategoryDocId(label);
            assert.ok(id, `${label} should be addressable`);
            assert.equal(decodeURIComponent(id!), ingredientCategoryKey(label));
        }
    });

    it('encodes a multi-word label without leaving a raw space', () => {
        assert.equal(ingredientCategoryDocId('Olive Oil'), 'olive%20oil');
    });

    it("encodes '/', which Firestore would otherwise read as a path separator", () => {
        const id = ingredientCategoryDocId('Salt/Pepper');
        assert.equal(id, 'salt%2Fpepper');
        assert.equal(id!.includes('/'), false, 'a raw slash would split the document path');
    });

    it("rejects the ids Firestore reserves: '', '.', '..'", () => {
        assert.equal(ingredientCategoryDocId(''), null);
        assert.equal(ingredientCategoryDocId('   '), null);
        assert.equal(ingredientCategoryDocId('.'), null);
        assert.equal(ingredientCategoryDocId('..'), null);
    });

    it("rejects __*__ ids — '__proto__' is a label a recipe can really produce", () => {
        assert.equal(ingredientCategoryDocId('__proto__'), null);
        assert.equal(ingredientCategoryDocId('__FIRESTORE__'), null);
        // Only the reserved *shape* is rejected, not any underscore.
        assert.equal(ingredientCategoryDocId('__proto'), '__proto');
        assert.equal(ingredientCategoryDocId('_under_score_'), '_under_score_');
    });

    it('rejects ids past the 1500-byte limit, measuring the ENCODED length', () => {
        assert.equal(ingredientCategoryDocId('a'.repeat(1500))!.length, 1500);
        assert.equal(ingredientCategoryDocId('a'.repeat(1501)), null);
        // Spaces triple in length once encoded, so a much shorter label can
        // still blow the limit — which is why the check is on the encoding.
        const spacey = 'ab '.repeat(400).trim(); // 1199 chars in, 1999 encoded
        assert.ok(spacey.length < 1500);
        assert.equal(ingredientCategoryDocId(spacey), null);
    });

    it('keeps non-ASCII labels addressable rather than dropping them', () => {
        const id = ingredientCategoryDocId('Крупа');
        assert.equal(id, encodeURIComponent('крупа'));
        assert.equal(decodeURIComponent(id!), 'крупа');
        assert.equal(ingredientCategoryDocId('生姜'), encodeURIComponent('生姜'));
    });
});

describe('ingredient-label-extract — the corpus census', () => {
    it('dedupes across recipes and counts usages and recipes separately', () => {
        const labels = collectIngredientLabels(fixtureCorpus());

        assert.deepEqual(labels, [
            { key: 'olive oil', label: 'Olive Oil', usageCount: 2, recipeCount: 2 },
            { key: 'onion', label: 'Onion', usageCount: 2, recipeCount: 1 },
            { key: 'garlic', label: 'Garlic', usageCount: 1, recipeCount: 1 },
        ]);
    });

    it('skips action nodes and labels that normalise to nothing', () => {
        const keys = collectIngredientLabels(fixtureCorpus()).map(l => l.key);
        assert.equal(keys.includes(''), false, 'an empty label must never become a lookup key');
        assert.equal(keys.some(k => k.startsWith('doing')), false, 'action nodes are not ingredients');
        assert.equal(keys.length, 3);
    });

    it('keeps one display label per key even when recipes disagree on casing', () => {
        const [oil] = collectIngredientLabels(fixtureCorpus());
        assert.equal(oil.label, 'Olive Oil', 'the display label is always the standardized form');
    });

    it('orders most-used first, breaking ties by key, so reports are deterministic', () => {
        const labels = collectIngredientLabels([
            graph([ingredient('x', { canonicalName: 'zucchini' }), ingredient('y', { canonicalName: 'apple' })]),
            graph([ingredient('z', { canonicalName: 'butter' }), ingredient('w', { canonicalName: 'butter' })]),
        ]);
        assert.deepEqual(labels.map(l => l.key), ['butter', 'apple', 'zucchini']);
    });

    it('accumulates incrementally, for callers paging a collection', () => {
        const collector = createIngredientLabelCollector();
        assert.deepEqual(collector.labels(), []);
        assert.equal(collector.recipesSeen, 0);

        for (const g of fixtureCorpus()) collector.add(g);

        assert.equal(collector.recipesSeen, 2);
        assert.deepEqual(collector.labels(), collectIngredientLabels(fixtureCorpus()));
    });

    it('survives a label that collides with Object.prototype', () => {
        const labels = collectIngredientLabels([
            graph([ingredient('p', { canonicalName: '__proto__' }), ingredient('c', { canonicalName: 'constructor' })]),
        ]);
        assert.deepEqual(labels.map(l => l.key), ['__proto__', 'constructor']);
        assert.deepEqual(labels.map(l => l.usageCount), [1, 1]);
    });

    it('tolerates a graph with no nodes at all', () => {
        assert.deepEqual(collectIngredientLabels([graph([])]), []);
    });
});
