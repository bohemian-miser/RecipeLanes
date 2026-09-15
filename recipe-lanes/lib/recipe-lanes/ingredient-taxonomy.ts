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
 * Colours are picked for separation on the app's zinc-900 surfaces rather than
 * for realism: twelve categories plus grey is at the top of what a categorical
 * palette can carry, so each one sits in its own hue band (and the two brown
 * bands, grains vs nuts, are separated by lightness). They are mid-to-light
 * tones because they are drawn ON dark backgrounds, as legend dots, UMAP rings
 * and group-header chips.
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
        rules: 'All vegetables not covered by aromatics. Mushrooms here. NOT potatoes (see grains_starches).',
    },
    {
        id: 'fruits',
        label: 'Fruits',
        color: '#fb923c',
        rules: 'Fresh/dried fruit, citrus zest, whole citrus. Citrus JUICE goes to condiments_liquids.',
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
        rules: 'Milk, cream, cheese, yogurt, sour cream — and eggs (merged per survey recommendation).',
    },
    {
        id: 'grains_starches',
        label: 'Grains & Starches',
        color: '#d6b48a',
        rules: 'Flour, rice, pasta, noodles, bread/breadcrumbs, oats, corn products — and potatoes (culinary starch role).',
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
        rules: 'Soy/fish/hot sauces, mustard, vinegar, stock/broth, water, wine/beer/spirits, juices, coconut milk.',
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
        rules: 'Cooking actions, processes, equipment states and other non-ingredient subjects ("Oven Preheating", "Whisking", "Simmering Pot"). Icon names only — an ingredient label is never this category.',
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

/** Every id the classifier may return when icon categories are enabled. */
export const ALL_CLASSIFICATION_IDS: readonly ClassificationCategoryId[] = [
    ...COMPARISON_CATEGORY_IDS,
    ...ICON_ONLY_TABLE.map(c => c.id),
];

/** The fallback category every unclassified label falls back to. */
export const FALLBACK_CATEGORY_ID: IngredientCategoryId = 'other';

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

// ---------------------------------------------------------------------------
// Classification prompt + response parsing (pure; the transport lives elsewhere)
// ---------------------------------------------------------------------------

/** Shared by the prompt builder and the parser so the two cannot disagree. */
export interface ClassificationOptions {
    /** Include `action_or_state` — for the `icon_index` corpus only. */
    includeIconCategories?: boolean;
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

    return `You are classifying recipe ingredient labels into a fixed culinary taxonomy.

CATEGORIES (use the id exactly as written; these boundary rules are authoritative and override your own intuition):
${categoryBlock}

LANGUAGE:
The labels come from recipes in many languages — Polish, Lithuanian, Bulgarian, German, French, Spanish, Danish, Indonesian and Chinese all occur alongside English. Classify by MEANING, translating internally as needed. A label being non-English is never a reason to call it "${FALLBACK_CATEGORY_ID}"; use "${FALLBACK_CATEGORY_ID}" only when the label is genuinely unclassifiable in any language.

LABELS TO CLASSIFY (${unique.length}):
${labelBlock}

OUTPUT:
Return a single raw JSON object mapping every label above to exactly one category id, using each label as the key exactly as it appears above:
{"<label>": "<category_id>"}
Rules for the output:
- Include every label — the object must have exactly ${unique.length} keys.
- Values must be one of: ${categories.map(c => c.id).join(', ')}.
- No markdown code fences, no commentary, no trailing text. Output the JSON object and nothing else.`;
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
    /** Distinct input labels the response did not usably classify. */
    missing: string[];
    /** Entries whose category is not in this taxonomy (also counted in `missing`). */
    invalid: ClassificationRejection[];
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

            const category = typeof value === 'string' ? value.trim().toLowerCase() : '';
            if (category && allowed.has(category)) {
                assignments[label] = category;
            } else {
                invalid.push({ label, value: typeof value === 'string' ? value : JSON.stringify(value) });
            }
        }
    }

    return {
        assignments,
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
