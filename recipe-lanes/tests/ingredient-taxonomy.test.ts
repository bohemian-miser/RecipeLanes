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
    getClassificationCategory,
    ALL_CLASSIFICATION_CATEGORIES,
    ALL_CLASSIFICATION_IDS,
    COMPARISON_CATEGORY_IDS,
    FALLBACK_CATEGORY_ID,
    ICON_ONLY_CATEGORIES,
    INGREDIENT_CATEGORIES,
    RAW_INGREDIENT_RULES,
    RAW_RULES_VERSION,
    TAXONOMY_RULES_VERSION,
    UNCLASSIFIED_PRESENTATION,
} from '../lib/recipe-lanes/ingredient-taxonomy';

/** `assignments` is null-prototype by design; copy it before deep-comparing. */
function plain(assignments: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(assignments));
}

/**
 * The prompt's line for ONE category: `- <id> (<Label>): <rules>`.
 *
 * Boundary tests assert against this rather than against the whole prompt,
 * because "the fragment appears somewhere in the prompt" stays true if the
 * clause migrates to a different category — which is the exact regression these
 * tests exist to catch. Throws rather than returning undefined so a missing
 * category fails loudly instead of vacuously passing.
 */
function rulesLineFor(prompt: string, id: string): string {
    const line = prompt.split('\n').find(l => l.startsWith(`- ${id} (`));
    assert.ok(line, `prompt has no rules line for the category "${id}"`);
    return line;
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

    it('exports every classifiable category in display order, comparison ones first', () => {
        assert.deepEqual(
            ALL_CLASSIFICATION_CATEGORIES.map(c => c.id),
            [...ALL_CLASSIFICATION_IDS],
            'ALL_CLASSIFICATION_CATEGORIES must match ALL_CLASSIFICATION_IDS element for element',
        );
    });

    it('resolves any classifiable id, and nothing else, through getClassificationCategory', () => {
        for (const category of ALL_CLASSIFICATION_CATEGORIES) {
            assert.equal(getClassificationCategory(category.id)?.label, category.label);
        }
        // The icon-only id is reachable here but NOT through the comparison-side
        // accessor — that difference is the whole reason both exist.
        assert.equal(getClassificationCategory('action_or_state')?.id, 'action_or_state');
        assert.equal(getIngredientCategory('action_or_state'), undefined);

        // Absent / unknown / empty all collapse to undefined for renderers.
        assert.equal(getClassificationCategory(undefined), undefined);
        assert.equal(getClassificationCategory(''), undefined);
        assert.equal(getClassificationCategory('legacy_spices'), undefined);
    });

    it('keeps the unclassified presentation distinct from every real category colour', () => {
        assert.ok(UNCLASSIFIED_PRESENTATION.label.length > 0);
        assert.match(UNCLASSIFIED_PRESENTATION.color, /^#[0-9a-f]{6}$/);

        const taken = new Set(ALL_CLASSIFICATION_CATEGORIES.map(c => c.color));
        assert.ok(
            !taken.has(UNCLASSIFIED_PRESENTATION.color),
            `unclassified must not reuse a category colour (${UNCLASSIFIED_PRESENTATION.color}); ` +
                "'other' and 'action_or_state' are the two it would be confused with",
        );
        // It is a presentation, not a category: never classifiable.
        assert.equal(isIngredientCategoryId(UNCLASSIFIED_PRESENTATION.label), false);
        assert.equal(getClassificationCategory(UNCLASSIFIED_PRESENTATION.label), undefined);
    });

    it('carries a positive integer rules version', () => {
        assert.equal(typeof TAXONOMY_RULES_VERSION, 'number');
        assert.ok(Number.isInteger(TAXONOMY_RULES_VERSION), 'rules version must be an integer');
        assert.ok(TAXONOMY_RULES_VERSION > 0, 'rules version must be positive');
        // Version 1 is the pre-existing text; this branch's boundaries are 2.
        assert.ok(TAXONOMY_RULES_VERSION >= 2, 'the new boundary clauses are version 2 or later');
    });

    // Two counters, not one. Raw rules do not move labels between categories,
    // so bumping the category version for a raw-only edit would reclassify the
    // whole icon corpus (which has no raw ingredient and never will) — and,
    // worse, any backfill running between a raw-rules change and the
    // raw-writing pass would stamp the new category version onto docs carrying
    // no rawIngredient, which would then read as current forever.
    it('versions raw extraction separately from the category rules', () => {
        assert.equal(typeof RAW_RULES_VERSION, 'number');
        assert.ok(Number.isInteger(RAW_RULES_VERSION), 'raw rules version must be an integer');
        assert.ok(RAW_RULES_VERSION > 0, 'raw rules version must be positive');
    });

    // v2 = the code guard on raw names + the narrow rehydration clause. Both
    // change which labels merge, so the backfill must see every v1 doc as
    // stale and re-derive it; neither moves a category boundary.
    it('moves the raw rules version for the ambiguous-word guard', () => {
        assert.equal(RAW_RULES_VERSION, 2, 'the guard and rehydration clause change merges, so raw is 2');
        assert.equal(TAXONOMY_RULES_VERSION, 3, 'and they move no category boundary');
    });

    it('does not move the category rules version for a raw-only change', () => {
        // Adding raw extraction changed no category boundary, so this stays
        // where the plated-dishes PR left it. If a later PR does move a
        // category boundary, bump this and the constant together.
        assert.equal(
            TAXONOMY_RULES_VERSION,
            3,
            'raw extraction must not force a reclassification of the category corpus',
        );
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

    // These three boundaries were added because the classifier was measurably
    // unstable without them: two temperature-0 dry runs of the label backfill
    // agreed on 97.3% of assignments, and the disagreements clustered on the
    // labels no rule covered. Assert the fragments individually so that a later
    // edit to a `rules` string cannot silently drop a boundary back into the
    // coin-toss zone while the generic "rules appear verbatim" test above
    // still passes.
    // Asserted against the OWNING CATEGORY'S line, not against the prompt as a
    // whole: a fragment-anywhere check keeps passing if the clause is moved to
    // another category, which is precisely the regression worth catching.
    it('names the leavener boundary so raising agents cannot drift to Other', () => {
        const line = rulesLineFor(buildClassificationPrompt(labels), 'grains_starches');
        assert.ok(
            line.includes(
                'raising agents and leaveners (baking powder, baking soda/bicarbonate, yeast — including nutritional yeast)',
            ),
            'grains_starches must claim leaveners explicitly',
        );
    });

    it('names the concentrated-paste boundary so tomato paste cannot drift to Vegetables', () => {
        const line = rulesLineFor(buildClassificationPrompt(labels), 'condiments_liquids');
        assert.ok(
            line.includes('concentrated pastes (tomato paste, curry paste, miso, tahini)'),
            'condiments_liquids must claim concentrated pastes explicitly',
        );
    });

    it('names the egg-part boundary so "whites" cannot drift to Other', () => {
        const line = rulesLineFor(buildClassificationPrompt(labels), 'dairy_eggs');
        assert.ok(
            line.includes('egg parts (whites, yolks)'),
            'dairy_eggs must claim egg parts explicitly',
        );
    });

    // A different failure from the three above: here the classifier was not
    // unstable, it was confidently botanical — sliced tomato and avocado went to
    // `fruits` while canned tomato went to `vegetables`, splitting one
    // ingredient across two groups on preparation alone. Both halves of the
    // boundary are asserted because the model needs telling where the item goes
    // AND that its other reading is wrong.
    it('claims botanically-fruit produce for Vegetables', () => {
        const line = rulesLineFor(buildClassificationPrompt(labels), 'vegetables');
        assert.ok(
            line.includes(
                'culinary vegetables that are botanically fruit (tomato, avocado, cucumber, capsicum/bell pepper, zucchini, eggplant) belong here in whole, cut, canned, or crushed forms',
            ),
            'vegetables must claim culinary vegetables that are botanically fruit',
        );
    });

    it('excludes culinary vegetables from Fruits, mirroring the vegetables rule', () => {
        const line = rulesLineFor(buildClassificationPrompt(labels), 'fruits');
        assert.ok(
            line.includes('NOT culinary vegetables like tomato/avocado/cucumber (see vegetables)'),
            'fruits must carry the mirroring exclusion',
        );
    });

    // The icon corpus's last unruled boundary. A plated composite dish has no
    // single ingredient to be classified as, so names like "Simple Duck
    // Sandwich On A Plate" drifted between proteins, other and action_or_state
    // from run to run. Owner-settled 2026-09-17: a plated dish is a result of
    // cooking, so it sits with the other process states.
    it('sends plated composite dishes to action_or_state, not to their dominant ingredient', () => {
        // action_or_state only exists in the icon variant of the prompt.
        const line = rulesLineFor(
            buildClassificationPrompt(labels, { includeIconCategories: true }),
            'action_or_state',
        );
        assert.ok(
            line.includes('plated, assembled, or served composite dishes'),
            'action_or_state must claim plated composite dishes',
        );
        assert.ok(
            line.includes('they belong here rather than in the category of whichever ingredient dominates them'),
            'the clause must say the dominant ingredient does NOT win',
        );
    });

    // The two clauses that both mention tomato have to agree about which of
    // them owns the jar of paste, or the classifier is being handed a genuine
    // contradiction rather than a boundary.
    it('hands concentrated tomato paste to condiments_liquids, so the two tomato clauses do not collide', () => {
        const prompt = buildClassificationPrompt(labels);
        const vegetables = rulesLineFor(prompt, 'vegetables');

        assert.ok(
            vegetables.includes('concentrated tomato paste belongs in condiments_liquids'),
            'the vegetables clause must yield concentrated tomato paste explicitly',
        );
        // The wording it replaced: "fresh or otherwise" swept paste in too.
        assert.ok(
            !vegetables.includes('fresh or otherwise'),
            'vegetables must enumerate the forms it claims, not claim every form',
        );
        assert.ok(
            rulesLineFor(prompt, 'condiments_liquids').includes('tomato paste'),
            'condiments_liquids must still claim what vegetables just handed it',
        );
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

    // The pre-raw OUTPUT block, copied verbatim out of the version of the
    // builder that predates raw extraction (with the label count substituted).
    // Held here as the byte-level baseline for "includeRaw defaults to off and
    // changes nothing": the icon backfill and the classify-on-miss path share
    // this builder, and a stray word added to their prompt is a silent
    // reclassification risk for a feature neither of them uses.
    const PRE_RAW_OUTPUT_BLOCK = `OUTPUT:
Return a single raw JSON object mapping every label above to exactly one category id, using each label as the key exactly as it appears above:
{"<label>": "<category_id>"}
Rules for the output:
- Include every label — the object must have exactly 3 keys.
- Values must be one of: ${INGREDIENT_CATEGORIES.map(c => c.id).join(', ')}.
- No markdown code fences, no commentary, no trailing text. Output the JSON object and nothing else.`;

    it('leaves the default prompt byte-identical to the one that predates raw extraction', () => {
        const prompt = buildClassificationPrompt(labels);

        assert.ok(
            prompt.endsWith(`\n\n${PRE_RAW_OUTPUT_BLOCK}`),
            'the default output contract must be the pre-raw one, word for word',
        );
        // Nothing inserted between the LANGUAGE section and the label list
        // either — that is where the raw rules go when they are asked for.
        assert.ok(
            prompt.includes(
                'genuinely unclassifiable in any language.\n\nLABELS TO CLASSIFY (3):',
            ),
            'no section may be spliced in ahead of the label list by default',
        );
        assert.ok(!prompt.includes('RAW INGREDIENT'), 'the raw section must be absent by default');
        assert.ok(!prompt.includes('raw ingredient'), 'no raw-extraction wording may leak in');

        // And the option is genuinely off by default, not merely absent here.
        assert.equal(prompt, buildClassificationPrompt(labels, { includeRaw: false }));
    });

    it('embeds the raw-ingredient rules verbatim, master litmus first', () => {
        const prompt = buildClassificationPrompt(labels, { includeRaw: true });
        assert.ok(prompt.includes(RAW_INGREDIENT_RULES), 'the rules must be embedded verbatim');

        // The lists can only ever be examples; the litmus is the test that
        // generalises to a label no example covers, so it must be read first.
        assert.ok(
            RAW_INGREDIENT_RULES.startsWith(
                "The raw ingredient is the label's pre-processed pantry form: the item as a shopper would buy it, before this recipe's own prep.",
            ),
            'the master litmus must be the first thing the rules say',
        );
        for (const clause of [
            'Strip a qualifier only when the difference is PRODUCED IN THE KITCHEN by prep',
            'keep it when the difference EXISTS AT PURCHASE as a different shelf product',
            'When unsure, keep the label as its own raw ingredient — never guess a merge',
            'Return the raw name in the SAME LANGUAGE as the label, singular, no quantities, no prep words',
            'Over-merging is silent data corruption; under-merging is cosmetic. Identity (raw = label, normalized) is always safe.',
        ]) {
            assert.ok(RAW_INGREDIENT_RULES.includes(clause), `the litmus is missing: ${clause}`);
        }
        assert.ok(
            RAW_INGREDIENT_RULES.indexOf('MERGE (prep, not product)')
                > RAW_INGREDIENT_RULES.indexOf('PRODUCED IN THE KITCHEN'),
            'the litmus must precede the example lists',
        );
    });

    // Every example named in the plan's merge boundary. Asserted one by one
    // rather than as a blob: these are the cases the boundary was actually
    // argued over, and losing one to a rewrite is how the classifier quietly
    // goes back to guessing on it.
    it('names every MERGE example, so prep qualifiers are stripped', () => {
        const prompt = buildClassificationPrompt(labels, { includeRaw: true });
        for (const example of [
            'chopped', 'diced', 'sliced', 'minced', 'grated', 'shredded', 'julienned',
            'cubed', 'halved', 'quartered', 'torn', 'cut into X',
            'melted', 'softened', 'room-temperature', 'chilled', 'cold', 'warm', 'beaten',
            'whisked', 'sifted', 'peeled', 'seeded', 'cored', 'stemmed', 'trimmed',
            'rinsed', 'drained', 'thawed',
            'cooked rice → rice', 'toasted nuts → nut', 'hard-boiled egg → egg',
            '"fresh" as qualifier (fresh basil → basil)',
            'fresh vs frozen same item (frozen peas → pea)',
            'size adjectives (large egg → egg)',
            'plural → singular',
            // Crushing is prep only when a whole item is crushed in the
            // kitchen; the tin is handled on the KEEP DISTINCT side.
            'crushing a whole item in the kitchen (crushed garlic clove → garlic clove, crushed ice → ice)',
        ]) {
            assert.ok(prompt.includes(example), `the MERGE list is missing: ${example}`);
        }
    });

    // The MERGE examples must obey the rule they teach. "toasted nuts → nuts"
    // and "frozen peas → peas" told the model to emit a plural while the litmus
    // demanded singular, so the same pantry item could key as "pea" from one
    // label and "peas" from another — two rows that never merge, which is the
    // exact bug raw extraction exists to fix.
    it('keeps every MERGE example arrow pointing at a singular raw name', () => {
        for (const plural of ['→ nuts', '→ peas', '→ tomatoes', '→ eggs', '→ carrots']) {
            assert.ok(
                !RAW_INGREDIENT_RULES.includes(plural),
                `a MERGE example emits a plural raw name (${plural}), contradicting the singular rule`,
            );
        }
        assert.ok(
            RAW_INGREDIENT_RULES.includes(
                'The raw name is always singular even when it reads awkwardly ("pea", "oat", "breadcrumb") — it is a merge key first, display text second.',
            ),
            'the rules must say outright that singular wins over readability',
        );
    });

    // "Never guess a merge" and "return it singular" read as a contradiction
    // for an unsure label: one says keep the label, the other says change it.
    // The precedence clause settles it — identity means the same PRODUCT, not
    // the same characters.
    it('states that normalization still applies to a label it is unsure about', () => {
        const prompt = buildClassificationPrompt(labels, { includeRaw: true });
        for (const clause of [
            'PRECEDENCE: "never guess" governs PRODUCT IDENTITY only.',
            'Grammatical normalization ALWAYS applies, including to a label you are unsure about',
            'make it singular, drop quantities and counts, and drop only unambiguously pure-prep words',
            'So an unsure "Whole Peeled Tomatoes" becomes "Whole Peeled Tomato": the same product, normalized. Never "tomato", and never the label copied out verbatim.',
        ]) {
            assert.ok(prompt.includes(clause), `the precedence rule is missing: ${clause}`);
        }
        // The closing line has to agree with it rather than re-licensing a
        // verbatim copy of the label.
        assert.ok(
            RAW_INGREDIENT_RULES.includes('Identity (raw = label, normalized) is always safe.'),
            'the safe-fallback line must say "normalized" too',
        );
    });

    // The longer half on purpose: over-merging silently sums unrelated
    // quantities, under-merging only leaves two rows where one would read
    // better. Each of these is a product the shopper buys separately.
    it('names every KEEP DISTINCT example, so shelf products are not merged', () => {
        const prompt = buildClassificationPrompt(labels, { includeRaw: true });
        for (const example of [
            'dried oregano', 'sun-dried tomato', 'dried mushrooms',
            'smoked paprika', 'smoked salmon',
            'crushed tomatoes', 'whole peeled tomatoes',
            'diced tomatoes in the canned-product sense', 'canned/tinned tomatoes',
            'tomato paste', 'passata', 'ketchup', 'lemon juice', 'lemon zest',
            'coconut milk/cream — never the parent',
            'ground cumin ≠ cumin seeds',
            'ground beef ≠ beef', 'chicken breast ≠ thigh ≠ whole',
            'egg yolk ≠ egg white ≠ egg',
            'unsalted butter ≠ butter', 'extra-virgin olive oil ≠ olive oil',
            'whole milk ≠ milk',
            'red onion', 'cherry tomato', 'basmati rice',
            'all-purpose flour ≠ bread flour',
            'powdered/granulated/brown sugar distinct', 'sea salt ≠ salt',
        ]) {
            assert.ok(prompt.includes(example), `the KEEP DISTINCT list is missing: ${example}`);
        }
    });

    // The spec's own worst-case over-merge, and it was hiding in the MERGE
    // list: "crushed-as-prep" textually matches "Crushed Tomatoes", which is a
    // tin off a shelf whose label almost never says "canned". Merging that into
    // "tomato" folds a 400g tin into fresh tomatoes and produces a total that
    // looks entirely plausible.
    // Evidence-driven, from the backfill's cross-category collision report on a
    // prod dry-run: of four flagged merges the one real error was "Whites"
    // (dairy_eggs) pulled together with "White" (other). Both are parser debris
    // rather than foods, so the merge invented an ingredient no recipe
    // contains. The failure shape — residue that resembles a real ingredient
    // closely enough to attract it — is general, hence a rule and not a
    // per-label patch.
    it('treats not-a-food parser residue as its own raw ingredient', () => {
        const prompt = buildClassificationPrompt(labels, { includeRaw: true });

        assert.ok(
            prompt.includes(
                'For any label that is not recognisably a food or drink item, the raw ingredient is the label itself, normalized — never merge it with another label, and never merge it with a real ingredient it happens to resemble',
            ),
            'the residue clause must state the identity rule and both no-merge directions',
        );
        assert.ok(
            prompt.includes(
                'Residue labels are individually harmless; merging them invents ingredients that no recipe contains.',
            ),
            'the clause must say why the merge is worse than the residue',
        );

        // The three kinds of debris the corpus actually produces, named so the
        // model has an example of each rather than only the category.
        for (const example of [
            '"White", "Whites", "Green"',      // bare colours / adjectives
            '"Leaves", "Of Lamb", "(halved)", "(finely chopped)"', // fragments
            '"Cheesecloth", "Sharp Knife"',    // equipment
        ]) {
            assert.ok(prompt.includes(example), `the residue clause is missing: ${example}`);
        }

        // The two worked negatives, including the pair that produced the flag.
        assert.ok(
            prompt.includes('"Whites" is NOT "egg white", "Leaves" is NOT "bay leaf"'),
            'the clause must name the lookalike merges it forbids',
        );
        for (const label of ['Whites', 'Leaves', 'Cheesecloth']) {
            assert.ok(prompt.includes(label), `the residue examples must name ${label}`);
        }
    });

    // The prod dry-run flagged "Chillies, Soaked & Deseeded" merged with
    // "Fresh Chilli, To Taste": the only evidence of a dried product was the
    // verb. The clause is fenced by three review findings — only three verbs,
    // only items genuinely sold both ways, and no qualifier added to a name
    // that already means the dried form.
    it('reads a rehydration verb as a dried product, narrowly', () => {
        const prompt = buildClassificationPrompt(labels, { includeRaw: true });

        assert.ok(
            prompt.includes(
                'REHYDRATION: "soaked", "rehydrated" or "reconstituted" shows an item was bought DRIED only when that item is commonly sold both dried and fresh or canned — mushrooms, beans, pulses, chillies.',
            ),
            'the clause must name the verbs AND the condition that limits them',
        );
        for (const example of [
            '"Porcini, Soaked" → "Dried Porcini"',
            '"Chickpeas, Soaked Overnight" → "Dried Chickpea"',
            '("Rice, Soaked" → "Rice")',
            '("Raisins, Soaked" → "Raisin", never "Dried Raisin")',
        ]) {
            assert.ok(prompt.includes(example), `the rehydration clause is missing: ${example}`);
        }

        // You steep fresh mint and bloom ground spice in fat — not dried
        // signals — and gelatine/saffron examples fabricated product specs.
        for (const banned of ['steeped', 'bloomed', 'gelatine', 'saffron']) {
            assert.ok(!RAW_INGREDIENT_RULES.includes(banned), `${banned} must not be in the rules`);
        }
        assert.ok(
            RAW_INGREDIENT_RULES.indexOf('REHYDRATION') > RAW_INGREDIENT_RULES.indexOf('KEEP DISTINCT'),
            'the clause follows the dried-vs-fresh boundary it refines',
        );
    });

    // Homonyms are settled in CODE (raw-ingredient-guard.ts), not prose. The
    // prose attempts — canonical names, a sense ladder, a default, and a
    // no-strip exception for residue — could not survive string-equality
    // merging and were removed; this pins that they stay removed, so the
    // model is never told to emit names the guard would then contradict.
    it('leaves homonyms to the code guard rather than prose', () => {
        for (const removed of [
            'AMBIGUOUS WORDS',
            'PREP-STRIPPING IS OFF',
            'DEFAULT',
            'Bell Pepper',
            'Garlic Clove',
            'Zwarte Peper',
            'Dried Chilli',
        ]) {
            assert.ok(!RAW_INGREDIENT_RULES.includes(removed), `"${removed}" belongs to the removed homonym prose`);
        }
    });

    it('keeps processed tomato products off the merge path, even unlabelled as canned', () => {
        const prompt = buildClassificationPrompt(labels, { includeRaw: true });

        assert.ok(
            prompt.includes(
                'these are shelf products EVEN WHEN the label omits "canned" or "tinned", so "Crushed Tomatoes" becomes "Crushed Tomato" and never "tomato"',
            ),
            'the rules must name the unlabelled-tin case and its worked answer',
        );
        // The blanket wording that caused it must be gone: crushing is prep
        // only for a whole item crushed in the kitchen.
        assert.ok(
            !RAW_INGREDIENT_RULES.includes('crushed-as-prep'),
            'the blanket "crushed is prep" token must not survive — it matches Crushed Tomatoes',
        );
        // Both sides stated, as with the botanical-fruit boundary: the model
        // needs telling where the item goes AND that its other reading is wrong.
        const merge = RAW_INGREDIENT_RULES.slice(
            RAW_INGREDIENT_RULES.indexOf('MERGE (prep, not product)'),
            RAW_INGREDIENT_RULES.indexOf('KEEP DISTINCT'),
        );
        assert.ok(merge.includes('crushed garlic clove'), 'MERGE keeps kitchen crushing');
        assert.ok(
            !merge.includes('crushed tomatoes'),
            'the tin must not appear on the MERGE side',
        );
    });

    it('switches the output contract to the object shape when raw is asked for', () => {
        const prompt = buildClassificationPrompt(labels, { includeRaw: true });
        assert.ok(prompt.includes('{"<label>": {"category": "<category_id>", "raw": "<raw_ingredient>"}}'));
        assert.ok(!prompt.includes('{"<label>": "<category_id>"}'), 'the bare-id contract must be replaced, not offered alongside');
        assert.ok(prompt.includes(`exactly ${labels.length} keys`));
        // 80 is interpolated from MAX_RAW_INGREDIENT_LENGTH, not typed out, so
        // the bound the model is told cannot drift from the one enforced. The
        // parser-side boundary tests below pin the same number from the other
        // direction: exactly 80 accepted, 81 dropped.
        assert.ok(
            prompt.includes('"raw" must be a non-empty single-line name of at most 80 characters'),
            'the prompt must state the same bound the parser enforces',
        );
        assert.ok(/no markdown code fences/i.test(prompt));
        assert.ok(!prompt.includes('```'), 'the prompt itself must not contain a fence');
        // The taxonomy half is untouched: every category still carries its rules.
        for (const category of INGREDIENT_CATEGORIES) {
            assert.ok(prompt.includes(category.rules), `raw prompt lost the rules for ${category.id}`);
        }
    });

    it('carries raw and icon categories independently', () => {
        const both = buildClassificationPrompt(labels, {
            includeIconCategories: true,
            includeRaw: true,
        });
        assert.ok(both.includes('action_or_state'));
        assert.ok(both.includes(RAW_INGREDIENT_RULES));
        assert.ok(both.includes('"category" must be one of: '));
        assert.ok(both.includes('action_or_state.'), 'the id list must include the icon-only id');
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

    it('leaves rawAssignments empty for a legacy bare-id response', () => {
        const result = parseClassificationResponse(
            '{"salt":"herbs_spices","onion":"aromatics","cebula":"aromatics"}',
            labels,
        );
        assert.deepEqual(plain(result.rawAssignments), {});
        assert.equal(Object.getPrototypeOf(result.rawAssignments), null);
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

// The `includeRaw` response shape. Both shapes are accepted in BOTH modes,
// because the option controls what we ask for and not what arrives: a model
// told to return objects still sometimes returns bare strings, and a category
// is too useful to throw away over a missing merge hint.
describe('ingredient-taxonomy — parseClassificationResponse with raw ingredients', () => {
    const labels = ['Carrot, Chopped', 'Carrot', 'Marchewka, Posiekana'];
    const opts = { includeRaw: true };

    it('reads the object shape into parallel category and raw records', () => {
        const raw = JSON.stringify({
            'Carrot, Chopped': { category: 'vegetables', raw: 'Carrot' },
            Carrot: { category: 'vegetables', raw: 'Carrot' },
            'Marchewka, Posiekana': { category: 'vegetables', raw: 'Marchewka' },
        });
        const result = parseClassificationResponse(raw, labels, opts);

        assert.deepEqual(plain(result.assignments), {
            'Carrot, Chopped': 'vegetables',
            Carrot: 'vegetables',
            'Marchewka, Posiekana': 'vegetables',
        });
        // Raw stays in the label's own language — no cross-language merging.
        assert.deepEqual(plain(result.rawAssignments), {
            'Carrot, Chopped': 'Carrot',
            Carrot: 'Carrot',
            'Marchewka, Posiekana': 'Marchewka',
        });
        assert.deepEqual(result.missing, []);
        assert.deepEqual(result.invalid, []);
        assert.equal(Object.getPrototypeOf(result.rawAssignments), null);
    });

    it('still accepts the legacy bare-id shape when raw was asked for', () => {
        const raw = '{"Carrot, Chopped":"vegetables","Carrot":"vegetables","Marchewka, Posiekana":"vegetables"}';
        const result = parseClassificationResponse(raw, labels, opts);
        assert.deepEqual(result.missing, []);
        assert.deepEqual(result.invalid, []);
        assert.equal(result.assignments.Carrot, 'vegetables');
        assert.deepEqual(plain(result.rawAssignments), {}, 'no raw offered, so none recorded');
    });

    it('reads the object shape even when raw was NOT asked for', () => {
        const raw = JSON.stringify({ Carrot: { category: 'vegetables', raw: 'Carrot' } });
        const result = parseClassificationResponse(raw, ['Carrot']);
        assert.equal(result.assignments.Carrot, 'vegetables');
        assert.equal(result.rawAssignments.Carrot, 'Carrot');
    });

    it('takes the two shapes mixed within one response', () => {
        const raw = JSON.stringify({
            'Carrot, Chopped': { category: 'vegetables', raw: 'Carrot' },
            Carrot: 'vegetables',
            'Marchewka, Posiekana': { category: 'vegetables', raw: 'Marchewka' },
        });
        const result = parseClassificationResponse(raw, labels, opts);
        assert.deepEqual(result.missing, []);
        assert.deepEqual(Object.keys(plain(result.assignments)).length, 3);
        assert.deepEqual(plain(result.rawAssignments), {
            'Carrot, Chopped': 'Carrot',
            'Marchewka, Posiekana': 'Marchewka',
        });
    });

    it('strips fences around an object-shaped response', () => {
        const raw = [
            'Here you go:',
            '```json',
            '{"Carrot": {"category": "vegetables", "raw": "Carrot"}}',
            '```',
        ].join('\n');
        const result = parseClassificationResponse(raw, ['Carrot'], opts);
        assert.deepEqual(result.missing, []);
        assert.equal(result.assignments.Carrot, 'vegetables');
        assert.equal(result.rawAssignments.Carrot, 'Carrot');
    });

    // A bad raw costs the merge; a bad category costs the answer. The label
    // always keeps its category, and a caller with no raw name falls back to
    // identity (raw = label), which is the conservative outcome anyway.
    it('drops an unusable raw name but keeps the category', () => {
        const cases: Array<[string, unknown]> = [
            ['missing', undefined],
            ['empty', ''],
            ['whitespace only', '   '],
            ['multiline', 'Carrot\nChopped'],
            ['carriage return', 'Carrot\r\nChopped'],
            ['oversized', 'C'.repeat(81)],
            ['oversized after trim', `  ${'C'.repeat(81)}  `],
            ['not a string', 42],
            ['null', null],
            ['nested object', { name: 'Carrot' }],
            ['array', ['Carrot']],
        ];
        for (const [name, rawValue] of cases) {
            const entry: Record<string, unknown> = { category: 'vegetables' };
            if (rawValue !== undefined) entry.raw = rawValue;
            const response = JSON.stringify({ Carrot: entry });

            const result = parseClassificationResponse(response, ['Carrot'], opts);
            assert.equal(result.assignments.Carrot, 'vegetables', `${name}: category must survive`);
            assert.deepEqual(result.missing, [], `${name}: the label is classified, not missing`);
            assert.deepEqual(result.invalid, [], `${name}: a bad raw is not an invalid entry`);
            assert.equal(result.rawAssignments.Carrot, undefined, `${name}: raw must be dropped`);
        }
    });

    it('trims surrounding whitespace off a usable raw name', () => {
        const raw = JSON.stringify({ Carrot: { category: 'vegetables', raw: '  Carrot \n' } });
        const result = parseClassificationResponse(raw, ['Carrot'], opts);
        // Single-line is judged AFTER trimming, so a trailing newline is
        // forgiven while an actual two-line answer (above) is not.
        assert.equal(result.rawAssignments.Carrot, 'Carrot');
    });

    it('accepts a raw name of exactly the 80-character bound', () => {
        const atBound = 'C'.repeat(80);
        const raw = JSON.stringify({ Carrot: { category: 'vegetables', raw: atBound } });
        const result = parseClassificationResponse(raw, ['Carrot'], opts);
        assert.equal(result.rawAssignments.Carrot, atBound);
    });

    it('invalidates the whole entry when the object carries a bogus category', () => {
        const raw = JSON.stringify({
            'Carrot, Chopped': { category: 'root_vegetables', raw: 'Carrot' },
            Carrot: { category: 'vegetables', raw: 'Carrot' },
            'Marchewka, Posiekana': { raw: 'Marchewka' },
        });
        const result = parseClassificationResponse(raw, labels, opts);

        assert.deepEqual(result.invalid, [
            // A string category is reported as itself, so the log line reads
            // like the legacy one rather than dumping the whole entry.
            { label: 'Carrot, Chopped', value: 'root_vegetables' },
            // With no category field there is nothing else to report.
            { label: 'Marchewka, Posiekana', value: '{"raw":"Marchewka"}' },
        ]);
        assert.deepEqual(result.missing, ['Carrot, Chopped', 'Marchewka, Posiekana']);
        // A rejected entry contributes no raw either — it is going to be retried.
        assert.deepEqual(plain(result.rawAssignments), { Carrot: 'Carrot' });
    });

    it('rejects an object whose category is outside the options in play', () => {
        const raw = JSON.stringify({ Carrot: { category: 'action_or_state', raw: 'Carrot' } });

        const forRows = parseClassificationResponse(raw, ['Carrot'], opts);
        assert.deepEqual(forRows.invalid, [{ label: 'Carrot', value: 'action_or_state' }]);
        assert.equal(forRows.rawAssignments.Carrot, undefined);

        const forIcons = parseClassificationResponse(raw, ['Carrot'], {
            ...opts,
            includeIconCategories: true,
        });
        assert.deepEqual(forIcons.invalid, []);
        assert.equal(forIcons.rawAssignments.Carrot, 'Carrot');
    });

    it('records a raw name for a label that collides with an Object prototype key', () => {
        // Written out rather than JSON.stringify'd: `__proto__:` in an object
        // literal sets the prototype instead of creating an own key.
        const raw = '{"__proto__":{"category":"herbs_spices","raw":"Salt"},'
            + '"constructor":{"category":"aromatics","raw":"Onion"}}';
        const result = parseClassificationResponse(raw, ['__proto__', 'constructor'], opts);
        assert.deepEqual(result.missing, []);
        assert.equal(result.rawAssignments['__proto__'], 'Salt');
        assert.equal(result.rawAssignments['constructor'], 'Onion');
        assert.deepEqual(Object.keys(plain(result.rawAssignments)).sort(), ['__proto__', 'constructor']);
    });

    it('rejects a raw name broken by a Unicode line separator', () => {
        // U+2028 and U+2029 survive String.prototype.trim and travel through
        // JSON intact, so a "single line" check that only looks for \r and \n
        // lets a two-line row label through while looking like one line in a
        // log. Asserted by code point rather than pasted in, since the
        // characters are invisible in a source file.
        for (const sep of ['\u2028', '\u2029']) {
            const response = JSON.stringify({
                Carrot: { category: 'vegetables', raw: `Carrot${sep}Chopped` },
            });
            const result = parseClassificationResponse(response, ['Carrot'], opts);
            assert.equal(result.assignments.Carrot, 'vegetables', 'the category still stands');
            assert.equal(
                result.rawAssignments.Carrot,
                undefined,
                `U+${sep.codePointAt(0)!.toString(16).toUpperCase()} must not survive as a raw name`,
            );
        }
    });

    // The prompt and the parser have to agree on the two field names. If they
    // ever stop agreeing the parser finds no `raw` on any entry, every label
    // falls back to identity, and nothing fails loudly — the merge feature just
    // quietly stops merging. So drive the fixture off the prompt's own wording
    // rather than off a hand-typed key.
    it('round-trips the wire field names the prompt asks for', () => {
        const prompt = buildClassificationPrompt(['Carrot, Chopped'], opts);

        const contract = prompt
            .split('\n')
            .find(l => l.startsWith('{"<label>": {'));
        assert.ok(contract, 'the raw prompt must state an object output contract');

        // Pull the field names straight out of the contract line the model
        // reads, then answer using exactly those.
        const fields = [...contract.matchAll(/"([a-z_]+)":\s*"</g)].map(m => m[1]);
        assert.deepEqual(fields, ['category', 'raw'], 'the contract must name both fields');

        const [categoryField, rawField] = fields;
        const response = JSON.stringify({
            'Carrot, Chopped': { [categoryField]: 'vegetables', [rawField]: 'Carrot' },
        });
        const result = parseClassificationResponse(response, ['Carrot, Chopped'], opts);

        assert.equal(result.assignments['Carrot, Chopped'], 'vegetables');
        assert.equal(
            result.rawAssignments['Carrot, Chopped'],
            'Carrot',
            'the parser must read back the very field names the prompt asked for',
        );
    });

    it('logs the whole entry when an object carries no usable category string', () => {
        // An empty or whitespace-only category tells the operator nothing, and
        // printing it leaves a blank in the log line where the clue should be.
        for (const category of ['', '   ']) {
            const response = JSON.stringify({ Carrot: { category, raw: 'Carrot' } });
            const result = parseClassificationResponse(response, ['Carrot'], opts);
            assert.deepEqual(result.invalid, [
                { label: 'Carrot', value: JSON.stringify({ category, raw: 'Carrot' }) },
            ]);
            assert.deepEqual(result.missing, ['Carrot']);
        }
    });

    it('stamps raw extraction into its own rules version, not the category one', () => {
        // Splitting the counters is what closes the rollout gap: a backfill
        // that runs before raw writing ships can no longer stamp "current"
        // onto a doc that has no rawIngredient.
        assert.ok(RAW_RULES_VERSION >= 1, 'raw rules carry a version of their own');
        assert.equal(
            TAXONOMY_RULES_VERSION,
            3,
            'and the category version is untouched by this change',
        );
    });
});
