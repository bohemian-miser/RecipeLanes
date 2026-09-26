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

// The raw-ingredient guard: the enumerated set of words that must never be a
// merge key, and the function that turns them back into "key by the label".
// Pure — the composed tests at the bottom run model answers through the real
// parser and the real comparison row key, so they pin the end-to-end outcome
// rather than the guard in isolation.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    AMBIGUOUS_RAW,
    guardRawIngredient,
    isAmbiguousRaw,
    startsWithOf,
} from '../lib/recipe-lanes/raw-ingredient-guard';
import { parseClassificationResponse } from '../lib/recipe-lanes/ingredient-taxonomy';
import { ingredientRowKey } from '../lib/recipe-lanes/comparison-table';

describe('raw-ingredient guard — the ambiguous set', () => {
    // Every word the backfill runs have flagged, in every form the set lists.
    // Adding a word to the set means adding it here too (see the module doc).
    const EXPECTED = [
        'pepper', 'peppers', 'peper', 'pepers',
        'clove', 'cloves',
        'chilli', 'chillies', 'chillis', 'chili', 'chilies', 'chilis', 'chile', 'chiles',
        'white', 'whites', 'green', 'greens',
        'leaf', 'leaves',
        'breast', 'breasts', 'thigh', 'thighs', 'leg', 'legs', 'wing', 'wings', 'fillet', 'fillets',
        'stick', 'sticks', 'slice', 'slices', 'shot', 'shots', 'root', 'roots',
        'sprig', 'sprigs', 'piece', 'pieces', 'rack', 'racks', 'can', 'cans',
        'knob', 'knobs', 'stalk', 'stalks', 'bunch', 'bunches', 'head', 'heads',
    ];

    it('holds exactly the reviewed entries', () => {
        assert.deepEqual([...AMBIGUOUS_RAW].sort(), [...EXPECTED].sort());
    });

    it('stores every entry in normalized form', () => {
        for (const entry of AMBIGUOUS_RAW) {
            assert.equal(entry, entry.toLowerCase().trim(), `"${entry}" must be lowercase and trimmed`);
            assert.ok(isAmbiguousRaw(entry), `"${entry}" must match itself after normalization`);
        }
    });

    it('drops every ambiguous word as a raw name, in any case', () => {
        for (const word of EXPECTED) {
            const title = word.charAt(0).toUpperCase() + word.slice(1);
            for (const raw of [word, title, word.toUpperCase(), `  ${title}  `]) {
                assert.equal(guardRawIngredient(`${title} Label`, raw), undefined, `raw "${raw}" must be dropped`);
            }
        }
    });

    it('sees through quantities, prep, fillers and parentheticals', () => {
        for (const raw of [
            'Fresh Chilli', 'Cooked Breast', 'Sliced Peppers', '2 Cloves', 'Pinch Of Pepper',
            'Breast (Cooked, Sliced)', 'Boneless Skinless Thighs', 'Chillies, Soaked & Deseeded',
        ]) {
            assert.ok(isAmbiguousRaw(raw), `"${raw}" is still just an ambiguous word`);
        }
    });

    // Cut words compound without naming an animal: a chicken and a turkey
    // "Breast Fillet" must not total together. Colour + homonym is different —
    // "White Pepper" and "Green Chilli" each name one food and must survive.
    it('treats a phrase made only of cut words as ambiguous', () => {
        for (const raw of ['Breast Fillet', 'Thigh Fillets, Boneless', 'Leg Fillet', 'Wing Legs']) {
            assert.ok(isAmbiguousRaw(raw), `"${raw}" still names no animal`);
            assert.equal(guardRawIngredient(raw, raw), undefined);
        }
        assert.equal(guardRawIngredient('Breast Fillets', 'Chicken Breast Fillet'), undefined, 'guessed animal');
        for (const raw of ['White Pepper', 'Green Chilli', 'Green Peppers', 'Chicken Breast Fillet']) {
            assert.equal(isAmbiguousRaw(raw), false, `"${raw}" names one food`);
        }
    });

    it('treats a phrase with nothing food-bearing left as ambiguous', () => {
        for (const raw of ['Sliced', '(halved)', '2', 'To Taste']) {
            assert.ok(isAmbiguousRaw(raw), `"${raw}" carries no food at all`);
        }
    });

    it('lets a qualified name through — the qualifier is what disambiguates', () => {
        for (const raw of [
            'Black Pepper', 'White Pepper', 'Bell Pepper', 'Red Pepper', 'Garlic Clove', 'Whole Clove',
            'Dried Chilli', 'Chilli Flake', 'Chicken Breast', 'Duck Leg', 'Egg White', 'Bay Leaf',
            'Spring Green', 'Salmon Fillet', 'Zwarte Peper', 'Spaanse Peper',
        ]) {
            assert.equal(isAmbiguousRaw(raw), false, `"${raw}" names one food`);
            assert.equal(guardRawIngredient(raw, raw), raw, `"${raw}" must pass through unchanged`);
        }
    });

    it('passes ordinary raw names through untouched', () => {
        const pairs: Array<[string, string]> = [
            ['Carrot, Chopped', 'Carrot'],
            ['Marchewka, Posiekana', 'Marchewka'],
            ['Unsalted Butter, Softened', 'Unsalted Butter'],
            ['Crushed Tomatoes', 'Crushed Tomato'],
            ['Garlic Cloves, Minced', 'Garlic Clove'],
            ['Freshly Ground Black Pepper', 'Black Pepper'],
        ];
        for (const [label, raw] of pairs) {
            assert.equal(guardRawIngredient(label, raw), raw, `${label} → ${raw} must survive`);
        }
    });

    it('returns undefined for an absent raw name', () => {
        assert.equal(guardRawIngredient('Carrot', undefined), undefined);
    });

    // The label check. When the LABEL is nothing but an ambiguous word, a
    // qualified raw is the model guessing a sense the text never states — the
    // exact guess that flipped "Cloves, Minced" between two temperature-0 runs.
    it('refuses a sense the label never states', () => {
        const guesses: Array<[string, string]> = [
            ['Cloves, Minced', 'Garlic Clove'],
            ['Cloves, Minced', 'Clove'],
            ['Pinch Of Pepper', 'Black Pepper'],
            ['Peppers (mixed Colors, Chopped)', 'Bell Pepper'],
            ['Breasts', 'Chicken Breast'],
            ['Chillies, Soaked & Deseeded', 'Dried Chilli'],
            ['Peper', 'Zwarte Peper'],
            ['Whites', 'Egg White'],
            ['Leaves', 'Bay Leaf'],
        ];
        for (const [label, raw] of guesses) {
            assert.equal(guardRawIngredient(label, raw), undefined, `${label} → ${raw} is a guess`);
        }
    });

    // Measure / container words: the parser left the measure as the name and
    // put the food in the unit (v2 staging: "1 Rosemary stick, finely
    // chopped" -> "Stick, Finely Chopped"). Only the BARE word is dropped.
    it('drops a bare measure word, with prep, in any case', () => {
        for (const label of [
            'Stick, Finely Chopped', 'Stick, Very Finely Diced', 'STICKS', 'Slices', 'Shots',
            'Root (chopped)', 'Roots', 'Few Sprigs', '2 Pieces', 'Rack', 'Cans', 'Knob',
            'Stalks, Thinly Sliced', 'Bunch', 'Heads',
        ]) {
            assert.ok(isAmbiguousRaw(label), `"${label}" is only a measure`);
        }
        // Label check: a qualified guess for a bare-measure label is refused.
        assert.equal(guardRawIngredient('Stick, Finely Chopped', 'Rosemary Stick'), undefined);
        assert.equal(guardRawIngredient('Stick, Finely Diced', 'Celery Stick'), undefined);
        assert.equal(guardRawIngredient('Slices', 'Pineapple Slice'), undefined);
        assert.equal(guardRawIngredient('Shots', 'Espresso'), undefined);
    });

    it('lets a qualified measure phrase through — it names the food', () => {
        const pairs: Array<[string, string]> = [
            ['Cinnamon Stick', 'Cinnamon Stick'],
            ['Cinnamon Sticks', 'Cinnamon Stick'],
            ['1-inch Cinnamon Stick', 'Cinnamon Stick'],
            ['Rosemary Stick, Finely Chopped', 'Rosemary Stick'],
            ['Celery Sticks, Finely Diced', 'Celery Stick'],
            ['Celery Root (chopped)', 'Celery Root'],
            ['Parsley Roots', 'Parsley Root'],
            ['Espresso Shots', 'Espresso Shot'],
            ['Pineapple Slices', 'Pineapple Slice'],
            ['Pepperoni Slices', 'Pepperoni'],
            ['2-3 Rosemary Sprigs', 'Rosemary Sprig'],
            ['Few Sprigs Fresh Rosemary', 'Rosemary'],
            ['Piece Of Ginger, Grated', 'Ginger'],
            ['Can Of Diced Tomatoes', 'Diced Tomato'],
            ['Knob Of Butter', 'Butter'],
            ['Rack Of Lamb', 'Rack Of Lamb'],
        ];
        for (const [label, raw] of pairs) {
            assert.equal(guardRawIngredient(label, raw), raw, `${label} → ${raw} must survive`);
        }
    });

    // "1 Rack of Lamb" parses to the label "Of Lamb": the measure — here the
    // identity (rack vs leg vs mince) — was split off the front.
    it('drops measure-split "of" debris, from the label or the raw name', () => {
        const pairs: Array<[string, string]> = [
            ['Of Lamb', 'Lamb'],
            ['Of The Reserved Pasta Water', 'Pasta Water'],
            ['Of Rainbow Shavings', 'Of Rainbow Shaving'],
            ['Of Withered Rosemary', 'Withered Rosemary'],
            ['of lamb', 'Lamb'],
            ['OF LAMB', 'Lamb'],
            ['½ Of Lamb', 'Lamb'],
            ['Lamb', 'Of Lamb'],
        ];
        for (const [label, raw] of pairs) {
            assert.equal(guardRawIngredient(label, raw), undefined, `${label} → ${raw} is measure-split debris`);
        }
    });

    it('leaves an inner or look-alike "of" alone', () => {
        for (const label of [
            'Half Of Prepared Sauce', 'Juice Of 1 Lemon', 'Leg Of Lamb', 'Pinch Of Salt', 'Offal', 'Often Salt',
        ]) {
            assert.equal(startsWithOf(label), false, `"${label}" keeps its measure`);
        }
        assert.equal(guardRawIngredient('Half Of Prepared Sauce', 'Prepared Sauce'), 'Prepared Sauce');
        assert.equal(guardRawIngredient('Juice Of 1 Lemon', 'Lemon Juice'), 'Lemon Juice');
        assert.equal(guardRawIngredient('Offal', 'Offal'), 'Offal');
    });

    it('does not strip words that disambiguate or name a product', () => {
        // "ground", "whole", "dried" and colours are shelf-product signals —
        // they must survive normalization or "Whole Cloves" would lose its
        // raw name for no reason.
        for (const label of ['Whole Cloves', 'Ground Pepper', 'Dried Chillies', 'Black Pepper, To Taste']) {
            assert.equal(isAmbiguousRaw(label), false, `"${label}" states its sense`);
        }
    });
});

// ---------------------------------------------------------------------------
// Composed: model answer → parser (guard applied) → comparison row key
// ---------------------------------------------------------------------------

/**
 * Runs one simulated model answer through the real write-path parser and then
 * keys each label the way the comparison merge does: on the raw name when one
 * survived, otherwise on the label itself.
 */
function rowKeys(answer: Record<string, { category: string; raw: string }>, unit = ''): Map<string, string> {
    const labels = Object.keys(answer);
    const result = parseClassificationResponse(JSON.stringify(answer), labels, { includeRaw: true });
    const keys = new Map<string, string>();
    for (const label of labels) {
        const raw = result.rawAssignments[label];
        keys.set(label, raw ? ingredientRowKey(raw, unit) : ingredientRowKey(label, unit));
    }
    return keys;
}

/** Labels tagged with the food they actually mean. */
type Sensed = { label: string; sense: string; category: string; raw: string };

/**
 * The flagged groups from the staging live run and the prod dry-run, each
 * with the raw name the model ACTUALLY returned (the collapsed bare word) —
 * plus a second model reading for the unstable label.
 */
const FLAGGED: Sensed[] = [
    // "Pepper" — herbs_spices + vegetables (staging; prod; Dutch in prod)
    { label: 'Pinch Of Pepper', sense: 'black pepper', category: 'herbs_spices', raw: 'Pepper' },
    { label: 'Pepper To Taste', sense: 'black pepper', category: 'herbs_spices', raw: 'Pepper' },
    { label: 'Pepper To Taste (curry)', sense: 'black pepper', category: 'herbs_spices', raw: 'Pepper' },
    { label: 'Pepper (any Color), Sliced', sense: 'bell pepper', category: 'vegetables', raw: 'Pepper' },
    { label: 'Pepper, Sliced', sense: 'bell pepper', category: 'vegetables', raw: 'Pepper' },
    { label: 'Peppers (mixed Colors, Chopped)', sense: 'bell pepper', category: 'vegetables', raw: 'Pepper' },
    { label: 'Peppers (sliced)', sense: 'bell pepper', category: 'vegetables', raw: 'Pepper' },
    { label: 'Peper', sense: 'black pepper', category: 'herbs_spices', raw: 'Peper' },
    { label: 'Pepers Pitjes Verwijderd, Fijn Gehakt', sense: 'bell pepper', category: 'vegetables', raw: 'Peper' },
    // "Clove" — aromatics + herbs_spices
    { label: 'Cloves', sense: 'clove spice', category: 'herbs_spices', raw: 'Clove' },
    { label: 'Cloves, Minced', sense: 'garlic clove', category: 'aromatics', raw: 'Clove' },
    { label: 'Cloves, Finely Chopped', sense: 'unknown clove', category: 'herbs_spices', raw: 'Clove' },
    // "Breast" — other + proteins
    { label: 'Breasts', sense: 'breast residue', category: 'other', raw: 'Breast' },
    { label: 'Breast (cooked, Sliced)', sense: 'cooked breast', category: 'proteins', raw: 'Breast' },
    // "Whites" vs "White" (prod) — residue collapsed by singularization
    { label: 'Whites', sense: 'whites residue', category: 'dairy_eggs', raw: 'White' },
    { label: 'White', sense: 'white residue', category: 'other', raw: 'White' },
    // "Chilli" (prod) — dried vs fresh
    { label: 'Chillies, Soaked & Deseeded', sense: 'dried chilli', category: 'aromatics', raw: 'Chilli' },
    { label: 'Fresh Chilli, To Taste', sense: 'fresh chilli', category: 'aromatics', raw: 'Chilli' },
    // "Leaves" — same-category debris the cross-category flag cannot see
    { label: 'Leaves', sense: 'leaf residue', category: 'other', raw: 'Leaf' },
    { label: 'Bay Leaves', sense: 'bay leaf', category: 'herbs_spices', raw: 'Bay Leaf' },
];

function answerOf(rows: Sensed[]): Record<string, { category: string; raw: string }> {
    return Object.fromEntries(rows.map(r => [r.label, { category: r.category, raw: r.raw }]));
}

describe('raw-ingredient guard — composed with the parser and the row key', () => {
    it('keeps every flagged different-sense pair on different rows', () => {
        const keys = rowKeys(answerOf(FLAGGED));
        for (const a of FLAGGED) {
            for (const b of FLAGGED) {
                if (a.label >= b.label || a.sense === b.sense) continue;
                assert.notEqual(
                    keys.get(a.label),
                    keys.get(b.label),
                    `"${a.label}" (${a.sense}) and "${b.label}" (${b.sense}) must not share a row`,
                );
            }
        }
    });

    it('also holds when the model guesses a qualified sense for a bare label', () => {
        // The worst case the prose drafts invited: the model "helpfully"
        // qualifies signal-free labels. Every guess lands on a name some
        // explicit label also uses, so without the label check these would
        // merge a coin-toss reading into a real row.
        const guessed: Sensed[] = [
            { label: 'Cloves, Minced', sense: 'unstated clove', category: 'aromatics', raw: 'Garlic Clove' },
            { label: 'Garlic Cloves, Minced', sense: 'garlic clove', category: 'aromatics', raw: 'Garlic Clove' },
            { label: 'Pinch Of Pepper', sense: 'unstated pepper', category: 'herbs_spices', raw: 'Black Pepper' },
            { label: 'Black Pepper', sense: 'black pepper', category: 'herbs_spices', raw: 'Black Pepper' },
            { label: 'Breasts', sense: 'breast residue', category: 'proteins', raw: 'Chicken Breast' },
            { label: 'Chicken Breasts', sense: 'chicken breast', category: 'proteins', raw: 'Chicken Breast' },
            { label: 'Chillies, Soaked & Deseeded', sense: 'unstated chilli', category: 'aromatics', raw: 'Dried Chilli' },
            { label: 'Dried Chillies', sense: 'dried chilli', category: 'herbs_spices', raw: 'Dried Chilli' },
        ];
        const keys = rowKeys(answerOf(guessed));
        for (const a of guessed) {
            for (const b of guessed) {
                if (a.label >= b.label || a.sense === b.sense) continue;
                assert.notEqual(keys.get(a.label), keys.get(b.label), `"${a.label}" vs "${b.label}"`);
            }
        }
    });

    it('gives the unstable label one key whichever way the model reads it', () => {
        // "Cloves, Minced" came back herbs_spices in one temperature-0 run and
        // aromatics in the next. Its row must not move with the coin toss.
        const asSpice = rowKeys({ 'Cloves, Minced': { category: 'herbs_spices', raw: 'Clove' } });
        const asGarlic = rowKeys({ 'Cloves, Minced': { category: 'aromatics', raw: 'Garlic Clove' } });
        assert.equal(asSpice.get('Cloves, Minced'), asGarlic.get('Cloves, Minced'));
        assert.equal(asSpice.get('Cloves, Minced'), ingredientRowKey('Cloves, Minced', ''));
    });

    it('still merges the lines the feature exists to merge', () => {
        const keys = rowKeys(answerOf([
            { label: 'Carrot', sense: '', category: 'vegetables', raw: 'Carrot' },
            { label: 'Carrot, Chopped', sense: '', category: 'vegetables', raw: 'Carrot' },
            { label: 'Black Pepper', sense: '', category: 'herbs_spices', raw: 'Black Pepper' },
            { label: 'Freshly Ground Black Pepper', sense: '', category: 'herbs_spices', raw: 'Black Pepper' },
            { label: 'Garlic Clove', sense: '', category: 'aromatics', raw: 'Garlic Clove' },
            { label: 'Garlic Cloves, Minced', sense: '', category: 'aromatics', raw: 'Garlic Clove' },
            { label: 'Egg Whites', sense: '', category: 'dairy_eggs', raw: 'Egg White' },
            { label: 'Egg White, Beaten', sense: '', category: 'dairy_eggs', raw: 'Egg White' },
            { label: 'Chicken Breasts', sense: '', category: 'proteins', raw: 'Chicken Breast' },
            { label: 'Chicken Breast (cooked, Sliced)', sense: '', category: 'proteins', raw: 'Chicken Breast' },
        ]));
        const same = (a: string, b: string) => assert.equal(keys.get(a), keys.get(b), `${a} and ${b} must merge`);
        same('Carrot', 'Carrot, Chopped');
        same('Black Pepper', 'Freshly Ground Black Pepper');
        same('Garlic Clove', 'Garlic Cloves, Minced');
        same('Egg Whites', 'Egg White, Beaten');
        same('Chicken Breasts', 'Chicken Breast (cooked, Sliced)');
    });

    // v2 staging dry run: three same-category (`other`) debris labels all came
    // back raw "Stick", so rosemary and celery totalled together with no
    // cross-category flag to catch it.
    it('never puts rosemary and celery sticks on one row', () => {
        const rows: Sensed[] = [
            { label: 'Stick, Finely Chopped', sense: 'rosemary', category: 'other', raw: 'Stick' },
            { label: 'Stick, Finely Diced', sense: 'celery', category: 'other', raw: 'Stick' },
            { label: 'Stick, Very Finely Diced', sense: 'celery', category: 'other', raw: 'Stick' },
            { label: 'Rosemary Stick, Finely Chopped', sense: 'rosemary', category: 'herbs_spices', raw: 'Rosemary Stick' },
            { label: 'Celery Sticks', sense: 'celery', category: 'vegetables', raw: 'Celery Stick' },
            { label: 'Slices', sense: 'pineapple', category: 'other', raw: 'Slice' },
            { label: 'Pepperoni Slices', sense: 'pepperoni', category: 'proteins', raw: 'Slice' },
        ];
        const keys = rowKeys(answerOf(rows));
        for (const a of rows) {
            for (const b of rows) {
                if (a.label >= b.label || a.sense === b.sense) continue;
                assert.notEqual(keys.get(a.label), keys.get(b.label), `"${a.label}" (${a.sense}) vs "${b.label}" (${b.sense})`);
            }
        }
        // Each debris label keys by itself, exactly as before raw extraction.
        assert.equal(keys.get('Stick, Finely Chopped'), ingredientRowKey('Stick, Finely Chopped', ''));
    });

    it('keeps "Of Lamb" off the lamb-leg and lamb-mince rows', () => {
        const keys = rowKeys({
            'Of Lamb': { category: 'proteins', raw: 'Lamb' },
            'Lamb Mince': { category: 'proteins', raw: 'Lamb' },
            'Lamb': { category: 'proteins', raw: 'Lamb' },
        });
        assert.equal(keys.get('Of Lamb'), ingredientRowKey('Of Lamb', ''));
        assert.notEqual(keys.get('Of Lamb'), keys.get('Lamb'));
        assert.equal(keys.get('Lamb Mince'), keys.get('Lamb'), 'the unrelated merge is untouched');
    });

    it('still merges a qualified measure phrase: cinnamon sticks', () => {
        const keys = rowKeys({
            'Cinnamon Stick': { category: 'herbs_spices', raw: 'Cinnamon Stick' },
            'Cinnamon Sticks': { category: 'herbs_spices', raw: 'Cinnamon Stick' },
            '1-inch Cinnamon Stick': { category: 'herbs_spices', raw: 'Cinnamon Stick' },
        });
        assert.equal(keys.get('Cinnamon Stick'), keys.get('Cinnamon Sticks'));
        assert.equal(keys.get('Cinnamon Stick'), keys.get('1-inch Cinnamon Stick'));
        assert.equal(keys.get('Cinnamon Stick'), ingredientRowKey('Cinnamon Stick', ''));
    });

    it('keeps the category when it drops the raw name', () => {
        const result = parseClassificationResponse(
            JSON.stringify({ 'Pepper, Sliced': { category: 'vegetables', raw: 'Pepper' } }),
            ['Pepper, Sliced'],
            { includeRaw: true },
        );
        assert.equal(result.assignments['Pepper, Sliced'], 'vegetables');
        assert.equal(result.rawAssignments['Pepper, Sliced'], undefined);
        assert.deepEqual(result.missing, []);
    });
});
