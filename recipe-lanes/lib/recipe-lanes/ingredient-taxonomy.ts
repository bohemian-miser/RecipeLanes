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

/**
 * Ingredient taxonomy — intended to be the single source of truth for
 * ingredient categories.
 *
 * Pure, framework-free: no React, no Firebase, no I/O, so that once the rest of
 * the chain lands it can be shared by the app, by server actions and by
 * `scripts/*` alike. Nothing imports it yet.
 *
 * `INGREDIENT_CATEGORIES` carries four things per category, and every future
 * consumer is meant to read them from here rather than restating them:
 *  - `id`      the value stored on Firestore docs and compared in code,
 *  - `label`   the display name (group headers, legends),
 *  - `color`   the hex for both the UMAP legend and the group header chips,
 *  - `rules`   the boundary definition, embedded VERBATIM in the classifier
 *              prompt so the classifier and the code cannot drift apart.
 *
 * Array order is display / grouping order, with `other` last as the fallback.
 */

/**
 * Structural shape of one category entry. Private: it exists so the literal
 * tables below can be `satisfies`-checked without widening their id literals.
 */
interface CategoryDefinition {
    id: string;
    label: string;
    color: string;
    rules: string;
}

/**
 * The comparison-side category table, in display order.
 *
 * `as const satisfies` is load-bearing. `satisfies` type-checks every entry
 * against `CategoryDefinition`, while `as const` keeps each `id` a literal
 * type — which lets `IngredientCategoryId` be DERIVED from this array below
 * instead of being a hand-maintained union that can silently drift out of sync
 * with it. Adding a category here adds it to the type, the guards and the
 * prompt in one edit.
 *
 * Colours are picked for separation on the app's dark zinc surfaces rather than
 * for realism: twelve categories plus grey is at the top of what a categorical
 * palette can carry, so each one sits in its own hue band (and the two brown
 * bands, grains vs nuts, are separated by lightness). They are mid-to-light
 * tones, which is a CONSTRAINT ON CONSUMERS, not a description of them: these
 * hexes only separate against a dark ground. A light surface washes the lighter
 * bands (vegetables, grains, dairy) out into each other — the UMAP view was
 * built white and had exactly that problem, and was moved to a dark canvas
 * rather than have the palette bent to fit it. Anything new that renders these
 * — legend dots, UMAP rings, group-header chips — needs a dark backdrop too.
 *
 * Some `rules` clauses exist because the classifier proved UNSTABLE without
 * them. Diffing two temperature-0 dry runs of the label backfill showed 97.3%
 * identical assignments, and the churn was concentrated on exactly the labels
 * no rule covered: leaveners flipping other <-> herbs_spices, tomato paste
 * flipping condiments_liquids <-> vegetables, "Whites" flipping dairy_eggs <->
 * other. A label the rules do not reach is a coin toss, so the fix is to name
 * the boundary rather than to hope — see the leavener, paste and egg-part
 * clauses below.
 *
 * The vegetables/fruits clauses come from a different failure, seen in a 620
 * label staging run: the classifier was not unstable there, it was confidently
 * BOTANICAL. "Tomato (sliced)", "Cherry Tomatoes, Halved" and "Avocado,
 * Sliced" all went to `fruits`, while canned/crushed tomatoes went to
 * `vegetables` — so one ingredient split across two groups on preparation
 * alone. This taxonomy is for cooks reading a comparison table, not for
 * botanists, so `vegetables` claims these outright and `fruits` carries the
 * mirroring exclusion. Both sides are stated because the model has to be told
 * where the item goes AND that its other reading is wrong.
 *
 * Note how the vegetables clause and the condiments_liquids clause fit
 * together: vegetables claims tomato in "whole, cut, canned, or crushed"
 * forms and then hands concentrated tomato paste back to condiments_liquids,
 * which claims it. Enumerating the forms rather than saying "fresh or
 * otherwise" is what keeps those two rules from both claiming the same jar.
 *
 * The last unruled boundary was the one the icon corpus kept tripping over:
 * a plated composite dish has no single ingredient to be classified as, so
 * "Simple Duck Sandwich On A Plate" drifted between `proteins`, `other` and
 * `action_or_state` from run to run. The owner settled it on 2026-09-17 —
 * a plated or assembled dish is a RESULT of cooking, so it belongs with the
 * other process states — and the clause lives on `action_or_state` in
 * ICON_ONLY_TABLE below. Every boundary call in this file is now owner-
 * confirmed rather than a standing recommendation.
 */
const CATEGORY_TABLE = [
    {
        id: 'proteins',
        label: 'Meat & Proteins',
        color: '#ef4444',
        rules: 'Meat, poultry, fish, seafood, tofu/tempeh/seitan; dried or canned beans, lentils, chickpeas (legumes eaten as the protein of a dish).',
    },
    {
        id: 'aromatics',
        label: 'Aromatics',
        color: '#c084fc',
        rules: "Onion, garlic, ginger, shallot, leek, scallion/spring onion, lemongrass, fresh chilies. (Owner's explicit example group.)",
    },
    {
        id: 'vegetables',
        label: 'Vegetables',
        color: '#4ade80',
        rules: 'All vegetables not covered by aromatics. Mushrooms here. NOT potatoes (see grains_starches); culinary vegetables that are botanically fruit (tomato, avocado, cucumber, capsicum/bell pepper, zucchini, eggplant) belong here in whole, cut, canned, or crushed forms — but concentrated tomato paste belongs in condiments_liquids.',
    },
    {
        id: 'fruits',
        label: 'Fruits',
        color: '#fb923c',
        rules: 'Fresh/dried fruit, citrus zest, whole citrus. Citrus JUICE goes to condiments_liquids; NOT culinary vegetables like tomato/avocado/cucumber (see vegetables).',
    },
    {
        id: 'herbs_spices',
        label: 'Herbs & Spices',
        color: '#a3e635',
        rules: 'Fresh and dried herbs, all spices, salt, pepper, spice blends, extracts (vanilla), MSG. Owner said "herbs and spices together" — one combined category, and salt lives here (recommendation from the two taxonomy surveys; salt rows are already prominent in the table regardless).',
    },
    {
        id: 'fats_oils',
        label: 'Fats & Oils',
        color: '#facc15',
        rules: 'Oils, butter, ghee, lard, shortening, margarine.',
    },
    {
        id: 'dairy_eggs',
        label: 'Dairy & Eggs',
        color: '#93c5fd',
        rules: 'Milk, cream, cheese, yogurt, sour cream — and eggs (merged per survey recommendation); egg parts (whites, yolks).',
    },
    {
        id: 'grains_starches',
        label: 'Grains & Starches',
        color: '#d6b48a',
        rules: 'Flour, rice, pasta, noodles, bread/breadcrumbs, oats, corn products — and potatoes (culinary starch role); raising agents and leaveners (baking powder, baking soda/bicarbonate, yeast — including nutritional yeast).',
    },
    {
        id: 'nuts_seeds',
        label: 'Nuts & Seeds',
        color: '#a3703f',
        rules: 'Nuts, seeds, nut butters.',
    },
    {
        id: 'sweeteners',
        label: 'Sweeteners',
        color: '#f472b6',
        rules: 'Sugar(s), honey, syrups, molasses, jaggery; chocolate/cocoa.',
    },
    {
        id: 'condiments_liquids',
        label: 'Sauces, Condiments & Liquids',
        color: '#2dd4bf',
        rules: 'Soy/fish/hot sauces, mustard, vinegar, stock/broth, water, wine/beer/spirits, juices, coconut milk; concentrated pastes (tomato paste, curry paste, miso, tahini).',
    },
    {
        id: 'other',
        label: 'Other',
        color: '#71717a',
        rules: 'Fallback ONLY for genuinely unclassifiable labels ("dish", "white", garbled fragments). Non-English labels are NEVER dumped here — classify by meaning (survey nn-preliminary showed 33% of labels, mostly non-English, fell to \'other\' under embedding-NN; the multilingual LLM must fix exactly this).',
    },
] as const satisfies readonly CategoryDefinition[];

/**
 * Categories that exist only for `icon_index` documents, whose "names" are
 * visual descriptions of an icon rather than ingredient labels. Kept out of
 * `CATEGORY_TABLE` so the comparison-side enum stays closed and no comparison
 * row can ever be assigned one of these.
 */
const ICON_ONLY_TABLE = [
    {
        id: 'action_or_state',
        label: 'Actions & States',
        color: '#a1a1aa',
        rules: 'Cooking actions, processes, equipment states and other non-ingredient subjects ("Oven Preheating", "Whisking", "Simmering Pot"); plated, assembled, or served composite dishes ("Simple Duck Sandwich On A Plate", "Assembled Burger", "Finished Korma Garnished With Coriander") are process RESULTS, not ingredients — they belong here rather than in the category of whichever ingredient dominates them. Icon names only — an ingredient label is never this category.',
    },
] as const satisfies readonly CategoryDefinition[];

/** The closed comparison-side enum, derived from `CATEGORY_TABLE`. */
export type IngredientCategoryId = (typeof CATEGORY_TABLE)[number]['id'];

/** The extra id used only on `icon_index` docs — never on comparison rows. */
export type IconOnlyCategoryId = (typeof ICON_ONLY_TABLE)[number]['id'];

/** Any id the classifier may return, depending on the corpus being classified. */
export type ClassificationCategoryId = IngredientCategoryId | IconOnlyCategoryId;

export interface IngredientCategory {
    id: IngredientCategoryId;
    /** Display name. */
    label: string;
    /** Hex, shared by the UMAP legend and the group header chips. */
    color: string;
    /** Boundary definitions — embedded verbatim in the LLM prompt. */
    rules: string;
}

/** Same shape as `IngredientCategory`, but for the icon-only id. */
export interface IconOnlyCategory extends Omit<IngredientCategory, 'id'> {
    id: IconOnlyCategoryId;
}

/** Either kind of category, for code that renders both (e.g. the UMAP legend). */
export type ClassificationCategory = IngredientCategory | IconOnlyCategory;

/** The twelve comparison-side categories, in display order. */
export const INGREDIENT_CATEGORIES: readonly IngredientCategory[] = CATEGORY_TABLE;

/** The icon-only categories, kept separate so the enum above stays closed. */
export const ICON_ONLY_CATEGORIES: readonly IconOnlyCategory[] = ICON_ONLY_TABLE;

/** Just the comparison-side ids, in display order. */
export const COMPARISON_CATEGORY_IDS: readonly IngredientCategoryId[] =
    CATEGORY_TABLE.map(c => c.id);

/**
 * Every category the classifier may return when icon categories are enabled,
 * in display order: the twelve comparison categories then the icon-only ones.
 *
 * Exported because every consumer that renders "all of them" was otherwise
 * writing this concat itself — and a page-local copy is exactly how a new
 * icon-only category gets forgotten in one place and not another.
 */
export const ALL_CLASSIFICATION_CATEGORIES: readonly ClassificationCategory[] = [
    ...CATEGORY_TABLE,
    ...ICON_ONLY_TABLE,
];

/** Every id the classifier may return when icon categories are enabled. */
export const ALL_CLASSIFICATION_IDS: readonly ClassificationCategoryId[] = [
    ...COMPARISON_CATEGORY_IDS,
    ...ICON_ONLY_TABLE.map(c => c.id),
];

/** The fallback category every unclassified label falls back to. */
export const FALLBACK_CATEGORY_ID: IngredientCategoryId = 'other';

/**
 * Bumped whenever ANY `rules` string changes in a way that could move labels
 * between categories.
 *
 * Classification docs stamp the version they were produced under, so a backfill
 * can tell a doc that is merely old from one that was classified against
 * boundaries this file no longer states, and reclassify only the latter. Without
 * it, a rules edit either silently leaves stale assignments in place forever or
 * forces a blanket `--force` pass over the whole corpus.
 *
 * Scoped to CATEGORY semantics only. Raw-ingredient extraction carries its own
 * `RAW_RULES_VERSION` — see the note there for why the two are not one number.
 *
 * Version 1 is the pre-existing rules text; 2 adds the leavener, paste,
 * egg-part and culinary-vegetable boundaries; 3 sends plated composite dishes
 * to `action_or_state`. Cosmetic rewording that cannot change an assignment
 * does not need a bump — but when in doubt, bump: a needless reclassification
 * costs pennies, a missed one is invisible.
 */
export const TAXONOMY_RULES_VERSION = 3;

/**
 * Bumped whenever `RAW_INGREDIENT_RULES` changes in a way that could move a
 * label to a different raw ingredient. Stamped by raw-consuming backfills as
 * `rawRulesVersion`, beside the `categoryRulesVersion` stamp.
 *
 * A SEPARATE counter from `TAXONOMY_RULES_VERSION`, not the single shared one
 * the plan first called for, because the two enrichments have genuinely
 * independent lifecycles and folding them together is wrong in both directions:
 *
 *  - Raw rules do not affect category semantics, so tightening a merge boundary
 *    would otherwise force every `icon_index` doc to be reclassified — an
 *    entire corpus that has no raw ingredient and never will.
 *  - Worse, a shared counter opens a rollout gap. Any backfill that runs after
 *    the rules land but before the raw-writing pass ships stamps the new
 *    version onto docs that carry NO `rawIngredient`, and those docs then read
 *    as current forever. Splitting the counters closes it.
 *
 * Staleness for raw is therefore two conditions, not one: a `rawRulesVersion`
 * behind this constant, OR no `rawIngredient` field at all. The second half is
 * what makes a missed doc self-healing rather than permanently invisible.
 *
 * The stamping and the staleness query live in the backfill script (the next PR
 * in this chain); nothing writes this yet.
 */
export const RAW_RULES_VERSION = 1;

const CATEGORY_BY_ID: ReadonlyMap<string, IngredientCategory> = new Map(
    INGREDIENT_CATEGORIES.map(c => [c.id, c]),
);

const RANK_BY_ID: ReadonlyMap<string, number> = new Map(
    INGREDIENT_CATEGORIES.map((c, index) => [c.id, index]),
);

/**
 * The rank every unrecognised id sorts at. Normally the index of `other`, which
 * is last. The `??` is not dead code: if `other` were ever renamed or reordered
 * this still yields a real rank past the end of the list, so `categoryRank`
 * cannot return -1 and quietly sort unknowns to the TOP of the table.
 */
const FALLBACK_RANK: number = RANK_BY_ID.get(FALLBACK_CATEGORY_ID) ?? INGREDIENT_CATEGORIES.length;

/**
 * Sort key for grouping: the category's index in `INGREDIENT_CATEGORIES`.
 *
 * Anything unrecognised — undefined (no lookup doc yet), a stale id from an
 * older taxonomy, or an icon-only id that leaked onto a row — ranks with
 * `other`, so grouping degrades to "shows up in Other" instead of throwing.
 */
export function categoryRank(id: string | undefined): number {
    if (id === undefined) return FALLBACK_RANK;
    return RANK_BY_ID.get(id) ?? FALLBACK_RANK;
}

/** Type guard: is `v` one of the twelve comparison-side category ids? */
export function isIngredientCategoryId(v: unknown): v is IngredientCategoryId {
    return typeof v === 'string' && RANK_BY_ID.has(v);
}

/** Looks up a category by id; undefined for unknown ids. */
export function getIngredientCategory(id: string | undefined): IngredientCategory | undefined {
    return id === undefined ? undefined : CATEGORY_BY_ID.get(id);
}

const CLASSIFICATION_CATEGORY_BY_ID: ReadonlyMap<string, ClassificationCategory> = new Map(
    ALL_CLASSIFICATION_CATEGORIES.map(c => [c.id, c]),
);

/**
 * Looks up ANY category the classifier can produce — the twelve comparison ones
 * and the icon-only ones — by an id that is just a string as far as the caller
 * knows, because it came out of Firestore.
 *
 * Returns undefined for an unknown id, an empty string, or undefined, and those
 * three cases are deliberately not distinguished: to a renderer they are all
 * "this point has no category I can name", which is what
 * `UNCLASSIFIED_PRESENTATION` is for. Use this rather than chaining
 * `getIngredientCategory` with a second icon-only lookup.
 */
export function getClassificationCategory(
    id: string | undefined,
): ClassificationCategory | undefined {
    return id ? CLASSIFICATION_CATEGORY_BY_ID.get(id) : undefined;
}

/**
 * How to render something that has NO category — not classified yet, or
 * carrying an id this taxonomy no longer knows.
 *
 * This is deliberately not a category: nothing is ever assigned it, it is never
 * offered to the classifier, and it must not appear in a legend as a peer of
 * the real ones. It exists so that every consumer draws "absent" the same way
 * instead of inventing its own grey.
 *
 * The colour is distinct from EVERY category colour — including `other`'s
 * #71717a and `action_or_state`'s #a1a1aa, the two it would otherwise be
 * confused with. That distinction carries real meaning: `other` is a decision
 * the classifier made ("genuinely unclassifiable"), while this is the absence
 * of a decision, and a reviewer looking at a map of grey dots needs to know
 * which of those they are looking at. Consumers are expected to reinforce it
 * with a non-colour cue too (the UMAP view dashes the ring).
 */
export const UNCLASSIFIED_PRESENTATION: { label: string; color: string } = {
    label: 'Unclassified',
    color: '#52525b',
};

// ---------------------------------------------------------------------------
// Classification prompt + response parsing (pure; the transport lives elsewhere)
// ---------------------------------------------------------------------------

/**
 * The merge boundary for raw-ingredient extraction, embedded VERBATIM in the
 * prompt when `includeRaw` is set — the same contract `rules` has above: the
 * prose here IS the specification, so the classifier and the code cannot drift.
 *
 * The problem it solves: comparison rows key on the label, so "Carrot" and
 * "Carrot, Chopped" split into two rows that never add up. The raw ingredient
 * is the shared pantry item both lines came from, and rows keyed on it merge.
 *
 * Why the litmus is stated before any list: the lists can only ever be
 * examples, and the model will meet labels no example covers. "Produced in the
 * kitchen" vs "exists at purchase" is the test that generalises — everything
 * below it is that test worked out for the cases we have actually seen.
 *
 * Why it leans conservative: the two failure directions are NOT symmetric.
 * Under-merging leaves two rows where one would read better — cosmetic, and
 * visibly so. Over-merging silently adds unrelated quantities together (a
 * teaspoon of tomato paste folded into 400g of tinned tomatoes) and the
 * resulting number looks perfectly reasonable. So identity — raw = label — is
 * the documented safe answer whenever the boundary is unclear, and the KEEP
 * DISTINCT list is deliberately the longer of the two.
 *
 * Two clarifications the rules state explicitly because leaving them implicit
 * produced real contradictions:
 *
 *  - IDENTITY IS NOT VERBATIM. "Never guess" governs product identity; it does
 *    not license skipping normalization. An unsure label still gets made
 *    singular and stripped of quantities, so "Whole Peeled Tomatoes" falls back
 *    to "Whole Peeled Tomato" — never to "tomato", and never to the label as
 *    typed. Without this the litmus's "singular" mandate and its "keep the
 *    label" fallback pull in opposite directions.
 *
 *  - CRUSHED IS TWO DIFFERENT WORDS. Crushing a garlic clove is prep; "Crushed
 *    Tomatoes" is a tin off a shelf, and the label usually omits "canned". A
 *    blanket "crushed is prep" rule merges that tin into fresh tomato, which is
 *    precisely the worst-case over-merge this spec exists to prevent — so the
 *    processed-tomato products are named on the KEEP DISTINCT side.
 *
 *  - RESIDUE IS NOT AN INGREDIENT. The corpus contains parser debris — bare
 *    colours, dangling fragments, equipment — and the rules say outright that
 *    such a label is its own raw ingredient. This one is evidence-driven: the
 *    backfill's cross-category collision report on a prod dry-run flagged four
 *    merges, and the one genuine error was "Whites" (dairy_eggs) pulled in with
 *    "White" (other). Neither is a food; merging them fabricates an ingredient
 *    no recipe contains, and the shape of the mistake — debris resembling a
 *    real ingredient closely enough to attract it — generalises well past that
 *    one pair, so it is stated as a rule rather than patched per label.
 */
export const RAW_INGREDIENT_RULES = `The raw ingredient is the label's pre-processed pantry form: the item as a shopper would buy it, before this recipe's own prep. Strip a qualifier only when the difference is PRODUCED IN THE KITCHEN by prep; keep it when the difference EXISTS AT PURCHASE as a different shelf product. When unsure, keep the label as its own raw ingredient — never guess a merge. Return the raw name in the SAME LANGUAGE as the label, singular, no quantities, no prep words.

PRECEDENCE: "never guess" governs PRODUCT IDENTITY only. Grammatical normalization ALWAYS applies, including to a label you are unsure about — make it singular, drop quantities and counts, and drop only unambiguously pure-prep words. So an unsure "Whole Peeled Tomatoes" becomes "Whole Peeled Tomato": the same product, normalized. Never "tomato", and never the label copied out verbatim. The raw name is always singular even when it reads awkwardly ("pea", "oat", "breadcrumb") — it is a merge key first, display text second.

MERGE (prep, not product): cut/size prep (chopped, diced, sliced, minced, grated, shredded, julienned, cubed, halved, quartered, torn, cut into X); kitchen state (melted, softened, room-temperature, chilled, cold, warm, beaten, whisked, sifted, peeled, seeded, cored, stemmed, trimmed, rinsed, drained, thawed); crushing a whole item in the kitchen (crushed garlic clove → garlic clove, crushed ice → ice); cooked-in-recipe states (cooked rice → rice, toasted nuts → nut, hard-boiled egg → egg); "fresh" as qualifier (fresh basil → basil); fresh vs frozen same item (frozen peas → pea); size adjectives (large egg → egg); plural → singular.

KEEP DISTINCT (different purchasable products): dried vs fresh (dried oregano, sun-dried tomato, dried mushrooms); smoked/cured/preserved (smoked paprika, smoked salmon); processed tomato products (crushed tomatoes, whole peeled tomatoes, diced tomatoes in the canned-product sense, canned/tinned tomatoes) ≠ fresh tomato — these are shelf products EVEN WHEN the label omits "canned" or "tinned", so "Crushed Tomatoes" becomes "Crushed Tomato" and never "tomato"; concentrates/derivatives (tomato paste, passata, ketchup, lemon juice, lemon zest, coconut milk/cream — never the parent); ground vs whole spice (ground cumin ≠ cumin seeds); butchery/part-of-animal (ground beef ≠ beef; chicken breast ≠ thigh ≠ whole; egg yolk ≠ egg white ≠ egg); product-spec qualifiers (unsalted butter ≠ butter; extra-virgin olive oil ≠ olive oil; whole milk ≠ milk); named varieties (red onion, cherry tomato, basmati rice, all-purpose flour ≠ bread flour); sugars/flours/salts by type (powdered/granulated/brown sugar distinct; sea salt ≠ salt).

NOT-A-FOOD residue: some labels are parser debris rather than ingredients — bare colours or adjectives ("White", "Whites", "Green"), bare fragments ("Leaves", "Of Lamb", "(halved)", "(finely chopped)"), or equipment ("Cheesecloth", "Sharp Knife"). For any label that is not recognisably a food or drink item, the raw ingredient is the label itself, normalized — never merge it with another label, and never merge it with a real ingredient it happens to resemble ("Whites" is NOT "egg white", "Leaves" is NOT "bay leaf"). Residue labels are individually harmless; merging them invents ingredients that no recipe contains.

Over-merging is silent data corruption; under-merging is cosmetic. Identity (raw = label, normalized) is always safe.`;

/**
 * Cap on an accepted raw ingredient name, in characters after trimming.
 *
 * A pantry item's name is a few words; anything longer is the model having
 * written a sentence, an explanation or a whole ingredient line into the field,
 * and that value would become a comparison row label.
 *
 * Interpolated into the prompt rather than restated there, so "the bound the
 * model is told is the bound the parser enforces" is true by construction
 * instead of being a comment somebody has to remember to update.
 */
const MAX_RAW_INGREDIENT_LENGTH = 80;

/**
 * The wire field names of the `includeRaw` response object.
 *
 * Shared by the prompt (which tells the model to emit them) and the parser
 * (which reads them back) for the usual reason everything else in this file is
 * shared: renaming one side alone is a silent failure, not a loud one. The
 * parser would simply find no `raw` on any entry, `rawAssignments` would come
 * back empty, and every label would fall back to identity — a merge feature
 * that quietly stops merging while every test about categories still passes.
 */
const RAW_WIRE = {
    category: 'category',
    raw: 'raw',
} as const;

/**
 * The two output rules that are identical in both prompt variants. Extracted
 * so the shapes cannot drift apart in the half that does not change — the
 * fence instruction in particular is load-bearing for every response.
 */
const noFencesRule =
    '- No markdown code fences, no commentary, no trailing text. Output the JSON object and nothing else.';

const everyLabelRule = (count: number): string =>
    `- Include every label — the object must have exactly ${count} keys.`;

/** Shared by the prompt builder and the parser so the two cannot disagree. */
export interface ClassificationOptions {
    /** Include `action_or_state` — for the `icon_index` corpus only. */
    includeIconCategories?: boolean;
    /**
     * Also extract a raw ingredient name per label (see `RAW_INGREDIENT_RULES`),
     * which switches the response contract from `label -> id` to
     * `label -> {category, raw}`.
     *
     * Defaults to false, and false must stay BYTE-IDENTICAL to the prompt that
     * existed before raw extraction: the icon backfill and the classify-on-miss
     * path share this builder and have no use for a raw name, so they must not
     * pay for one in tokens or in output-shape risk.
     */
    includeRaw?: boolean;
}

const COMPARISON_ID_SET: ReadonlySet<string> = new Set<string>(COMPARISON_CATEGORY_IDS);
const ALL_ID_SET: ReadonlySet<string> = new Set<string>(ALL_CLASSIFICATION_IDS);

/** The categories one set of options puts in play, in prompt order. */
function categoriesFor(opts: ClassificationOptions): readonly ClassificationCategory[] {
    return opts.includeIconCategories
        ? [...INGREDIENT_CATEGORIES, ...ICON_ONLY_CATEGORIES]
        : INGREDIENT_CATEGORIES;
}

/** The ids one set of options accepts. Derived, so it always matches the prompt. */
function allowedIdsFor(opts: ClassificationOptions): ReadonlySet<string> {
    return opts.includeIconCategories ? ALL_ID_SET : COMPARISON_ID_SET;
}

/** Distinct labels in first-seen order (a batch may repeat a label). */
function distinctLabels(labels: readonly string[]): string[] {
    return [...new Set(labels)];
}

/**
 * Builds the classification prompt for one batch of labels.
 *
 * Both intended callers (the backfill scripts and the classify-on-miss path in
 * the comparison action) will use this one builder, so a taxonomy edit reaches
 * every classifier at once. Each category's `rules` string is embedded verbatim.
 *
 * Repeated labels are collapsed before prompting — asking a model to key the
 * same string twice cannot work in a JSON object anyway, and the "exactly N
 * keys" instruction has to count what the model can actually return.
 *
 * The output contract is a bare JSON object keyed by the exact input label —
 * no markdown fences, no prose. `parseClassificationResponse` tolerates fences
 * anyway, because models add them regardless of instructions.
 *
 * `includeRaw` adds a second field per label and switches the values from a
 * bare id to an object. Without it the prompt is byte-for-byte the one that
 * predates raw extraction, which is what lets the icon backfill and the
 * classify-on-miss path keep their existing behaviour untouched.
 */
export function buildClassificationPrompt(
    labels: string[],
    opts: ClassificationOptions = {},
): string {
    const categories = categoriesFor(opts);
    const unique = distinctLabels(labels);

    const categoryBlock = categories
        .map(c => `- ${c.id} (${c.label}): ${c.rules}`)
        .join('\n');

    // JSON.stringify the labels so quotes/newlines inside a label cannot break
    // the list, and so the model sees the exact key string it must echo back.
    const labelBlock = unique.map(l => JSON.stringify(l)).join('\n');

    const idList = categories.map(c => c.id).join(', ');

    // Sits between LANGUAGE and the label list so the rules are read before the
    // labels, and contributes NOTHING (not even a blank line) when unasked for.
    const rawSection = opts.includeRaw
        ? `\n\nRAW INGREDIENT:\nAlongside the category, return each label's raw ingredient — the pantry item that comparison rows for this label should be totalled under.\n${RAW_INGREDIENT_RULES}`
        : '';

    const outputBlock = opts.includeRaw
        ? `Return a single raw JSON object mapping every label above to an object carrying its category id and its raw ingredient, using each label as the key exactly as it appears above:
{"<label>": {"${RAW_WIRE.category}": "<category_id>", "${RAW_WIRE.raw}": "<raw_ingredient>"}}
Rules for the output:
${everyLabelRule(unique.length)}
- "${RAW_WIRE.category}" must be one of: ${idList}.
- "${RAW_WIRE.raw}" must be a non-empty single-line name of at most ${MAX_RAW_INGREDIENT_LENGTH} characters, in the same language as the label. When the boundary rules above do not clearly call for a merge, repeat the label itself, normalized.
${noFencesRule}`
        : `Return a single raw JSON object mapping every label above to exactly one category id, using each label as the key exactly as it appears above:
{"<label>": "<category_id>"}
Rules for the output:
${everyLabelRule(unique.length)}
- Values must be one of: ${idList}.
${noFencesRule}`;

    return `You are classifying recipe ingredient labels into a fixed culinary taxonomy.

CATEGORIES (use the id exactly as written; these boundary rules are authoritative and override your own intuition):
${categoryBlock}

LANGUAGE:
The labels come from recipes in many languages — Polish, Lithuanian, Bulgarian, German, French, Spanish, Danish, Indonesian and Chinese all occur alongside English. Classify by MEANING, translating internally as needed. A label being non-English is never a reason to call it "${FALLBACK_CATEGORY_ID}"; use "${FALLBACK_CATEGORY_ID}" only when the label is genuinely unclassifiable in any language.${rawSection}

LABELS TO CLASSIFY (${unique.length}):
${labelBlock}

OUTPUT:
${outputBlock}`;
}

/** One response entry rejected because its category is not in this taxonomy. */
export interface ClassificationRejection {
    label: string;
    /** The category value the model returned, as a string, for the log line. */
    value: string;
}

export interface ClassificationResult {
    /**
     * label → category id, only for labels the model classified acceptably.
     *
     * A NULL-PROTOTYPE object: labels come from recipe text, so one of them can
     * legitimately be `__proto__` or `constructor`, and on a plain `{}` those
     * assignments either no-op or corrupt the object. Read it with bracket
     * access / `Object.entries`, not with `in` against `Object.prototype`.
     */
    assignments: Record<string, string>;
    /**
     * label → raw ingredient name, for the subset of `assignments` where the
     * model returned a usable one. Null-prototype, for the same reason.
     *
     * A PARALLEL record rather than a richer `assignments` value, deliberately:
     * every existing caller reads `assignments` as `Record<string, string>`,
     * and widening that value to an object would break all of them at once for
     * a field only the raw backfill wants. Sparse by design — absence is the
     * normal case (no `includeRaw`, or a raw that failed validation) and means
     * "treat the label as its own raw ingredient", never "unknown".
     */
    rawAssignments: Record<string, string>;
    /** Distinct input labels the response did not usably classify. */
    missing: string[];
    /** Entries whose category is not in this taxonomy (also counted in `missing`). */
    invalid: ClassificationRejection[];
}

/**
 * Every character that makes a value more than one line. CR and LF are the
 * obvious two; U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR are the
 * ones that get through — `String.prototype.trim` strips them, JSON carries
 * them literally, and they break a line in most renderers while looking like
 * nothing at all in a log.
 */
const LINE_BREAK_CHARS = /[\r\n\u2028\u2029]/;

/**
 * Validates one raw ingredient value: a non-empty, single-line string of at
 * most `MAX_RAW_INGREDIENT_LENGTH` characters once trimmed. Anything else —
 * absent, wrong type, empty, multi-line, oversized — yields undefined, and the
 * label simply keeps no raw name.
 *
 * Dropping the field rather than the whole entry is the point: a bad category
 * makes the answer unusable, but a bad raw only costs the merge. The label
 * still gets its category, and callers fall back to identity (raw = label),
 * which is the conservative outcome `RAW_INGREDIENT_RULES` already documents.
 */
function validRawIngredient(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_RAW_INGREDIENT_LENGTH) return undefined;
    // Single-line AFTER trimming, so trailing newlines the model padded the
    // value with are forgiven while an actual two-line answer is not.
    if (LINE_BREAK_CHARS.test(trimmed)) return undefined;
    return trimmed;
}

/**
 * Splits one response value into its category and raw parts, accepting both
 * shapes in both modes: `"aromatics"` (the pre-raw contract) and
 * `{"category": "aromatics", "raw": "Onion"}`.
 *
 * Both are accepted regardless of `includeRaw` because the option controls what
 * we ASK for, not what arrives: a model told to return objects still sometimes
 * returns bare strings, and being strict about it would throw away a perfectly
 * good category over a missing merge hint.
 */
function splitEntry(value: unknown): { category: unknown; raw: unknown } {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const entry = value as Record<string, unknown>;
        // Keyed off the same constants the prompt asks for, so a rename moves
        // both sides at once instead of silently emptying `rawAssignments`.
        return { category: entry[RAW_WIRE.category], raw: entry[RAW_WIRE.raw] };
    }
    return { category: value, raw: undefined };
}

/**
 * Parses a classification response against the labels that were asked about.
 *
 * Takes the SAME options object as `buildClassificationPrompt` and derives the
 * accepted id set from the constants, rather than trusting a hand-assembled set
 * from the caller: the prompt and the validation are then guaranteed to agree
 * about whether `action_or_state` is in play.
 *
 * Never throws: a fenced, truncated or entirely non-JSON response comes back as
 * "everything is missing", which is exactly what callers need in order to retry
 * the batch or fall back to `other`. Keys the caller did not ask about are
 * ignored, and category values are matched case-insensitively after trimming
 * (the ids in this file are all lowercase, so normalising the value is enough).
 *
 * Both response shapes are accepted whatever the options say — see
 * `splitEntry` — and the two fields are validated INDEPENDENTLY: an
 * unrecognised category invalidates the whole entry as it always has, while an
 * unusable raw name is merely dropped (see `validRawIngredient`).
 */
export function parseClassificationResponse(
    raw: string,
    labels: string[],
    opts: ClassificationOptions = {},
): ClassificationResult {
    const allowed = allowedIdsFor(opts);
    const unique = distinctLabels(labels);
    // Null prototype: a label may literally be "__proto__" (see the field doc).
    const assignments = Object.create(null) as Record<string, string>;
    const rawAssignments = Object.create(null) as Record<string, string>;
    const invalid: ClassificationRejection[] = [];
    const parsed = parseJsonObject(raw);

    if (parsed) {
        // Two indexes over the response's own enumerable keys. The exact index
        // wins, so a key that matches a label character-for-character is never
        // displaced by some other key that happens to trim to the same string;
        // within each index the FIRST occurrence wins, so a later duplicate
        // cannot clobber an earlier good answer.
        const byExactKey = new Map<string, unknown>();
        const byTrimmedKey = new Map<string, unknown>();
        for (const [key, value] of Object.entries(parsed)) {
            if (!byExactKey.has(key)) byExactKey.set(key, value);
            const trimmed = key.trim();
            if (!byTrimmedKey.has(trimmed)) byTrimmedKey.set(trimmed, value);
        }

        for (const label of unique) {
            const value = byExactKey.has(label)
                ? byExactKey.get(label)
                : byTrimmedKey.get(label.trim());
            if (value === undefined) continue;

            const entry = splitEntry(value);
            const category =
                typeof entry.category === 'string' ? entry.category.trim().toLowerCase() : '';
            if (category && allowed.has(category)) {
                assignments[label] = category;
                const raw = validRawIngredient(entry.raw);
                if (raw !== undefined) rawAssignments[label] = raw;
            } else {
                // Report the category value when it actually says something, so
                // an object-shaped entry logs `seasonings` rather than the
                // whole JSON blob. An absent, non-string, empty or
                // all-whitespace category says nothing, and logging it would
                // print an empty field where the operator needs a clue — so
                // those fall back to the blob, as the pre-raw code did for
                // every non-string.
                invalid.push({
                    label,
                    value:
                        typeof entry.category === 'string' && entry.category.trim()
                            ? entry.category
                            : JSON.stringify(value),
                });
            }
        }
    }

    return {
        assignments,
        rawAssignments,
        missing: unique.filter(l => assignments[l] === undefined),
        invalid,
    };
}

/** Cap on how many candidate braces (each side) the prose fallback will try. */
const MAX_BRACE_CANDIDATES = 50;

/** Cap on total slice attempts, so the start×end search cannot blow up. */
const MAX_BRACE_ATTEMPTS = 400;

/**
 * Best-effort extraction of a JSON object from a model response, in three
 * escalating attempts: the response as-is, then each fenced block, then a brace
 * slice out of surrounding prose. Returns null when nothing parses as an object.
 *
 * Each stage falls through on failure rather than committing to its first
 * candidate. That matters because the failure modes are real: models emit
 * "```JSON" as often as "```json", sometimes put a non-JSON fence (an example,
 * a restatement of the rules) before the answer, and sometimes wrap the object
 * in prose that itself contains a brace, which poisons a naive
 * first-`{`-to-last-`}` slice.
 *
 * NOTE: `parseRecipeGraph` in lib/recipe-lanes/parser.ts carries a sibling
 * implementation of this same fence/brace extraction. They are deliberately
 * left separate for now — unifying them changes existing parser behaviour and
 * belongs in its own PR — but a future refactor should collapse the two.
 */
function parseJsonObject(raw: string): Record<string, unknown> | null {
    const text = (raw ?? '').trim();
    if (!text) return null;

    // 1. The whole response — the happy path the prompt actually asks for.
    const direct = tryParseObject(text);
    if (direct) return direct;

    // 2. Every fenced block, in order. The tag is matched case-insensitively,
    //    and a fence whose body is not JSON does not disqualify the rest.
    for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
        const fenced = tryParseObject(match[1].trim());
        if (fenced) return fenced;
    }

    // 3. Unfenced object wrapped in prose. Both ends have to be searched, not
    //    just the start: a brace in a PREAMBLE ("use {one of} these ids")
    //    poisons a first-`{`-to-last-`}` slice, and so does a brace in a
    //    TRAILER ("...} — let me know if {anything} needs changing"), which an
    //    earlier version of this function could not recover from at all.
    //    So: try each opening brace against each closing brace, outermost
    //    first (earliest start, latest end), which finds the widest valid
    //    object rather than some nested fragment of it. Bounded on both axes
    //    and in total, because this runs on adversarial model output.
    const starts = bracePositions(text, '{', MAX_BRACE_CANDIDATES);
    const ends = bracePositions(text, '}', MAX_BRACE_CANDIDATES).reverse();

    let attempts = 0;
    for (const start of starts) {
        for (const end of ends) {
            if (end <= start) continue;
            if (++attempts > MAX_BRACE_ATTEMPTS) return null;
            const sliced = tryParseObject(text.slice(start, end + 1));
            if (sliced) return sliced;
        }
    }

    return null;
}

/**
 * Positions of up to `limit` occurrences of `brace`, in ascending order:
 * the FIRST `limit` for an opening brace, the LAST `limit` for a closing one.
 * Keeping the ends nearest the outside is what makes the bounded search above
 * still find the outermost object in a long, brace-heavy response.
 */
function bracePositions(text: string, brace: '{' | '}', limit: number): number[] {
    const found: number[] = [];
    if (brace === '{') {
        for (let i = text.indexOf(brace); i !== -1 && found.length < limit; i = text.indexOf(brace, i + 1)) {
            found.push(i);
        }
        return found;
    }
    for (let i = text.lastIndexOf(brace); i !== -1 && found.length < limit; i = text.lastIndexOf(brace, i - 1)) {
        found.push(i);
        if (i === 0) break;
    }
    return found.reverse();
}

/** JSON.parse restricted to plain objects; null for anything else. */
function tryParseObject(text: string): Record<string, unknown> | null {
    if (!text) return null;
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // Not JSON — the caller moves on to the next candidate.
    }
    return null;
}
