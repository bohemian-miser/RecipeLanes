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
 * Ingredient taxonomy — the single source of truth for ingredient categories.
 *
 * Pure, framework-free: no React, no Firebase, no I/O. It is imported by the
 * app, by server actions and by `scripts/*`, so it must stay dependency-free.
 *
 * `INGREDIENT_CATEGORIES` carries four things per category, and every consumer
 * reads them from here rather than restating them:
 *  - `id`      the value stored on Firestore docs and compared in code,
 *  - `label`   the display name (group headers, legends),
 *  - `color`   the hex used by both the UMAP legend and the group header chips,
 *  - `rules`   the boundary definition, embedded VERBATIM in the classifier
 *              prompt so the classifier and the code can never drift apart.
 *
 * Array order is display / grouping order, with `other` last as the fallback.
 */

export type IngredientCategoryId =
    | 'proteins' | 'aromatics' | 'vegetables' | 'fruits' | 'herbs_spices'
    | 'fats_oils' | 'dairy_eggs' | 'grains_starches' | 'nuts_seeds'
    | 'sweeteners' | 'condiments_liquids' | 'other';

/** The extra id used only on `icon_index` docs — never on comparison rows. */
export type IconOnlyCategoryId = 'action_or_state';

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

/**
 * The closed comparison-side enum, in display order.
 *
 * Colours are picked for separation on the app's zinc-900 surfaces rather than
 * for realism: twelve categories plus grey is at the top of what a categorical
 * palette can carry, so each one sits in its own hue band (and the two brown
 * bands, grains vs nuts, are separated by lightness). They are mid-to-light
 * tones because they are drawn ON dark backgrounds, as legend dots, UMAP rings
 * and group-header chips.
 */
export const INGREDIENT_CATEGORIES: readonly IngredientCategory[] = [
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
];

/**
 * Categories that exist only for `icon_index` documents, whose "names" are
 * visual descriptions of an icon rather than ingredient labels. Kept out of
 * `INGREDIENT_CATEGORIES` so the comparison-side enum stays closed and no
 * comparison row can ever be assigned one of these.
 */
export const ICON_ONLY_CATEGORIES: readonly IconOnlyCategory[] = [
    {
        id: 'action_or_state',
        label: 'Actions & States',
        color: '#a1a1aa',
        rules: 'Cooking actions, processes, equipment states and other non-ingredient subjects ("Oven Preheating", "Whisking", "Simmering Pot"). Icon names only — an ingredient label is never this category.',
    },
];

/** The fallback category every unclassified label falls back to. */
export const FALLBACK_CATEGORY_ID: IngredientCategoryId = 'other';

/**
 * Sort key for grouping: the category's index in `INGREDIENT_CATEGORIES`.
 *
 * Anything unrecognised — undefined (no lookup doc yet), a stale id from an
 * older taxonomy, or an icon-only id that leaked onto a row — ranks with
 * `other`, so grouping degrades to "shows up in Other" instead of throwing.
 */
export function categoryRank(id: string | undefined): number {
    const index = INGREDIENT_CATEGORIES.findIndex(c => c.id === id);
    return index === -1
        ? INGREDIENT_CATEGORIES.findIndex(c => c.id === FALLBACK_CATEGORY_ID)
        : index;
}

/** Type guard: is `v` one of the twelve comparison-side category ids? */
export function isIngredientCategoryId(v: unknown): v is IngredientCategoryId {
    return typeof v === 'string' && INGREDIENT_CATEGORIES.some(c => c.id === v);
}

/** Looks up a category by id; undefined for unknown ids. */
export function getIngredientCategory(id: string | undefined): IngredientCategory | undefined {
    return INGREDIENT_CATEGORIES.find(c => c.id === id);
}

// ---------------------------------------------------------------------------
// Classification prompt + response parsing (pure; the transport lives elsewhere)
// ---------------------------------------------------------------------------

export interface BuildClassificationPromptOptions {
    /** Include `action_or_state` — for the `icon_index` corpus only. */
    includeIconCategories?: boolean;
}

/**
 * Builds the classification prompt for one batch of labels.
 *
 * Both callers (the backfill scripts and the classify-on-miss path in the
 * comparison action) use this one builder, so a taxonomy edit reaches every
 * classifier at once. Each category's `rules` string is embedded verbatim.
 *
 * The output contract is a bare JSON object keyed by the exact input label —
 * no markdown fences, no prose. `parseClassificationResponse` tolerates fences
 * anyway, because models add them regardless of instructions.
 */
export function buildClassificationPrompt(
    labels: string[],
    opts: BuildClassificationPromptOptions = {},
): string {
    const categories: readonly ClassificationCategory[] = opts.includeIconCategories
        ? [...INGREDIENT_CATEGORIES, ...ICON_ONLY_CATEGORIES]
        : INGREDIENT_CATEGORIES;

    const categoryBlock = categories
        .map(c => `- ${c.id} (${c.label}): ${c.rules}`)
        .join('\n');

    // JSON.stringify the labels so quotes/newlines inside a label cannot break
    // the list, and so the model sees the exact key string it must echo back.
    const labelBlock = labels.map(l => JSON.stringify(l)).join('\n');

    return `You are classifying recipe ingredient labels into a fixed culinary taxonomy.

CATEGORIES (use the id exactly as written; these boundary rules are authoritative and override your own intuition):
${categoryBlock}

LANGUAGE:
The labels come from recipes in many languages — Polish, Lithuanian, Bulgarian, German, French, Spanish, Danish, Indonesian and Chinese all occur alongside English. Classify by MEANING, translating internally as needed. A label being non-English is never a reason to call it "${FALLBACK_CATEGORY_ID}"; use "${FALLBACK_CATEGORY_ID}" only when the label is genuinely unclassifiable in any language.

LABELS TO CLASSIFY (${labels.length}):
${labelBlock}

OUTPUT:
Return a single raw JSON object mapping every label above to exactly one category id, using each label as the key exactly as it appears above:
{"<label>": "<category_id>"}
Rules for the output:
- Include every label — the object must have exactly ${labels.length} keys.
- Values must be one of: ${categories.map(c => c.id).join(', ')}.
- No markdown code fences, no commentary, no trailing text. Output the JSON object and nothing else.`;
}

/** One response entry rejected because its category was not in the allowed set. */
export interface ClassificationRejection {
    label: string;
    /** The category value the model returned, as a string, for the log line. */
    value: string;
}

export interface ClassificationResult {
    /** label → category id, only for labels the model classified acceptably. */
    assignments: Record<string, string>;
    /** Input labels the response did not usably classify (absent or rejected). */
    missing: string[];
    /** Entries whose category was not in `allowed` (also counted in `missing`). */
    invalid: ClassificationRejection[];
}

/**
 * Parses a classification response against the labels that were asked about.
 *
 * Never throws: a fenced, truncated or entirely non-JSON response comes back as
 * "everything is missing", which is exactly what callers need in order to retry
 * the batch or fall back to `other`. Keys the caller did not ask about are
 * ignored, and category values are matched case-insensitively after trimming.
 */
export function parseClassificationResponse(
    raw: string,
    labels: string[],
    allowed: Set<string>,
): ClassificationResult {
    const assignments: Record<string, string> = {};
    const invalid: ClassificationRejection[] = [];
    const parsed = parseJsonObject(raw);

    if (parsed) {
        // Index the response by trimmed key so whitespace the model added around
        // a label does not lose an otherwise good answer. Own enumerable keys
        // only, so a label like "constructor" cannot pick up a prototype value.
        const byTrimmedKey = new Map<string, unknown>();
        for (const [key, value] of Object.entries(parsed)) {
            byTrimmedKey.set(key.trim(), value);
        }

        for (const label of labels) {
            if (Object.prototype.hasOwnProperty.call(assignments, label)) continue;
            const value = byTrimmedKey.get(label.trim());
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
        missing: labels.filter(l => !Object.prototype.hasOwnProperty.call(assignments, l)),
        invalid,
    };
}

/**
 * Best-effort extraction of a JSON object from a model response: strips a
 * markdown fence if present, otherwise falls back to the outermost braces so a
 * stray "Here you go:" preamble does not cost a whole batch. Returns null when
 * nothing parses as an object.
 */
function parseJsonObject(raw: string): Record<string, unknown> | null {
    let text = (raw ?? '').trim();
    if (!text) return null;

    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
        text = fence[1].trim();
    } else {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end > start) text = text.slice(start, end + 1);
    }

    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // Fall through: an unparseable response means "everything is missing".
    }
    return null;
}
