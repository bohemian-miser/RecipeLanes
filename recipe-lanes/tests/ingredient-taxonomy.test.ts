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

// Ingredient taxonomy: the closed category enum and its ordering, plus the
// pure halves of the classification pipeline (prompt construction and the
// tolerant response parser). No LLM is called here — fixtures only.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildClassificationPrompt,
    categoryRank,
    getIngredientCategory,
    isIngredientCategoryId,
    parseClassificationResponse,
    FALLBACK_CATEGORY_ID,
    ICON_ONLY_CATEGORIES,
    INGREDIENT_CATEGORIES,
} from '../lib/recipe-lanes/ingredient-taxonomy';

const ALL_IDS = new Set<string>(INGREDIENT_CATEGORIES.map(c => c.id));

describe('ingredient-taxonomy — the category enum', () => {
    it('is exactly the twelve agreed categories, in display order', () => {
        assert.deepEqual(INGREDIENT_CATEGORIES.map(c => c.id), [
            'proteins',
            'aromatics',
            'vegetables',
            'fruits',
            'herbs_spices',
            'fats_oils',
            'dairy_eggs',
            'grains_starches',
            'nuts_seeds',
            'sweeteners',
            'condiments_liquids',
            'other',
        ]);
    });

    it("keeps 'other' last so the fallback group sorts to the bottom", () => {
        assert.equal(INGREDIENT_CATEGORIES[INGREDIENT_CATEGORIES.length - 1].id, FALLBACK_CATEGORY_ID);
    });

    it('gives every category a label, a distinct hex colour and boundary rules', () => {
        const colors = new Set<string>();
        for (const category of INGREDIENT_CATEGORIES) {
            assert.ok(category.label.length > 0, `${category.id} needs a display label`);
            assert.match(category.color, /^#[0-9a-f]{6}$/, `${category.id} needs a 6-digit hex colour`);
            assert.ok(category.rules.length > 0, `${category.id} needs boundary rules`);
            colors.add(category.color);
        }
        assert.equal(colors.size, INGREDIENT_CATEGORIES.length, 'category colours must be distinct');
    });

    it('keeps the icon-only category out of the comparison-side enum', () => {
        assert.deepEqual(ICON_ONLY_CATEGORIES.map(c => c.id), ['action_or_state']);
        assert.equal(isIngredientCategoryId('action_or_state'), false);
        assert.equal(INGREDIENT_CATEGORIES.some(c => (c.id as string) === 'action_or_state'), false);
    });

    it('recognises every enum member and rejects anything else', () => {
        for (const category of INGREDIENT_CATEGORIES) {
            assert.equal(isIngredientCategoryId(category.id), true);
        }
        for (const bogus of ['Proteins', 'protein', 'veggies', '', undefined, null, 7, {}, ['other']]) {
            assert.equal(isIngredientCategoryId(bogus), false, `${String(bogus)} must not pass the guard`);
        }
    });

    it('looks categories up by id', () => {
        assert.equal(getIngredientCategory('herbs_spices')?.label, 'Herbs & Spices');
        assert.equal(getIngredientCategory('action_or_state'), undefined);
        assert.equal(getIngredientCategory(undefined), undefined);
    });
});

describe('ingredient-taxonomy — categoryRank', () => {
    it('ranks categories by their position in the display order', () => {
        assert.equal(categoryRank('proteins'), 0);
        assert.equal(categoryRank('aromatics'), 1);
        assert.ok(categoryRank('proteins') < categoryRank('condiments_liquids'));
    });

    it("falls back to 'other' for undefined, unknown and icon-only ids", () => {
        const otherRank = categoryRank('other');
        assert.equal(otherRank, INGREDIENT_CATEGORIES.length - 1);
        assert.equal(categoryRank(undefined), otherRank);
        assert.equal(categoryRank(''), otherRank);
        assert.equal(categoryRank('legumes'), otherRank, 'a stale id from an older taxonomy');
        assert.equal(categoryRank('action_or_state'), otherRank, 'an icon-only id must never outrank a real group');
    });

    it('sorts an unclassified row to the end alongside Other', () => {
        const rows = [
            { key: 'a', category: undefined },
            { key: 'b', category: 'other' },
            { key: 'c', category: 'proteins' },
            { key: 'd', category: 'vegetables' },
        ];
        const sorted = rows
            .map((row, i) => ({ row, i }))
            .sort((x, y) => categoryRank(x.row.category) - categoryRank(y.row.category) || x.i - y.i)
            .map(({ row }) => row.key);
        // Stable within a rank: the undefined row keeps its order relative to 'other'.
        assert.deepEqual(sorted, ['c', 'd', 'a', 'b']);
    });
});

describe('ingredient-taxonomy — buildClassificationPrompt', () => {
    const labels = ['Salt', 'Cebula', '双皮奶'];

    it("embeds every category's rules text verbatim", () => {
        const prompt = buildClassificationPrompt(labels);
        for (const category of INGREDIENT_CATEGORIES) {
            assert.ok(
                prompt.includes(category.rules),
                `prompt is missing the boundary rules for ${category.id}`,
            );
            assert.ok(prompt.includes(category.id), `prompt is missing the id ${category.id}`);
            assert.ok(prompt.includes(category.label), `prompt is missing the label for ${category.id}`);
        }
    });

    it('lists every label to classify, JSON-quoted so odd labels stay intact', () => {
        const prompt = buildClassificationPrompt(['plain', 'has "quotes"', 'has\nnewline']);
        assert.ok(prompt.includes('"plain"'));
        assert.ok(prompt.includes('"has \\"quotes\\""'));
        assert.ok(prompt.includes('"has\\nnewline"'));
    });

    it('instructs the model to classify non-English labels by meaning', () => {
        const prompt = buildClassificationPrompt(labels).toLowerCase();
        assert.ok(prompt.includes('language'));
        assert.ok(prompt.includes('meaning'));
        assert.ok(prompt.includes('non-english'));
    });

    it('states the strict JSON contract and forbids markdown fences', () => {
        const prompt = buildClassificationPrompt(labels);
        assert.ok(prompt.includes('{"<label>": "<category_id>"}'));
        assert.ok(prompt.includes(`exactly ${labels.length} keys`));
        assert.ok(/no markdown code fences/i.test(prompt));
        assert.ok(!prompt.includes('```'), 'the prompt itself must not contain a fence');
    });

    it('omits the icon-only category unless it is asked for', () => {
        const [iconCategory] = ICON_ONLY_CATEGORIES;
        const forRows = buildClassificationPrompt(labels);
        assert.ok(!forRows.includes(iconCategory.id));

        const forIcons = buildClassificationPrompt(labels, { includeIconCategories: true });
        assert.ok(forIcons.includes(iconCategory.id));
        assert.ok(forIcons.includes(iconCategory.rules));
        // The twelve row categories are still all present.
        for (const category of INGREDIENT_CATEGORIES) {
            assert.ok(forIcons.includes(category.rules), `icon prompt lost the rules for ${category.id}`);
        }
    });
});

describe('ingredient-taxonomy — parseClassificationResponse', () => {
    const labels = ['salt', 'onion', 'cebula'];

    it('accepts a clean JSON object', () => {
        const raw = '{"salt":"herbs_spices","onion":"aromatics","cebula":"aromatics"}';
        const result = parseClassificationResponse(raw, labels, ALL_IDS);
        assert.deepEqual(result.assignments, {
            salt: 'herbs_spices',
            onion: 'aromatics',
            cebula: 'aromatics',
        });
        assert.deepEqual(result.missing, []);
        assert.deepEqual(result.invalid, []);
    });

    it('strips markdown fences and surrounding prose', () => {
        const raw = [
            'Here you go:',
            '```json',
            '{"salt": "herbs_spices", "onion": "aromatics", "cebula": "aromatics"}',
            '```',
            'Hope that helps!',
        ].join('\n');
        const result = parseClassificationResponse(raw, labels, ALL_IDS);
        assert.deepEqual(result.missing, []);
        assert.equal(result.assignments.salt, 'herbs_spices');
        assert.equal(result.assignments.cebula, 'aromatics');
    });

    it('reports a label the response left out, keeping the ones it got', () => {
        const raw = '{"salt":"herbs_spices","onion":"aromatics"}';
        const result = parseClassificationResponse(raw, labels, ALL_IDS);
        assert.deepEqual(result.missing, ['cebula']);
        assert.deepEqual(result.invalid, []);
        assert.equal(result.assignments.onion, 'aromatics');
        assert.equal('cebula' in result.assignments, false);
    });

    it('rejects a category id that is not in the enum', () => {
        const raw = '{"salt":"seasonings","onion":"aromatics","cebula":"AROMATICS "}';
        const result = parseClassificationResponse(raw, labels, ALL_IDS);
        assert.deepEqual(result.invalid, [{ label: 'salt', value: 'seasonings' }]);
        assert.deepEqual(result.missing, ['salt'], 'a rejected label still needs re-classifying');
        // Case and stray whitespace around a real id are tolerated.
        assert.equal(result.assignments.cebula, 'aromatics');
    });

    it('rejects an icon-only id when the caller only allows row categories', () => {
        const raw = '{"salt":"action_or_state","onion":"aromatics","cebula":"aromatics"}';
        const result = parseClassificationResponse(raw, labels, ALL_IDS);
        assert.deepEqual(result.invalid, [{ label: 'salt', value: 'action_or_state' }]);

        const iconAllowed = new Set<string>([...ALL_IDS, ...ICON_ONLY_CATEGORIES.map(c => c.id)]);
        const forIcons = parseClassificationResponse(raw, labels, iconAllowed);
        assert.deepEqual(forIcons.invalid, []);
        assert.equal(forIcons.assignments.salt, 'action_or_state');
    });

    it('rejects non-string category values without throwing', () => {
        const raw = '{"salt":null,"onion":["aromatics"],"cebula":"aromatics"}';
        const result = parseClassificationResponse(raw, labels, ALL_IDS);
        assert.deepEqual(result.invalid.map(i => i.label), ['salt', 'onion']);
        assert.deepEqual(result.missing, ['salt', 'onion']);
    });

    it('treats non-JSON garbage as "nothing classified" rather than throwing', () => {
        for (const raw of ['I am sorry, I cannot help with that.', '', '   ', '{"salt": ', '[1,2,3]']) {
            const result = parseClassificationResponse(raw, labels, ALL_IDS);
            assert.deepEqual(result.assignments, {}, `garbage response classified something: ${raw}`);
            assert.deepEqual(result.missing, labels);
            assert.deepEqual(result.invalid, []);
        }
    });

    it('ignores labels the caller did not ask about', () => {
        const raw = '{"salt":"herbs_spices","onion":"aromatics","cebula":"aromatics","ketchup":"condiments_liquids"}';
        const result = parseClassificationResponse(raw, labels, ALL_IDS);
        assert.deepEqual(Object.keys(result.assignments).sort(), ['cebula', 'onion', 'salt']);
        assert.deepEqual(result.missing, []);
    });

    it('matches a key the model padded with whitespace', () => {
        const raw = '{" salt ":"herbs_spices","onion":"aromatics","cebula":"aromatics"}';
        const result = parseClassificationResponse(raw, labels, ALL_IDS);
        assert.deepEqual(result.missing, []);
        assert.equal(result.assignments.salt, 'herbs_spices');
    });

    it('round-trips the prompt contract: every prompted label is a parseable key', () => {
        const prompted = ['Salt', 'Zwiebel', 'Ξηροί καρποί'];
        const prompt = buildClassificationPrompt(prompted);
        // The builder shows each key exactly as the parser will look it up.
        for (const label of prompted) assert.ok(prompt.includes(JSON.stringify(label)));

        const raw = JSON.stringify({ Salt: 'herbs_spices', Zwiebel: 'aromatics', 'Ξηροί καρποί': 'nuts_seeds' });
        const result = parseClassificationResponse(raw, prompted, ALL_IDS);
        assert.deepEqual(result.missing, []);
        assert.equal(result.assignments['Ξηροί καρποί'], 'nuts_seeds');
    });
});
