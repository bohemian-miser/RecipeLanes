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

// The merge-quality evidence the raw-ingredient backfill prints and dumps: what
// the classifier's raw names would do to the comparison table. This report is
// the owner's gate before a production write, so it is tested like a feature
// rather than like a log line. Pure — no Firestore, no LLM.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildRawIngredientReport,
    type RawIngredientEntry,
} from '../lib/recipe-lanes/raw-ingredient-report';
import { ingredientCategoryKey } from '../lib/recipe-lanes/ingredient-label-extract';
import {
    boundRawIngredientName,
    MAX_RAW_INGREDIENT_LENGTH,
} from '../lib/recipe-lanes/ingredient-taxonomy';

/** A label being classified in this run. */
function entry(
    label: string,
    raw: string,
    usageCount: number,
    category = 'vegetables',
): RawIngredientEntry {
    return { label, raw, category, usageCount };
}

/** A label that already has a good doc — seeded so grouping sees the corpus. */
function existing(
    label: string,
    raw: string,
    usageCount: number,
    category = 'vegetables',
): RawIngredientEntry {
    return { label, raw, category, usageCount, isNew: false };
}

describe('raw-ingredient-report — renames (label → raw table)', () => {
    it('lists only the labels whose raw name changes their row key', () => {
        const report = buildRawIngredientReport([
            entry('Carrot, Chopped', 'Carrot', 5),
            entry('Carrot', 'Carrot', 9),
            entry('Olive Oil', 'Olive Oil', 12, 'fats_oils'),
        ]);

        assert.deepEqual(
            report.renames.map(r => r.label),
            ['Carrot, Chopped'],
        );
        assert.equal(report.totalLabels, 3);
    });

    it('excludes identity by KEY, not by string equality', () => {
        // The model is asked for display-cased names but returns what it
        // returns; "carrot" and "Carrot" are the same comparison row, and
        // reporting that as a rename would bury the real ones in noise.
        const report = buildRawIngredientReport([
            entry('Carrot', 'carrot', 4),
            entry('Créme Fraîche', 'Creme Fraiche', 3, 'dairy_eggs'),
        ]);

        assert.deepEqual(report.renames, []);
    });

    it('treats a blank raw name as identity rather than as a move', () => {
        // Callers already default an absent raw to the label itself; a blank
        // that slips through must not be reported as a merge into "".
        const report = buildRawIngredientReport([
            entry('Carrot', '', 4),
            entry('Onion, Diced', '   ', 2, 'aromatics'),
        ]);

        assert.deepEqual(report.renames, []);
        assert.deepEqual(report.groups, []);
    });

    it('sorts renames by usage descending, then by label for determinism', () => {
        const report = buildRawIngredientReport([
            entry('Onion, Sliced', 'Onion', 3, 'aromatics'),
            entry('Garlic, Minced', 'Garlic', 40, 'aromatics'),
            entry('Basil, Torn', 'Basil', 3, 'herbs_spices'),
            entry('Carrot, Grated', 'Carrot', 11),
        ]);

        assert.deepEqual(
            report.renames.map(r => `${r.label}=${r.usageCount}`),
            ['Garlic, Minced=40', 'Carrot, Grated=11', 'Basil, Torn=3', 'Onion, Sliced=3'],
        );
    });

    it('floats this run\'s renames above the reviewed corpus', () => {
        // The console caps this table. An incremental run's entire risk is its
        // handful of new labels, so they must not sit below 4,000 reviewed ones.
        const report = buildRawIngredientReport([
            existing('Pinch Of Salt', 'Salt', 900, 'herbs_spices'),
            existing('Eggs', 'Egg', 800, 'dairy_eggs'),
            entry('Carrot, Grated', 'Carrot', 2),
        ]);

        assert.deepEqual(
            report.renames.map(r => [r.label, r.isNew]),
            [['Carrot, Grated', true], ['Pinch Of Salt', false], ['Eggs', false]],
        );
    });
});

describe('raw-ingredient-report — collision groups', () => {
    it('groups labels sharing a raw ingredient and skips single-member rows', () => {
        const report = buildRawIngredientReport([
            entry('Carrot', 'Carrot', 9),
            entry('Carrot, Chopped', 'Carrot', 5),
            entry('Potato', 'Potato', 7),
        ]);

        assert.equal(report.groups.length, 1);
        const [group] = report.groups;
        assert.equal(group.key, ingredientCategoryKey('Carrot'));
        assert.equal(group.raw, 'Carrot');
        assert.deepEqual(group.members.map(m => m.label), ['Carrot', 'Carrot, Chopped']);
        assert.equal(group.usageCount, 14);
        assert.equal(group.crossCategory, false);
    });

    it('keeps the identity member in its group', () => {
        // The common half of every merge is the plain label mapping to itself.
        // Filtering identities out before grouping would show the reviewer half
        // of each collision and hide the row it merges into.
        const report = buildRawIngredientReport([
            entry('Carrot, Chopped', 'Carrot', 5),
            entry('Carrot', 'Carrot', 9),
        ]);

        assert.deepEqual(report.groups[0].members.map(m => m.label), ['Carrot', 'Carrot, Chopped']);
        assert.deepEqual(report.renames.map(r => r.label), ['Carrot, Chopped']);
    });

    it('orders members by usage descending, then label', () => {
        const report = buildRawIngredientReport([
            entry('Egg, Whisked', 'Egg', 2, 'dairy_eggs'),
            entry('Egg, Large', 'Egg', 8, 'dairy_eggs'),
            entry('Egg, Beaten', 'Egg', 2, 'dairy_eggs'),
            entry('Egg', 'Egg', 30, 'dairy_eggs'),
        ]);

        assert.deepEqual(
            report.groups[0].members.map(m => m.label),
            ['Egg', 'Egg, Large', 'Egg, Beaten', 'Egg, Whisked'],
        );
    });

    it('names a group with its most-used member\'s spelling, not the first seen', () => {
        // Members agree on the row KEY, not on casing. A header reading
        // "carrot" over a group whose dominant member is spelled "Carrot"
        // reads as some other ingredient to whoever reviews the table.
        const report = buildRawIngredientReport([
            entry('Carrot, Diced', 'carrot', 5),
            entry('Carrots', 'Carrot', 900),
        ]);

        assert.equal(report.groups[0].raw, 'Carrot');
    });

    it('sorts groups by member count first, then usage, then key', () => {
        const report = buildRawIngredientReport([
            // 2 members, but enormous usage.
            entry('Water', 'Water', 400, 'condiments_liquids'),
            entry('Water, Warm', 'Water', 300, 'condiments_liquids'),
            // 3 members, modest usage — still the bigger claim about the corpus.
            entry('Onion', 'Onion', 10, 'aromatics'),
            entry('Onion, Diced', 'Onion', 6, 'aromatics'),
            entry('Onion, Sliced', 'Onion', 4, 'aromatics'),
            // Two 2-member groups with identical usage: key breaks the tie.
            entry('Basil', 'Basil', 1, 'herbs_spices'),
            entry('Basil, Torn', 'Basil', 1, 'herbs_spices'),
            entry('Apple', 'Apple', 1, 'fruits'),
            entry('Apple, Peeled', 'Apple', 1, 'fruits'),
        ]);

        assert.deepEqual(
            report.groups.map(g => g.raw),
            ['Onion', 'Water', 'Apple', 'Basil'],
        );
    });

    it('counts the comparison rows the merge removes', () => {
        const report = buildRawIngredientReport([
            entry('Onion', 'Onion', 10, 'aromatics'),
            entry('Onion, Diced', 'Onion', 6, 'aromatics'),
            entry('Onion, Sliced', 'Onion', 4, 'aromatics'),
            entry('Carrot', 'Carrot', 9),
            entry('Carrot, Chopped', 'Carrot', 5),
            entry('Potato', 'Potato', 7),
        ]);

        // 3 onion rows -> 1 (saves 2), 2 carrot rows -> 1 (saves 1), potato
        // untouched. Six labels render as three rows.
        assert.equal(report.rowsMerged, 3);
    });

    it('groups on the raw key, so casing and accents do not split a group', () => {
        const report = buildRawIngredientReport([
            entry('Tomato', 'tomato', 4),
            entry('Tomato, Diced', 'Tomato', 3),
        ]);

        assert.equal(report.groups.length, 1);
        assert.equal(report.groups[0].members.length, 2);
    });
});

describe('raw-ingredient-report — existing docs (whole-corpus view)', () => {
    it('sees a new label merging into a group it could not otherwise know about', () => {
        // The incremental-run failure this guards: scoped to the pending set,
        // "Carrot, Chopped" is one label with a raw name and no visible
        // partner, so the report would say nothing merges.
        const pendingOnly = buildRawIngredientReport([entry('Carrot, Chopped', 'Carrot', 2)]);
        assert.deepEqual(pendingOnly.groups, []);

        const withCorpus = buildRawIngredientReport([
            entry('Carrot, Chopped', 'Carrot', 2),
            existing('Carrot', 'Carrot', 900),
        ]);

        assert.equal(withCorpus.groups.length, 1);
        assert.equal(withCorpus.groups[0].hasNewMember, true);
        assert.deepEqual(
            withCorpus.groups[0].members.map(m => [m.label, m.isNew]),
            [['Carrot', false], ['Carrot, Chopped', true]],
        );
    });

    it('raises a cross-category flag that exists only because of an existing doc', () => {
        // "Tomato Paste" -> "Tomato" is harmless on its own and catastrophic
        // next to the tomato row it would be summed into. Only the corpus view
        // can tell the two apart.
        const pendingOnly = buildRawIngredientReport([
            entry('Tomato Paste', 'Tomato', 6, 'condiments_liquids'),
        ]);
        assert.deepEqual(pendingOnly.crossCategoryGroups, []);

        const withCorpus = buildRawIngredientReport([
            entry('Tomato Paste', 'Tomato', 6, 'condiments_liquids'),
            existing('Tomato', 'Tomato', 900),
        ]);

        assert.equal(withCorpus.crossCategoryGroups.length, 1);
        assert.deepEqual(withCorpus.crossCategoryGroups[0].categories, [
            'condiments_liquids',
            'vegetables',
        ]);
        // And this run is accountable for it, so the breaker must see it.
        assert.deepEqual(
            withCorpus.newCrossCategoryGroups.map(g => g.raw),
            ['Tomato'],
        );
    });

    it('does not hold a run accountable for an all-existing cross-category group', () => {
        // Already written, already reviewed. Still reported — it is still true
        // — but it must not block every later run forever.
        const report = buildRawIngredientReport([
            existing('Lemon', 'Lemon', 12, 'fruits'),
            existing('Lemon Juice', 'Lemon', 9, 'condiments_liquids'),
            entry('Potato', 'Potato', 3),
        ]);

        assert.equal(report.crossCategoryGroups.length, 1);
        assert.equal(report.crossCategoryGroups[0].hasNewMember, false);
        assert.deepEqual(report.newCrossCategoryGroups, []);
    });

    it('counts new vs existing entries', () => {
        const report = buildRawIngredientReport([
            entry('Carrot, Chopped', 'Carrot', 2),
            existing('Carrot', 'Carrot', 900),
            existing('Potato', 'Potato', 5),
        ]);

        assert.equal(report.totalLabels, 3);
        assert.equal(report.newLabels, 1);
    });

    it('sorts groups touching a new label above bigger all-existing ones', () => {
        const report = buildRawIngredientReport([
            existing('Salt', 'Salt', 900, 'herbs_spices'),
            existing('Pinch Of Salt', 'Salt', 800, 'herbs_spices'),
            existing('Salt To Taste', 'Salt', 700, 'herbs_spices'),
            existing('Carrot', 'Carrot', 10),
            entry('Carrot, Chopped', 'Carrot', 1),
        ]);

        assert.deepEqual(
            report.groups.map(g => [g.raw, g.hasNewMember]),
            [['Carrot', true], ['Salt', false]],
        );
    });

    it('treats an entry with no isNew flag as new', () => {
        // The default matters: a caller that forgets the flag must fail SAFE,
        // i.e. towards "this run is accountable", never towards silence.
        const report = buildRawIngredientReport([
            { label: 'Carrot, Chopped', raw: 'Carrot', category: 'vegetables', usageCount: 2 },
            { label: 'Carrot', raw: 'Carrot', category: 'vegetables', usageCount: 9 },
        ]);

        assert.equal(report.newLabels, 2);
        assert.equal(report.groups[0].hasNewMember, true);
    });
});

describe('raw-ingredient-report — cross-category flagging', () => {
    it('flags a group whose members carry different categories', () => {
        // The over-merge signature: a derivative folded into its parent. The
        // taxonomy already calls these different kinds of thing, so summing
        // their quantities into one row is almost certainly wrong.
        const report = buildRawIngredientReport([
            entry('Tomato', 'Tomato', 20),
            entry('Tomato Paste', 'Tomato', 6, 'condiments_liquids'),
        ]);

        assert.equal(report.groups.length, 1);
        assert.equal(report.groups[0].crossCategory, true);
        assert.deepEqual(report.groups[0].categories, ['condiments_liquids', 'vegetables']);
        assert.deepEqual(report.crossCategoryGroups.map(g => g.raw), ['Tomato']);
    });

    it('leaves same-category groups unflagged', () => {
        const report = buildRawIngredientReport([
            entry('Carrot', 'Carrot', 9),
            entry('Carrot, Chopped', 'Carrot', 5),
        ]);

        assert.equal(report.groups[0].crossCategory, false);
        assert.deepEqual(report.groups[0].categories, ['vegetables']);
        assert.deepEqual(report.crossCategoryGroups, []);
    });

    it('never flags a single-category merge no matter how many members', () => {
        const report = buildRawIngredientReport([
            entry('Egg', 'Egg', 30, 'dairy_eggs'),
            entry('Egg, Large', 'Egg', 8, 'dairy_eggs'),
            entry('Egg, Beaten', 'Egg', 2, 'dairy_eggs'),
        ]);

        assert.deepEqual(report.crossCategoryGroups, []);
    });

    it('keeps cross-category groups in the same order as the main table', () => {
        const report = buildRawIngredientReport([
            entry('Lemon', 'Lemon', 12, 'fruits'),
            entry('Lemon Juice', 'Lemon', 9, 'condiments_liquids'),
            entry('Lemon Zest', 'Lemon', 3, 'condiments_liquids'),
            entry('Milk', 'Milk', 20, 'dairy_eggs'),
            entry('Coconut Milk', 'Milk', 5, 'condiments_liquids'),
        ]);

        assert.deepEqual(report.crossCategoryGroups.map(g => g.raw), ['Lemon', 'Milk']);
        assert.deepEqual(
            report.crossCategoryGroups.map(g => g.key),
            report.groups.filter(g => g.crossCategory).map(g => g.key),
        );
    });
});

describe('raw-ingredient-report — edges', () => {
    it('returns an empty report for no entries', () => {
        assert.deepEqual(buildRawIngredientReport([]), {
            totalLabels: 0,
            newLabels: 0,
            renames: [],
            groups: [],
            crossCategoryGroups: [],
            newCrossCategoryGroups: [],
            rowsMerged: 0,
        });
    });

    it('survives a label or raw name of "__proto__"', () => {
        // The grouping is a Map for exactly this reason: the census keys on
        // whatever the recipe said, and a plain object would inherit a match.
        const report = buildRawIngredientReport([
            entry('__proto__', '__proto__', 2, 'other'),
            entry('__proto__, Chopped', '__proto__', 1, 'other'),
        ]);

        assert.equal(report.groups.length, 1);
        assert.deepEqual(report.groups[0].members.map(m => m.label), ['__proto__', '__proto__, Chopped']);
    });
});

// Lives here rather than in ingredient-taxonomy.test.ts because it is the
// backfill's identity fallback that this bound exists to contain: the model's
// answers are already held to it by the parser, and the only way an oversized
// value reaches `rawIngredient` is the fallback path this PR writes.
describe('boundRawIngredientName — the identity fallback cannot outgrow the contract', () => {
    // A real shape of label, padded past the bound. The identity fallback
    // stores the LABEL as its own raw name, so without a bound this is what
    // would land in a field the comparison table turns into a row heading.
    const longLabel =
        'Tomatoes, San Marzano, Peeled, Canned, Drained And Crushed By Hand, Reserving The Juice';

    it('leaves a name that already fits completely alone', () => {
        assert.equal(boundRawIngredientName('Carrot'), 'Carrot');
        const exact = 'x'.repeat(MAX_RAW_INGREDIENT_LENGTH);
        assert.equal(boundRawIngredientName(exact), exact);
    });

    it('brings an over-long label inside the bound the model is held to', () => {
        assert.ok(longLabel.length > MAX_RAW_INGREDIENT_LENGTH, 'fixture must actually be too long');
        const bounded = boundRawIngredientName(longLabel);

        assert.ok(
            bounded.length <= MAX_RAW_INGREDIENT_LENGTH,
            `bounded to ${bounded.length}, over the ${MAX_RAW_INGREDIENT_LENGTH} limit`,
        );
        // And it is a prefix of the original: truncation, never a rewrite.
        assert.ok(longLabel.startsWith(bounded));
    });

    it('cuts at a word boundary rather than mid-word', () => {
        assert.equal(
            boundRawIngredientName(longLabel),
            'Tomatoes, San Marzano, Peeled, Canned, Drained And Crushed By Hand, Reserving',
        );
    });

    it('drops the separator a cut leaves dangling', () => {
        // Constructed so the bound falls inside the word after a comma: the
        // retreat to the word boundary would otherwise end the stored name on
        // ", ", which reads as a value that knows it was cut short.
        const bounded = boundRawIngredientName(`${'A'.repeat(70)}, ${'B'.repeat(20)}`);

        assert.equal(bounded, 'A'.repeat(70));
        assert.ok(!/[\s,]$/.test(bounded), 'a stored name must not advertise its own truncation');
    });

    it('hard-cuts a single word longer than the bound', () => {
        // No word boundary to retreat to, so the bound still has to win.
        const bounded = boundRawIngredientName('Z'.repeat(MAX_RAW_INGREDIENT_LENGTH + 20));

        assert.equal(bounded.length, MAX_RAW_INGREDIENT_LENGTH);
        assert.equal(bounded, 'Z'.repeat(MAX_RAW_INGREDIENT_LENGTH));
    });

    it('is deterministic — the same label always yields the same name', () => {
        // This value is a grouping key, not just a display string: two runs
        // disagreeing about it would split one comparison row into two.
        assert.equal(boundRawIngredientName(longLabel), boundRawIngredientName(longLabel));
    });

    it('collapses whitespace so the result is single-line by construction', () => {
        assert.equal(boundRawIngredientName('  Olive\n  Oil \t'), 'Olive Oil');
    });

    it('yields an empty string for a label that normalises to nothing', () => {
        // The census cannot produce one (a label that normalises away has no
        // lookup key and is never classified), but the bound must not invent
        // a name for one either.
        assert.equal(boundRawIngredientName('   '), '');
    });
});
