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
    ALL_CLASSIFICATION_IDS,
    COMPARISON_CATEGORY_IDS,
    FALLBACK_CATEGORY_ID,
    ICON_ONLY_CATEGORIES,
    INGREDIENT_CATEGORIES,
} from '../lib/recipe-lanes/ingredient-taxonomy';

/** `assignments` is null-prototype by design; copy it before deep-comparing. */
function plain(assignments: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(assignments));
}

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

    it('derives the exported id lists from the category tables', () => {
        assert.deepEqual([...COMPARISON_CATEGORY_IDS], INGREDIENT_CATEGORIES.map(c => c.id));
        assert.deepEqual([...ALL_CLASSIFICATION_IDS], [
            ...INGREDIENT_CATEGORIES.map(c => c.id),
            ...ICON_ONLY_CATEGORIES.map(c => c.id),
        ]);
    });

    it('recognises every enum member and rejects anything else', () => {
        for (const category of INGREDIENT_CATEGORIES) {
            assert.equal(isIngredientCategoryId(category.id), true);
        }
        for (const bogus of ['Proteins', 'protein', 'veggies', '', undefined, null, 7, {}, ['other']]) {
            assert.equal(isIngredientCategoryId(bogus), false, `${String(bogus)} must not pass the guard`);
        }
    });

    it('does not answer prototype keys as if they were categories', () => {
        for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
            assert.equal(isIngredientCategoryId(key), false, `${key} must not pass the guard`);
            assert.equal(getIngredientCategory(key), undefined, `${key} must not resolve to a category`);
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

    it('never returns a rank that would sort an unknown id to the top', () => {
        // -1 is the failure mode a findIndex-based implementation has: it sorts
        // unclassified rows ABOVE every real group instead of into Other.
        for (const id of [undefined, '', 'legumes', 'action_or_state', '__proto__', 'constructor']) {
            assert.ok(categoryRank(id) >= 0, `${String(id)} produced a negative rank`);
            assert.ok(
                categoryRank(id) >= categoryRank('condiments_liquids'),
                `${String(id)} outranked a real category`,
            );
        }
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

    it('collapses duplicate labels and counts only the distinct ones', () => {
        // A JSON object cannot carry the same key twice, so demanding N keys for
        // a batch with repeats is an instruction the model cannot satisfy.
        const prompt = buildClassificationPrompt(['salt', 'onion', 'salt', 'onion', 'salt']);
        assert.ok(prompt.includes('LABELS TO CLASSIFY (2)'));
        assert.ok(prompt.includes('exactly 2 keys'));
        assert.equal(prompt.split('"salt"').length - 1, 1, 'salt should be listed once');
        // First-seen order is preserved.
        assert.ok(prompt.indexOf('"salt"') < prompt.indexOf('"onion"'));
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
        const result = parseClassificationResponse(raw, labels);
        assert.deepEqual(plain(result.assignments), {
            salt: 'herbs_spices',
            onion: 'aromatics',
            cebula: 'aromatics',
        });
        assert.deepEqual(result.missing, []);
        assert.deepEqual(result.invalid, []);
    });

    it('returns a null-prototype assignments object', () => {
        const result = parseClassificationResponse('{"salt":"herbs_spices"}', ['salt']);
        assert.equal(Object.getPrototypeOf(result.assignments), null);
    });

    it('strips markdown fences and surrounding prose', () => {
        const raw = [
            'Here you go:',
            '```json',
            '{"salt": "herbs_spices", "onion": "aromatics", "cebula": "aromatics"}',
            '```',
            'Hope that helps!',
        ].join('\n');
        const result = parseClassificationResponse(raw, labels);
        assert.deepEqual(result.missing, []);
        assert.equal(result.assignments.salt, 'herbs_spices');
        assert.equal(result.assignments.cebula, 'aromatics');
    });

    it('accepts an upper-case fence tag', () => {
        // Models emit ```JSON about as readily as ```json; a case-sensitive
        // match would drop the whole batch.
        for (const tag of ['JSON', 'Json', 'json', '']) {
            const raw = `\`\`\`${tag}\n{"salt":"herbs_spices","onion":"aromatics","cebula":"aromatics"}\n\`\`\``;
            const result = parseClassificationResponse(raw, labels);
            assert.deepEqual(result.missing, [], `fence tag "${tag}" was not recovered`);
            assert.equal(result.assignments.onion, 'aromatics');
        }
    });

    it('keeps looking when the first fenced block is not the answer', () => {
        const raw = [
            'First, the format I will use:',
            '```text',
            'label -> category',
            '```',
            'And the answer:',
            '```json',
            '{"salt":"herbs_spices","onion":"aromatics","cebula":"aromatics"}',
            '```',
        ].join('\n');
        const result = parseClassificationResponse(raw, labels);
        assert.deepEqual(result.missing, []);
        assert.equal(result.assignments.salt, 'herbs_spices');
    });

    it('recovers an unfenced object from prose that contains a stray brace', () => {
        // A first-brace-to-last-brace slice is poisoned by the "{one of}" here.
        const raw = 'Sure — I used {one of} the allowed ids for each. Answer: '
            + '{"salt":"herbs_spices","onion":"aromatics","cebula":"aromatics"}';
        const result = parseClassificationResponse(raw, labels);
        assert.deepEqual(result.missing, []);
        assert.equal(result.assignments.cebula, 'aromatics');
    });

    it('recovers an unfenced object followed by prose that contains a brace', () => {
        // Regression: the recovery used to slice from a candidate opening
        // brace to the LAST '}' in the response, so any brace in a trailing
        // sign-off swallowed the object and nothing parsed at all.
        const raw = '{"salt":"herbs_spices","onion":"aromatics","cebula":"aromatics"}'
            + ' — let me know if {anything} needs changing.';
        const result = parseClassificationResponse(raw, labels);
        assert.deepEqual(result.missing, []);
        assert.equal(result.assignments.cebula, 'aromatics');
    });

    it('recovers an object braced by prose on BOTH sides', () => {
        const raw = 'I picked {one of} the ids for each label. Here you go: '
            + '{"salt":"herbs_spices","onion":"aromatics","cebula":"aromatics"}'
            + ' Hope that helps — ping me if {any} look wrong.';
        const result = parseClassificationResponse(raw, labels);
        assert.deepEqual(result.missing, []);
        assert.equal(result.assignments.salt, 'herbs_spices');
        assert.equal(result.assignments.onion, 'aromatics');
        assert.equal(result.assignments.cebula, 'aromatics');
    });

    it('prefers the outermost object when the answer itself nests braces', () => {
        const raw = 'Result: {"salt":"herbs_spices","onion":"aromatics","cebula":"aromatics"}. Done {ok}.';
        const result = parseClassificationResponse(raw, labels);
        assert.deepEqual(result.missing, []);
        assert.equal(Object.keys(plain(result.assignments)).length, 3);
    });

    it('reports a label the response left out, keeping the ones it got', () => {
        const raw = '{"salt":"herbs_spices","onion":"aromatics"}';
        const result = parseClassificationResponse(raw, labels);
        assert.deepEqual(result.missing, ['cebula']);
        assert.deepEqual(result.invalid, []);
        assert.equal(result.assignments.onion, 'aromatics');
        assert.equal(result.assignments.cebula, undefined);
    });

    it('rejects a category id that is not in the enum', () => {
        const raw = '{"salt":"seasonings","onion":"aromatics","cebula":"AROMATICS "}';
        const result = parseClassificationResponse(raw, labels);
        assert.deepEqual(result.invalid, [{ label: 'salt', value: 'seasonings' }]);
        assert.deepEqual(result.missing, ['salt'], 'a rejected label still needs re-classifying');
        // Case and stray whitespace around a real id are tolerated.
        assert.equal(result.assignments.cebula, 'aromatics');
    });

    it('derives the allowed ids from the same options the prompt uses', () => {
        const raw = '{"salt":"action_or_state","onion":"aromatics","cebula":"aromatics"}';

        const forRows = parseClassificationResponse(raw, labels);
        assert.deepEqual(forRows.invalid, [{ label: 'salt', value: 'action_or_state' }]);
        assert.deepEqual(forRows.missing, ['salt']);

        const forIcons = parseClassificationResponse(raw, labels, { includeIconCategories: true });
        assert.deepEqual(forIcons.invalid, []);
        assert.deepEqual(forIcons.missing, []);
        assert.equal(forIcons.assignments.salt, 'action_or_state');
    });

    it('rejects non-string category values without throwing', () => {
        const raw = '{"salt":null,"onion":["aromatics"],"cebula":"aromatics"}';
        const result = parseClassificationResponse(raw, labels);
        assert.deepEqual(result.invalid.map(i => i.label), ['salt', 'onion']);
        assert.deepEqual(result.missing, ['salt', 'onion']);
    });

    it('treats non-JSON garbage as "nothing classified" rather than throwing', () => {
        for (const raw of ['I am sorry, I cannot help with that.', '', '   ', '{"salt": ', '[1,2,3]']) {
            const result = parseClassificationResponse(raw, labels);
            assert.deepEqual(plain(result.assignments), {}, `garbage response classified something: ${raw}`);
            assert.deepEqual(result.missing, labels);
            assert.deepEqual(result.invalid, []);
        }
    });

    it('ignores labels the caller did not ask about', () => {
        const raw = '{"salt":"herbs_spices","onion":"aromatics","cebula":"aromatics","ketchup":"condiments_liquids"}';
        const result = parseClassificationResponse(raw, labels);
        assert.deepEqual(Object.keys(plain(result.assignments)).sort(), ['cebula', 'onion', 'salt']);
        assert.deepEqual(result.missing, []);
    });

    it('matches a key the model padded with whitespace', () => {
        const raw = '{" salt ":"herbs_spices","onion":"aromatics","cebula":"aromatics"}';
        const result = parseClassificationResponse(raw, labels);
        assert.deepEqual(result.missing, []);
        assert.equal(result.assignments.salt, 'herbs_spices');
    });

    it('prefers an exact key over a padded one that trims to the same label', () => {
        const raw = '{" salt ":"other","salt":"herbs_spices","onion":"aromatics","cebula":"aromatics"}';
        const result = parseClassificationResponse(raw, labels);
        assert.equal(result.assignments.salt, 'herbs_spices');
    });

    it('lets the first of two padded duplicates win rather than the last', () => {
        const raw = '{" salt ":"herbs_spices","salt  ":"other","onion":"aromatics","cebula":"aromatics"}';
        const result = parseClassificationResponse(raw, labels);
        assert.equal(result.assignments.salt, 'herbs_spices');
        assert.deepEqual(result.invalid, []);
    });

    it('classifies a label that collides with an Object prototype key', () => {
        // Recipe text really can produce these; on a plain {} the assignment
        // either no-ops ("__proto__") or is masked by an inherited value.
        const protoLabels = ['__proto__', 'constructor', 'toString', 'salt'];
        // Written out rather than JSON.stringify'd: in an object literal
        // `__proto__:` sets the prototype instead of creating an own key, so a
        // stringified fixture would silently lose the interesting case.
        const raw = '{"__proto__":"herbs_spices","constructor":"aromatics",'
            + '"toString":"vegetables","salt":"herbs_spices"}';
        const result = parseClassificationResponse(raw, protoLabels);
        assert.deepEqual(result.missing, []);
        assert.deepEqual(result.invalid, []);
        assert.equal(result.assignments['__proto__'], 'herbs_spices');
        assert.equal(result.assignments['constructor'], 'aromatics');
        assert.equal(result.assignments['toString'], 'vegetables');
        assert.deepEqual(Object.keys(plain(result.assignments)).sort(), [
            '__proto__', 'constructor', 'salt', 'toString',
        ]);
    });

    it('reports a prototype-key label as missing when the model skipped it', () => {
        const result = parseClassificationResponse('{"salt":"herbs_spices"}', ['__proto__', 'toString', 'salt']);
        assert.deepEqual(result.missing, ['__proto__', 'toString']);
    });

    it('collapses duplicate input labels into one result entry', () => {
        const dupes = ['salt', 'onion', 'salt', 'salt'];

        const ok = parseClassificationResponse('{"salt":"herbs_spices","onion":"aromatics"}', dupes);
        assert.deepEqual(ok.missing, []);
        assert.deepEqual(Object.keys(plain(ok.assignments)).sort(), ['onion', 'salt']);

        const bad = parseClassificationResponse('{"onion":"aromatics"}', dupes);
        assert.deepEqual(bad.missing, ['salt'], 'one missing entry per distinct label');

        const rejected = parseClassificationResponse('{"salt":"seasonings","onion":"aromatics"}', dupes);
        assert.deepEqual(rejected.invalid, [{ label: 'salt', value: 'seasonings' }]);
        assert.deepEqual(rejected.missing, ['salt']);
    });

    it('round-trips the prompt contract: every prompted label is a parseable key', () => {
        const prompted = ['Salt', 'Zwiebel', 'Ξηροί καρποί'];
        const prompt = buildClassificationPrompt(prompted);
        // The builder shows each key exactly as the parser will look it up.
        for (const label of prompted) assert.ok(prompt.includes(JSON.stringify(label)));

        const raw = JSON.stringify({ Salt: 'herbs_spices', Zwiebel: 'aromatics', 'Ξηροί καρποί': 'nuts_seeds' });
        const result = parseClassificationResponse(raw, prompted);
        assert.deepEqual(result.missing, []);
        assert.equal(result.assignments['Ξηροί καρποί'], 'nuts_seeds');
    });
});
