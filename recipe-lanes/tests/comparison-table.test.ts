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

// Gallery multi-recipe comparison table: ingredient extraction, cross-recipe
// row merging, totals, and the ordering helpers that back drag-and-drop.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildComparisonTable,
    canViewRecipeForComparison,
    extractComparisonIngredients,
    formatQuantity,
    ingredientRowKey,
    moveItem,
    moveItemByKey,
    nudgeItemByKey,
    reconcileOrder,
    servesScale,
    toComparisonRecipe,
    MAX_COMPARISON_RECIPES,
    type ComparisonIngredient,
    type ComparisonRecipe,
} from '../lib/recipe-lanes/comparison-table';
import { COMPARISON_CATEGORY_IDS, MAX_RAW_INGREDIENT_LENGTH } from '../lib/recipe-lanes/ingredient-taxonomy';
import { standardizeIngredientName } from '../lib/utils';
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

function graph(nodes: RecipeNode[], overrides: Partial<RecipeGraph> = {}): RecipeGraph {
    return { lanes: [{ id: 'lane-1', label: 'Prep', type: 'prep' }], nodes, ...overrides };
}

/** A hand-built recipe payload, as the server action returns it. */
function recipe(id: string, ingredients: ComparisonIngredient[]): ComparisonRecipe {
    return { id, title: id, ingredients };
}

/**
 * One ingredient line of such a payload; unit-less and quantified unless
 * overridden. `key` is derived from the label and whatever unit the overrides
 * ask for, so a line always carries the key the server action would have given
 * it — which is the key the raw-merge tests need to degrade back to.
 */
function line(label: string, overrides: Partial<ComparisonIngredient> = {}): ComparisonIngredient {
    const unit = overrides.unit ?? '';
    return { key: ingredientRowKey(label, unit), label, unit, quantity: 1, ...overrides };
}

describe('comparison-table — ingredient extraction', () => {
    it('keeps ingredient nodes and skips action nodes', () => {
        const g = graph([
            ingredient('a', { visualDescription: 'Egg', canonicalName: 'Eggs', quantity: 2, unit: '' }),
            { id: 'mix', laneId: 'lane-1', type: 'action', text: 'Mix', visualDescription: 'Mixing bowl', inputs: ['a'] },
        ]);
        const lines = extractComparisonIngredients(g);
        assert.equal(lines.length, 1);
        assert.equal(lines[0].label, 'Eggs');
        assert.equal(lines[0].quantity, 2);
        assert.equal(lines[0].unit, '');
    });

    it('derives both the label and the row key from the canonical name', () => {
        const [line] = extractComparisonIngredients(graph([
            ingredient('a', { visualDescription: 'A carrot going into a grater', canonicalName: 'carrots', quantity: 3, text: '3 carrots' }),
        ]));
        assert.equal(line.label, 'Carrots');
        assert.equal(line.key, ingredientRowKey('Carrots', ''));
        assert.equal(line.text, '3 carrots');
    });

    it('merges lines with the same label even when their icon descriptions differ', () => {
        // Seen on staging: "1 tsp salt" (icon "Salt") and "0.5 tsp salt" (icon
        // "Salt shaker") rendered as two rows that both read "Salt · tsp".
        const a = toComparisonRecipe('a', 'A', graph([ingredient('x', { visualDescription: 'Salt', canonicalName: 'salt', quantity: 1, unit: 'tsp', text: '1 tsp salt' })]));
        const b = toComparisonRecipe('b', 'B', graph([ingredient('x', { visualDescription: 'Salt shaker', canonicalName: 'salt', quantity: 0.5, unit: 'tsp', text: '0.5 tsp salt' })]));
        const table = buildComparisonTable([a, b]);
        assert.equal(table.rows.length, 1);
        assert.equal(table.rows[0].total, 1.5);
        assert.deepEqual(table.rows[0].sources, ['1 tsp salt', '0.5 tsp salt']);
    });

    it('falls back to the ingredient name when there is no canonical name', () => {
        const [line] = extractComparisonIngredients(graph([ingredient('a', { visualDescription: 'flour' })]));
        assert.equal(line.label, 'Flour');
        assert.equal(line.quantity, undefined);
    });

    it('normalises units so "Cup" and " cup " share a row', () => {
        assert.equal(ingredientRowKey('Flour', 'Cup'), ingredientRowKey('flour', ' cup '));
        assert.notEqual(ingredientRowKey('Flour', 'cup'), ingredientRowKey('Flour', 'g'));
    });

    it('scales stored (base-serves) quantities to the current serves, like the editor does', () => {
        const g = graph([ingredient('a', { visualDescription: 'Flour', quantity: 100, unit: 'g' })], { baseServes: 2, serves: 3 });
        assert.equal(servesScale(g), 1.5);
        assert.equal(extractComparisonIngredients(g)[0].quantity, 150);
    });

    it('treats a missing or nonsensical serves setting as unscaled', () => {
        assert.equal(servesScale({}), 1);
        assert.equal(servesScale({ baseServes: 4 }), 1);
        assert.equal(servesScale({ baseServes: 0, serves: 0 }), 1);
    });

    it('drops nodes with no usable name', () => {
        const lines = extractComparisonIngredients(graph([ingredient('a', { visualDescription: '', text: '  ' })]));
        assert.equal(lines.length, 0);
    });

    it('toComparisonRecipe falls back to the graph title and then a default', () => {
        const g = graph([], { title: 'From Graph' });
        assert.equal(toComparisonRecipe('r1', undefined, g).title, 'From Graph');
        assert.equal(toComparisonRecipe('r1', 'Explicit', g).title, 'Explicit');
        assert.equal(toComparisonRecipe('r1', undefined, graph([])).title, 'Untitled Recipe');
    });
});

describe('comparison-table — building the table', () => {
    const pancakes = toComparisonRecipe('pancakes', 'Pancakes', graph([
        ingredient('a', { visualDescription: 'Egg', canonicalName: 'Eggs', quantity: 2, unit: '' }),
        ingredient('b', { visualDescription: 'Flour', canonicalName: 'Flour', quantity: 100, unit: 'g' }),
        ingredient('c', { visualDescription: 'Milk', canonicalName: 'Milk', quantity: 200, unit: 'ml' }),
    ]));
    const omelette = toComparisonRecipe('omelette', 'Omelette', graph([
        ingredient('a', { visualDescription: 'Egg', canonicalName: 'Eggs', quantity: 3, unit: '' }),
        ingredient('b', { visualDescription: 'Cheese', canonicalName: 'Cheese', quantity: 50, unit: 'g' }),
    ]));

    it('puts recipes in columns and merges shared ingredients into one row', () => {
        const table = buildComparisonTable([pancakes, omelette]);
        assert.deepEqual(table.columns.map(c => c.id), ['pancakes', 'omelette']);
        assert.deepEqual(table.rows.map(r => r.label), ['Eggs', 'Flour', 'Milk', 'Cheese']);

        const eggs = table.rows[0];
        assert.equal(eggs.cells['pancakes']?.quantity, 2);
        assert.equal(eggs.cells['omelette']?.quantity, 3);
        assert.equal(eggs.total, 5);
        assert.equal(eggs.totalIsPartial, false);
    });

    it('leaves the cell absent when a recipe does not use the ingredient', () => {
        const table = buildComparisonTable([pancakes, omelette]);
        const flour = table.rows.find(r => r.label === 'Flour')!;
        assert.equal(flour.cells['omelette'], undefined);
        assert.equal(flour.total, 100);
    });

    it('keeps the same ingredient in different units on separate rows', () => {
        const metric = toComparisonRecipe('m', 'Metric', graph([ingredient('a', { visualDescription: 'Flour', quantity: 100, unit: 'g' })]));
        const cups = toComparisonRecipe('c', 'Cups', graph([ingredient('a', { visualDescription: 'Flour', quantity: 1, unit: 'cup' })]));
        const table = buildComparisonTable([metric, cups]);
        assert.equal(table.rows.length, 2);
        assert.deepEqual(table.rows.map(r => r.unit), ['g', 'cup']);
    });

    it('sums repeated ingredient lines within one recipe', () => {
        const r = toComparisonRecipe('r', 'R', graph([
            ingredient('a', { visualDescription: 'Butter', quantity: 25, unit: 'g' }),
            ingredient('b', { visualDescription: 'Butter', quantity: 25, unit: 'g' }),
        ]));
        const table = buildComparisonTable([r]);
        assert.equal(table.rows.length, 1);
        assert.equal(table.rows[0].cells['r']?.quantity, 50);
        assert.equal(table.rows[0].total, 50);
    });

    it('flags totals as partial when some recipe lists the ingredient without a number', () => {
        const vague = toComparisonRecipe('v', 'Vague', graph([ingredient('a', { visualDescription: 'Egg', canonicalName: 'Eggs' })]));
        const table = buildComparisonTable([pancakes, vague]);
        const eggs = table.rows.find(r => r.label === 'Eggs')!;
        assert.equal(eggs.cells['v']?.quantity, undefined);
        assert.equal(eggs.cells['v']?.unquantified, true);
        assert.equal(eggs.total, 2);
        assert.equal(eggs.totalIsPartial, true);
    });

    it('avoids float noise in totals', () => {
        const a = toComparisonRecipe('a', 'A', graph([ingredient('x', { visualDescription: 'Salt', quantity: 0.1, unit: 'tsp' })]));
        const b = toComparisonRecipe('b', 'B', graph([ingredient('x', { visualDescription: 'Salt', quantity: 0.2, unit: 'tsp' })]));
        assert.equal(buildComparisonTable([a, b]).rows[0].total, 0.3);
    });

    it('builds a row even when no contributing line resolved an icon', () => {
        const noIcon = toComparisonRecipe('n', 'N', graph([ingredient('a', { visualDescription: 'Egg' })]));
        const table = buildComparisonTable([noIcon, pancakes]);
        // Neither test recipe carries a shortlist, so no icon resolves — the row must still build.
        assert.equal(table.rows.find(r => r.label === 'Egg')?.iconUrl, undefined);
    });

    it('honours a user row order and appends newly discovered rows', () => {
        const table = buildComparisonTable([pancakes, omelette], [
            ingredientRowKey('Milk', 'ml'),
            ingredientRowKey('Eggs', ''),
            'stale|key',
        ]);
        assert.deepEqual(table.rows.map(r => r.label), ['Milk', 'Eggs', 'Flour', 'Cheese']);
    });

    it('drops rows whose recipes were deselected', () => {
        const table = buildComparisonTable([omelette], [ingredientRowKey('Flour', 'g'), ingredientRowKey('Eggs', '')]);
        assert.deepEqual(table.rows.map(r => r.label), ['Eggs', 'Cheese']);
    });

    it('builds an empty table for no recipes', () => {
        const table = buildComparisonTable([]);
        assert.deepEqual(table.columns, []);
        assert.deepEqual(table.rows, []);
    });
});

describe('comparison-table — ingredient categories', () => {
    it('carries the category from the ingredient line onto the row', () => {
        const table = buildComparisonTable([
            recipe('a', [line('Eggs', { category: 'dairy_eggs' }), line('Garlic', { category: 'aromatics' })]),
        ]);
        // Keyed, not positional: row ORDER is the category sort's business (see
        // the default-row-order suite), this is only about the field arriving.
        assert.deepEqual(
            Object.fromEntries(table.rows.map(r => [r.label, r.category])),
            { Eggs: 'dairy_eggs', Garlic: 'aromatics' },
        );
    });

    it('leaves the row category undefined when no line was classified', () => {
        const table = buildComparisonTable([recipe('a', [line('Eggs')])]);
        assert.equal(table.rows[0].category, undefined);
        // Absent-not-null: the field has to survive server-action serialisation
        // as "simply missing", which is what the table already does for iconUrl.
        assert.equal('category' in JSON.parse(JSON.stringify(table.rows[0])), false);
    });

    it('settles two lines disagreeing about a category the same way whatever the column order', () => {
        const a = recipe('a', [line('Salt', { category: 'herbs_spices' })]);
        const b = recipe('b', [line('Salt', { category: 'condiments_liquids' })]);
        const table = buildComparisonTable([a, b]);
        assert.equal(table.rows.length, 1);
        // One line each, so the earlier taxonomy rank decides — not the column.
        assert.equal(table.rows[0].category, 'herbs_spices');
        assert.equal(buildComparisonTable([b, a]).rows[0].category, 'herbs_spices');
    });

    it('fills a row category in from a later recipe when the first had none', () => {
        const table = buildComparisonTable([
            recipe('a', [line('Salt')]),
            recipe('b', [line('Salt', { category: 'herbs_spices' })]),
        ]);
        assert.equal(table.rows[0].category, 'herbs_spices');
    });

    it('changes nothing else about a table built without categories', () => {
        const withCategory = buildComparisonTable([recipe('a', [line('Flour', { category: 'grains_starches', quantity: 2 })])]);
        const without = buildComparisonTable([recipe('a', [line('Flour', { quantity: 2 })])]);
        assert.deepEqual(
            { ...withCategory.rows[0], category: undefined },
            { ...without.rows[0], category: undefined },
        );
    });

    it('never invents a category for an extracted (not yet joined) ingredient', () => {
        const [extracted] = extractComparisonIngredients(graph([ingredient('a', { visualDescription: 'Flour' })]));
        assert.equal(extracted.category, undefined);
    });
});

describe('comparison-table — raw ingredient merging', () => {
    it('merges two recipes phrasing one pantry item differently into a single row', () => {
        // The problem the whole chain exists for: "Carrot" and "Carrot,
        // Chopped" were two rows whose totals never added up.
        const table = buildComparisonTable([
            recipe('soup', [line('Carrot', { raw: 'Carrot', quantity: 1, text: '1 carrot' })]),
            recipe('slaw', [line('Carrot, Chopped', { raw: 'Carrot', quantity: 2, text: '2 carrots, chopped' })]),
        ]);
        assert.equal(table.rows.length, 1);
        const [carrot] = table.rows;
        assert.equal(carrot.label, 'Carrot');
        assert.equal(carrot.key, ingredientRowKey('Carrot', ''));
        assert.equal(carrot.cells['soup']?.quantity, 1);
        assert.equal(carrot.cells['slaw']?.quantity, 2);
        assert.equal(carrot.total, 3);
        assert.equal(carrot.totalIsPartial, false);
    });

    it('labels a merged row with the raw name even when no line was literally called that', () => {
        const table = buildComparisonTable([
            recipe('a', [
                line('Carrots, Grated', { raw: 'Carrot' }),
                line('Carrot, Julienned', { raw: 'Carrot' }),
            ]),
        ]);
        assert.deepEqual(table.rows.map(r => r.label), ['Carrot']);
    });

    it('sums two lines of ONE recipe into one cell when they share a raw ingredient', () => {
        const table = buildComparisonTable([
            recipe('stew', [
                line('Carrot, Diced', { raw: 'Carrot', unit: 'g', quantity: 150 }),
                line('Carrot, Grated', { raw: 'Carrot', unit: 'g', quantity: 50 }),
            ]),
        ]);
        assert.equal(table.rows.length, 1);
        const [carrot] = table.rows;
        assert.deepEqual(Object.keys(carrot.cells), ['stew']);
        assert.equal(carrot.cells['stew']?.quantity, 200);
        assert.equal(carrot.total, 200);
    });

    it('carries the unquantified flag across a same-recipe merge', () => {
        // "2 carrots, chopped" + "a handful of grated carrot": the cell is a
        // lower bound, and the row has to say so rather than reading like an
        // exact 2.
        const table = buildComparisonTable([
            recipe('stew', [
                line('Carrot, Chopped', { raw: 'Carrot', quantity: 2 }),
                line('Carrot, Grated', { raw: 'Carrot', quantity: undefined }),
            ]),
        ]);
        const [carrot] = table.rows;
        assert.equal(carrot.cells['stew']?.quantity, 2);
        assert.equal(carrot.cells['stew']?.unquantified, true);
        assert.equal(carrot.total, 2);
        assert.equal(carrot.totalIsPartial, true);
    });

    it('still splits one raw ingredient across units — merging never sums g with cups', () => {
        const table = buildComparisonTable([
            recipe('a', [line('Carrot, Chopped', { raw: 'Carrot', unit: 'g', quantity: 200 })]),
            recipe('b', [line('Carrot, Grated', { raw: 'Carrot', unit: 'cup', quantity: 2 })]),
        ]);
        assert.equal(table.rows.length, 2);
        assert.deepEqual(table.rows.map(r => r.unit), ['g', 'cup']);
        assert.deepEqual(table.rows.map(r => r.total), [200, 2]);
        // Both rows are the same pantry item, so both would read "Carrot" —
        // the unit suffix is what keeps them tellable apart.
        assert.deepEqual(table.rows.map(r => r.label), ['Carrot (g)', 'Carrot (cup)']);
    });

    it('unions the sources of every label that merged, so the tooltip explains the row', () => {
        const table = buildComparisonTable([
            recipe('a', [line('Carrot, Chopped', { raw: 'Carrot', text: '2 carrots, chopped' })]),
            recipe('b', [
                line('Carrot', { raw: 'Carrot', text: '1 carrot' }),
                line('Carrot, Grated', { raw: 'Carrot', text: '1 carrot, grated' }),
            ]),
        ]);
        assert.equal(table.rows.length, 1);
        assert.deepEqual(table.rows[0].sources, ['2 carrots, chopped', '1 carrot', '1 carrot, grated']);
    });

    it('picks a merged row\'s category and icon independently of column order', () => {
        // Column order is the USER's (recipe columns are draggable), so a row's
        // colour and its position in the category sort must not depend on it.
        const a = recipe('a', [line('Carrot, Chopped', { raw: 'Carrot', category: 'vegetables', iconUrl: 'chopped.png' })]);
        const b = recipe('b', [line('Carrot', { raw: 'Carrot', category: 'other', iconUrl: 'whole.png' })]);

        const forwards = buildComparisonTable([a, b]).rows[0];
        const backwards = buildComparisonTable([b, a]).rows[0];
        assert.equal(forwards.category, backwards.category);
        assert.equal(forwards.iconUrl, backwards.iconUrl);
        // Tie on count, so the earlier taxonomy rank settles it.
        assert.equal(forwards.category, 'vegetables');
    });

    it('gives a merged row the category most of its lines agree on', () => {
        // Majority beats taxonomy rank: `proteins` ranks first but only one
        // line says so, and the row should follow the weight of evidence.
        const table = buildComparisonTable([
            recipe('a', [line('Sugar, Caster', { raw: 'Sugar', category: 'sweeteners' })]),
            recipe('b', [line('Sugar, Granulated', { raw: 'Sugar', category: 'proteins' })]),
            recipe('c', [line('Sugar, Sifted', { raw: 'Sugar', category: 'sweeteners' })]),
        ]);
        assert.equal(table.rows.length, 1);
        assert.equal(table.rows[0].category, 'sweeteners');
        assert.ok(COMPARISON_CATEGORY_IDS.indexOf('proteins') < COMPARISON_CATEGORY_IDS.indexOf('sweeteners'));
    });

    it('fills a merged row\'s category in from a later line when the first had none', () => {
        const table = buildComparisonTable([
            recipe('a', [line('Carrot, Chopped', { raw: 'Carrot' })]),
            recipe('b', [line('Carrot', { raw: 'Carrot', category: 'vegetables' })]),
        ]);
        assert.equal(table.rows[0].category, 'vegetables');
    });

    it('standardises a raw name defensively, so casing or stray spacing cannot split a row', () => {
        // The writers already store display casing; this is the belt to that
        // brace — a sloppy value must not produce "carrot" and "Carrot" rows.
        // Internal runs matter as much as the outer ones: standardizing alone
        // does NOT collapse them, so "Olive  Oil" would otherwise key apart
        // from "Olive Oil" and render as two visually identical rows.
        const table = buildComparisonTable([
            recipe('a', [line('Oil, Warmed', { raw: '  olive oil  ' })]),
            recipe('b', [line('Oil, Measured', { raw: 'OLIVE  OIL' })]),
            recipe('c', [line('Oil, Poured', { raw: 'Olive\tOil' })]),
            recipe('d', [line('Olive Oil', { quantity: 1 })]),
        ]);
        assert.equal(table.rows.length, 1);
        assert.equal(table.rows[0].label, 'Olive Oil');
        assert.equal(table.rows[0].key, ingredientRowKey('Olive Oil', ''));
    });

    it('treats a raw name as opaque — any bounded name keys and labels a row', () => {
        // The writers guarantee a raw name is non-empty and at most
        // MAX_RAW_INGREDIENT_LENGTH characters (truncated at a word boundary).
        // Merging leans on NOTHING stronger than that: not a word count, not a
        // maximum shorter than the bound, and not any relationship to the label
        // it replaces. A name sitting exactly on the bound must still merge.
        const longRaw = 'Long Pantry Item '.repeat(10).slice(0, MAX_RAW_INGREDIENT_LENGTH).trim();
        assert.equal(longRaw.length <= MAX_RAW_INGREDIENT_LENGTH, true);

        const table = buildComparisonTable([
            recipe('a', [line('Something, Chopped', { raw: longRaw, quantity: 1 })]),
            recipe('b', [line('Something Else, Diced', { raw: longRaw, quantity: 2 })]),
        ]);
        assert.equal(table.rows.length, 1);
        assert.equal(table.rows[0].label, standardizeIngredientName(longRaw));
        assert.equal(table.rows[0].key, ingredientRowKey(longRaw, ''));
        assert.equal(table.rows[0].total, 3);
    });

    it('leaves no two rows of a merged table reading identically', () => {
        // Three units of one pantry item, one of them unit-less (so it shows
        // no unit chip to tell it apart). Every label in the table must differ.
        const table = buildComparisonTable([
            recipe('a', [line('Carrot, Chopped', { raw: 'Carrot', unit: 'g', quantity: 200 })]),
            recipe('b', [line('Carrot, Grated', { raw: 'Carrot', unit: 'cup', quantity: 2 })]),
            recipe('c', [line('Carrots', { raw: 'Carrot', quantity: 3 })]),
        ]);
        assert.equal(table.rows.length, 3);
        const labels = table.rows.map(r => r.label);
        assert.equal(new Set(labels).size, labels.length);
        // The unit-less row keeps the clean pantry name; its siblings take a suffix.
        assert.deepEqual([...labels].sort(), ['Carrot', 'Carrot (cup)', 'Carrot (g)']);
    });

    it('treats a blank raw name as no raw name at all', () => {
        const table = buildComparisonTable([recipe('a', [line('Carrot, Chopped', { raw: '   ' })])]);
        assert.deepEqual(table.rows.map(r => r.label), ['Carrot, Chopped']);
        assert.equal(table.rows[0].key, ingredientRowKey('Carrot, Chopped', ''));
    });
});

describe('comparison-table — raw ingredient merging degrades per line', () => {
    it('behaves exactly as it did before raw existed when no line carries one', () => {
        // Built the OLD way on purpose: keys off each line's own label+unit,
        // labels verbatim, first-seen row order within a category. If the merge
        // ever leaked into the no-raw path this literal is what catches it.
        const recipes = [
            recipe('pancakes', [
                line('Flour', { unit: 'g', quantity: 100, text: '100g flour', category: 'grains_starches' }),
                line('Eggs', { quantity: 2, text: '2 eggs', category: 'dairy_eggs' }),
            ]),
            recipe('omelette', [
                line('Eggs', { quantity: 3, text: '3 eggs', category: 'dairy_eggs' }),
                line('Cheese', { unit: 'g', quantity: 50, text: '50g cheese' }),
            ]),
        ];
        assert.deepEqual(buildComparisonTable(recipes).rows, [
            {
                key: ingredientRowKey('Eggs', ''),
                label: 'Eggs',
                unit: '',
                iconUrl: undefined,
                category: 'dairy_eggs',
                cells: { pancakes: { unquantified: false, quantity: 2 }, omelette: { unquantified: false, quantity: 3 } },
                sources: ['2 eggs', '3 eggs'],
                total: 5,
                totalIsPartial: false,
            },
            {
                key: ingredientRowKey('Flour', 'g'),
                label: 'Flour',
                unit: 'g',
                iconUrl: undefined,
                category: 'grains_starches',
                cells: { pancakes: { unquantified: false, quantity: 100 } },
                sources: ['100g flour'],
                total: 100,
                totalIsPartial: false,
            },
            {
                key: ingredientRowKey('Cheese', 'g'),
                label: 'Cheese',
                unit: 'g',
                iconUrl: undefined,
                category: undefined,
                cells: { omelette: { unquantified: false, quantity: 50 } },
                sources: ['50g cheese'],
                total: 50,
                totalIsPartial: false,
            },
        ]);
    });

    it('keeps ONE label on one row when only some batches resolved its raw name', () => {
        // The regression this guards. Raw resolution happens per server-action
        // call — one per batch of newly ticked recipes — and each answer is
        // frozen into the component's loaded-recipe cache. So the SAME label
        // legitimately arrives with a raw name in one batch and without one in
        // another (that batch timed out, or ran past the classify-on-miss cap).
        // Keying each line on its own would split one label across two rows,
        // which is strictly worse than the pre-merge behaviour and does not
        // heal in-session.
        const table = buildComparisonTable([
            recipe('resolved', [line('Carrot, Chopped', { raw: 'Carrot', quantity: 2 })]),
            recipe('timedOut', [line('Carrot, Chopped', { quantity: 3 })]),
        ]);
        assert.equal(table.rows.length, 1);
        const [carrot] = table.rows;
        assert.equal(carrot.label, 'Carrot');
        assert.equal(carrot.key, ingredientRowKey('Carrot', ''));
        assert.equal(carrot.cells['resolved']?.quantity, 2);
        assert.equal(carrot.cells['timedOut']?.quantity, 3);
        assert.equal(carrot.total, 5);
    });

    it('lets one resolved line pull in the same label from every other recipe', () => {
        // Three-way: two recipes never resolved the label, the third did. All
        // three belong on the raw row, and the answer must not depend on
        // whether the resolved recipe came first or last.
        const unresolvedFirst = buildComparisonTable([
            recipe('a', [line('Carrot, Chopped', { quantity: 1 })]),
            recipe('b', [line('Carrot, Chopped', { quantity: 2 })]),
            recipe('c', [line('Carrot, Chopped', { raw: 'Carrot', quantity: 4 })]),
        ]);
        assert.equal(unresolvedFirst.rows.length, 1);
        assert.equal(unresolvedFirst.rows[0].label, 'Carrot');
        assert.equal(unresolvedFirst.rows[0].total, 7);
        assert.deepEqual(Object.keys(unresolvedFirst.rows[0].cells).sort(), ['a', 'b', 'c']);

        const resolvedFirst = buildComparisonTable([
            recipe('c', [line('Carrot, Chopped', { raw: 'Carrot', quantity: 4 })]),
            recipe('a', [line('Carrot, Chopped', { quantity: 1 })]),
            recipe('b', [line('Carrot, Chopped', { quantity: 2 })]),
        ]);
        assert.deepEqual(resolvedFirst.rows.map(r => r.label), unresolvedFirst.rows.map(r => r.label));
        assert.equal(resolvedFirst.rows[0].total, 7);
    });

    it('does not let a borrowed raw identity cross a unit boundary', () => {
        // The borrow is keyed on the label key, which already carries the
        // unit, so an unresolved gram line cannot be pulled onto a cup row.
        const table = buildComparisonTable([
            recipe('a', [line('Carrot, Chopped', { raw: 'Carrot', unit: 'cup', quantity: 1 })]),
            recipe('b', [line('Carrot, Chopped', { unit: 'g', quantity: 100 })]),
        ]);
        assert.equal(table.rows.length, 2);
        assert.deepEqual(table.rows.map(r => r.unit).sort(), ['cup', 'g']);
        // Only the resolved one is a raw row; the gram line degrades to its own label.
        assert.deepEqual(table.rows.map(r => r.label).sort(), ['Carrot', 'Carrot, Chopped']);
    });

    it('renders a mixed comparison: a classified label and its unclassified sibling stay apart', () => {
        // Degradation is PER LINE. Until the lookup's write-through reaches the
        // second label it has no raw name, so it keeps its own row — two rows
        // this view, which is today's behaviour, not a bug.
        const table = buildComparisonTable([
            recipe('a', [line('Carrot, Chopped', { raw: 'Carrot', quantity: 2 })]),
            recipe('b', [line('Carrot, Grated', { quantity: 5 })]),
        ]);
        assert.deepEqual(table.rows.map(r => r.label), ['Carrot', 'Carrot, Grated']);
        assert.deepEqual(table.rows.map(r => r.total), [2, 5]);
    });

    it('merges an unclassified line anyway when its own label already IS the raw name', () => {
        // The common half of a mixed corpus: "Carrot" needs no raw name to land
        // on the raw-keyed row, because the two keys are the same string.
        const table = buildComparisonTable([
            recipe('a', [line('Carrot, Chopped', { raw: 'Carrot', quantity: 2 })]),
            recipe('b', [line('Carrot', { quantity: 1 })]),
        ]);
        assert.equal(table.rows.length, 1);
        assert.equal(table.rows[0].total, 3);
    });

    it('leaves a pre-existing duplicate label alone when no raw name is involved', () => {
        // Two recipes measuring flour differently already produced two rows
        // both reading "Flour", long before merging existed. Relabelling them
        // would break the byte-identical guarantee above for a cosmetic win,
        // so disambiguation stays scoped to clashes that merging caused.
        const table = buildComparisonTable([
            recipe('a', [line('Flour', { unit: 'g', quantity: 100 })]),
            recipe('b', [line('Flour', { unit: 'cup', quantity: 1 })]),
        ]);
        assert.deepEqual(table.rows.map(r => r.label), ['Flour', 'Flour']);
    });

    it('never invents a raw name for an extracted (not yet joined) ingredient', () => {
        const [extracted] = extractComparisonIngredients(graph([ingredient('a', { visualDescription: 'Carrot, Chopped' })]));
        assert.equal(extracted.raw, undefined);
    });
});

describe('comparison-table — raw merging meets ordering', () => {
    it('sorts a merged row by the category it carries, not by the labels it swallowed', () => {
        const table = buildComparisonTable([
            recipe('a', [
                line('Sugar', { category: 'sweeteners' }),
                line('Carrot, Chopped', { raw: 'Carrot', category: 'vegetables' }),
                line('Chicken Breast', { category: 'proteins' }),
            ]),
            recipe('b', [line('Carrot, Grated', { raw: 'Carrot', category: 'vegetables' })]),
        ]);
        assert.deepEqual(table.rows.map(r => r.label), ['Chicken Breast', 'Carrot', 'Sugar']);
        assert.equal(COMPARISON_CATEGORY_IDS.indexOf('vegetables') > COMPARISON_CATEGORY_IDS.indexOf('proteins'), true);
        assert.equal(COMPARISON_CATEGORY_IDS.indexOf('vegetables') < COMPARISON_CATEGORY_IDS.indexOf('sweeteners'), true);
    });

    it('drops a hand-arranged order\'s pre-merge keys instead of breaking on them', () => {
        // The mid-session churn case: the user arranged the table while the two
        // carrot labels were still separate rows, then the lookup wrote through
        // and they merged. `rowOrder` is ephemeral useState, so those dead keys
        // are simply reconciled away — surviving rows keep their places and the
        // new merged row is appended.
        const stale = [
            ingredientRowKey('Carrot, Chopped', ''),
            ingredientRowKey('Carrot, Grated', ''),
            ingredientRowKey('Flour', 'g'),
        ];
        const table = buildComparisonTable([
            recipe('a', [
                line('Carrot, Chopped', { raw: 'Carrot', quantity: 2 }),
                line('Flour', { unit: 'g', quantity: 100 }),
            ]),
            recipe('b', [line('Carrot, Grated', { raw: 'Carrot', quantity: 1 })]),
        ], stale);
        assert.deepEqual(table.rows.map(r => r.label), ['Flour', 'Carrot']);
        assert.equal(table.rows.every(r => !!r), true);
        assert.equal(table.rows[1].total, 3);
    });

    it('keeps a hand-arranged order that was captured AFTER the merge', () => {
        const recipes = [
            recipe('a', [line('Sugar', { category: 'sweeteners' }), line('Carrot, Chopped', { raw: 'Carrot', category: 'vegetables' })]),
        ];
        const dragged = [ingredientRowKey('Sugar', ''), ingredientRowKey('Carrot', '')];
        assert.deepEqual(buildComparisonTable(recipes, dragged).rows.map(r => r.label), ['Sugar', 'Carrot']);
    });
});

describe('comparison-table — default row order (category sort)', () => {
    const labels = (recipes: ComparisonRecipe[], rowOrder?: string[]) =>
        buildComparisonTable(recipes, rowOrder).rows.map(r => r.label);

    it('orders rows by taxonomy category, whatever order the recipes list them in', () => {
        assert.deepEqual(
            labels([recipe('a', [line('Sugar', { category: 'sweeteners' }), line('Garlic', { category: 'aromatics' }), line('Chicken', { category: 'proteins' })])]),
            ['Chicken', 'Garlic', 'Sugar'],
        );
    });

    it('sorts uncategorised rows last, alongside Other', () => {
        assert.deepEqual(
            labels([recipe('a', [line('Mystery'), line('Junk', { category: 'other' }), line('Chicken', { category: 'proteins' })])]),
            ['Chicken', 'Mystery', 'Junk'],
        );
        // Uncategorised really does sort with 'other', which really is last.
        assert.equal(COMPARISON_CATEGORY_IDS[COMPARISON_CATEGORY_IDS.length - 1], 'other');
    });

    it('is a stable sort: rows of one category keep their first-seen order', () => {
        assert.deepEqual(
            labels([recipe('a', [
                line('Thyme', { category: 'herbs_spices' }),
                line('Onion', { category: 'aromatics' }),
                line('Salt', { category: 'herbs_spices' }),
                line('Garlic', { category: 'aromatics' }),
                line('Pepper', { category: 'herbs_spices' }),
            ])]),
            ['Onion', 'Garlic', 'Thyme', 'Salt', 'Pepper'],
        );
    });

    it('sorts a stale or unrecognised category id with Other rather than to the top', () => {
        assert.deepEqual(
            labels([recipe('a', [line('Stale', { category: 'legumes_from_an_older_taxonomy' }), line('Chicken', { category: 'proteins' })])]),
            ['Chicken', 'Stale'],
        );
    });

    it('keeps first-seen order when nothing is classified (unchanged behaviour)', () => {
        assert.deepEqual(
            labels([recipe('a', [line('Eggs'), line('Flour'), line('Butter')])]),
            ['Eggs', 'Flour', 'Butter'],
        );
    });

    it('never re-sorts a table the user has arranged by hand', () => {
        const recipes = [recipe('a', [line('Sugar', { category: 'sweeteners' }), line('Chicken', { category: 'proteins' })])];
        // Dragging Sugar above Chicken must survive a rebuild, category or not.
        const dragged = [ingredientRowKey('Sugar', ''), ingredientRowKey('Chicken', '')];
        assert.deepEqual(labels(recipes, dragged), ['Sugar', 'Chicken']);
    });

    it('appends rows discovered later after the user order, in category order', () => {
        const first = [recipe('a', [line('Chicken', { category: 'proteins' })])];
        const arranged = buildComparisonTable(first).rows.map(r => r.key);
        const withMore = [
            recipe('a', [line('Chicken', { category: 'proteins' })]),
            recipe('b', [line('Sugar', { category: 'sweeteners' }), line('Garlic', { category: 'aromatics' })]),
        ];
        assert.deepEqual(labels(withMore, arranged), ['Chicken', 'Garlic', 'Sugar']);
    });

    it('drops rows whose recipes were deselected, category sort or not', () => {
        const arranged = [ingredientRowKey('Gone', ''), ingredientRowKey('Chicken', '')];
        assert.deepEqual(labels([recipe('a', [line('Chicken', { category: 'proteins' })])], arranged), ['Chicken']);
    });
});

describe('comparison-table — ordering helpers (drag and drop)', () => {
    it('moveItem relocates an element and returns a new array', () => {
        const list = ['a', 'b', 'c', 'd'];
        assert.deepEqual(moveItem(list, 0, 2), ['b', 'c', 'a', 'd']);
        assert.deepEqual(moveItem(list, 3, 0), ['d', 'a', 'b', 'c']);
        assert.deepEqual(list, ['a', 'b', 'c', 'd']);
    });

    it('moveItem is a no-op copy for invalid or identical indices', () => {
        const list = ['a', 'b'];
        assert.deepEqual(moveItem(list, 0, 0), list);
        assert.deepEqual(moveItem(list, -1, 1), list);
        assert.deepEqual(moveItem(list, 0, 5), list);
        assert.notEqual(moveItem(list, 0, 0), list);
    });

    it('reconcileOrder keeps arranged order, drops missing, appends new', () => {
        assert.deepEqual(reconcileOrder(['c', 'a', 'gone'], ['a', 'b', 'c']), ['c', 'a', 'b']);
        assert.deepEqual(reconcileOrder([], ['x', 'y']), ['x', 'y']);
        assert.deepEqual(reconcileOrder(['y', 'x'], []), []);
    });

    it('moveItemByKey relocates by identity, not by a captured position', () => {
        assert.deepEqual(moveItemByKey(['a', 'b', 'c', 'd'], 'a', 'c'), ['b', 'c', 'a', 'd']);
        assert.deepEqual(moveItemByKey(['a', 'b'], 'a', 'a'), ['a', 'b']);
    });

    it('moveItemByKey survives rows shifting under a drag', () => {
        // The race the key-based drag exists to close: a recipe lands mid-drag
        // and the category sort INSERTS 'new' above the dragged row, so every
        // index captured at dragstart now points at the wrong row. Resolving
        // both ends by key at drop time still moves exactly what was grabbed.
        const atDragStart = ['a', 'b', 'c'];
        const atDrop = ['new', 'a', 'b', 'c'];
        assert.deepEqual(moveItem(atDragStart, 0, 2), ['b', 'c', 'a']);
        assert.deepEqual(moveItemByKey(atDrop, 'a', 'c'), ['new', 'b', 'c', 'a']);
    });

    it('moveItemByKey returns null when either end vanished mid-drag', () => {
        // Dropping onto a row whose recipe was just unticked must do nothing at
        // all, rather than pin a wrong arrangement into the saved row order.
        assert.equal(moveItemByKey(['a', 'b'], 'gone', 'a'), null);
        assert.equal(moveItemByKey(['a', 'b'], 'a', 'gone'), null);
        assert.equal(moveItemByKey([], 'a', 'b'), null);
    });

    it('nudgeItemByKey steps an item along the list by its current position', () => {
        assert.deepEqual(nudgeItemByKey(['a', 'b', 'c'], 'c', -1), ['a', 'c', 'b']);
        assert.deepEqual(nudgeItemByKey(['a', 'b', 'c'], 'a', 1), ['b', 'a', 'c']);
        // Resolved now, not when the handle was focused.
        assert.deepEqual(nudgeItemByKey(['new', 'a', 'b'], 'a', -1), ['a', 'new', 'b']);
    });

    it('nudgeItemByKey returns null at the ends and for a vanished key', () => {
        assert.equal(nudgeItemByKey(['a', 'b'], 'a', -1), null);
        assert.equal(nudgeItemByKey(['a', 'b'], 'b', 1), null);
        assert.equal(nudgeItemByKey(['a', 'b'], 'gone', 1), null);
    });
});

describe('comparison-table — access + formatting', () => {
    it('lets owners see their own recipes regardless of visibility', () => {
        assert.equal(canViewRecipeForComparison({ ownerId: 'u1', visibility: 'private' }, 'u1'), true);
    });

    it('lets anyone signed in see public and unlisted recipes', () => {
        assert.equal(canViewRecipeForComparison({ ownerId: 'u1', visibility: 'public' }, 'u2'), true);
        assert.equal(canViewRecipeForComparison({ ownerId: 'u1', visibility: 'unlisted' }, 'u2'), true);
    });

    it('denies private recipes of other users and recipes with no visibility', () => {
        assert.equal(canViewRecipeForComparison({ ownerId: 'u1', visibility: 'private' }, 'u2'), false);
        assert.equal(canViewRecipeForComparison({ ownerId: 'u1' }, 'u2'), false);
        assert.equal(canViewRecipeForComparison({}, 'u2'), false);
    });

    it('formats quantities without float noise', () => {
        assert.equal(formatQuantity(2), '2');
        assert.equal(formatQuantity(0.1 + 0.2), '0.3');
        assert.equal(formatQuantity(1.005), '1');
        assert.equal(formatQuantity(NaN), '');
    });

    it('caps the number of recipes in one comparison', () => {
        assert.ok(MAX_COMPARISON_RECIPES >= 2);
    });
});
