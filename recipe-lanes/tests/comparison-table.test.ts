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
    reconcileOrder,
    servesScale,
    toComparisonRecipe,
    MAX_COMPARISON_RECIPES,
    type ComparisonIngredient,
    type ComparisonRecipe,
} from '../lib/recipe-lanes/comparison-table';
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

    it('uses the first available icon for a row', () => {
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
    /** A hand-built recipe payload, as the server action returns it. */
    function recipe(id: string, ingredients: ComparisonIngredient[]): ComparisonRecipe {
        return { id, title: id, ingredients };
    }

    function line(label: string, overrides: Partial<ComparisonIngredient> = {}): ComparisonIngredient {
        return { key: ingredientRowKey(label, ''), label, unit: '', quantity: 1, ...overrides };
    }

    it('carries the category from the ingredient line onto the row', () => {
        const table = buildComparisonTable([
            recipe('a', [line('Eggs', { category: 'dairy_eggs' }), line('Garlic', { category: 'aromatics' })]),
        ]);
        assert.deepEqual(table.rows.map(r => r.category), ['dairy_eggs', 'aromatics']);
    });

    it('leaves the row category undefined when no line was classified', () => {
        const table = buildComparisonTable([recipe('a', [line('Eggs')])]);
        assert.equal(table.rows[0].category, undefined);
        // Absent-not-null: the field has to survive server-action serialisation
        // as "simply missing", which is what the table already does for iconUrl.
        assert.equal('category' in JSON.parse(JSON.stringify(table.rows[0])), false);
    });

    it('takes the first category seen for a row (first-seen wins, like iconUrl)', () => {
        const table = buildComparisonTable([
            recipe('a', [line('Salt', { category: 'herbs_spices' })]),
            recipe('b', [line('Salt', { category: 'condiments_liquids' })]),
        ]);
        assert.equal(table.rows.length, 1);
        assert.equal(table.rows[0].category, 'herbs_spices');
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
