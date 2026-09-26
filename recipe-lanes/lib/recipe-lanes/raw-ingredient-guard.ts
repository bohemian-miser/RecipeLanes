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
 * Raw-ingredient guard — the deterministic half of raw-ingredient extraction.
 *
 * Comparison rows merge on STRING EQUALITY of the raw ingredient name. For a
 * handful of words that equality is wrong whatever the model does: "Pepper" is
 * a pinch of ground spice or 200 g of sliced capsicum, "Clove" is a spice bud
 * or a unit of garlic, and a bare "Breast" / "Whites" / "Leaves" is parser
 * debris that stubs to the same string as other debris. Prose rules cannot fix
 * this — a prohibition ("never merge the spice with the vegetable") is inert
 * under string equality, and every attempt to make the model emit distinct
 * strings instead composed badly with prep-stripping, quantity-stripping and
 * singularization (two review rounds on PR #342). So the decision is made
 * here, in code, and it is the conservative one: when the raw name, or the
 * label it came from, is nothing but an ambiguous word, there is NO raw name
 * and the line keys by its own label, exactly as it did before raw extraction.
 *
 * Under-merging is cosmetic (two rows that could have been one); over-merging
 * silently adds unrelated quantities together. This guard only ever moves a
 * line in the safe direction.
 *
 * WHERE IT RUNS — two call sites, each covering a whole side:
 *  - WRITE: `parseClassificationResponse` applies it to every raw name it
 *    accepts. Both writers (the backfill and classify-on-miss) parse through
 *    it, so nothing ambiguous is ever stored — and the backfill's
 *    cross-category circuit breaker, which aborts on exactly these groups,
 *    sees the guarded names and can complete.
 *  - READ: `lookupIngredientCategories` applies it to every stored
 *    `rawIngredient` it hands out. That is the only road a raw name takes to
 *    the comparison table, so a word added here protects docs written BEFORE
 *    it was added, immediately, with no re-backfill. The comparison merge
 *    itself needs no call of its own.
 *
 * MAINTAINING THE SET: new entries come from evidence, not imagination — the
 * backfill's cross-category collision report (and the rename table, which
 * catches same-category debris the flag cannot see). When it shows a group
 * whose members share a bare word naming two different foods, or a debris
 * stub, add the word's normalized forms (every plural and spelling you want
 * caught; nothing is singularized for you) to `AMBIGUOUS_RAW` and add a case
 * to tests/raw-ingredient-guard.test.ts. Entries are whole PHRASES matched
 * against a label's or raw name's content, so a multi-word entry ("red
 * pepper") is possible when the evidence calls for one.
 */

/**
 * Normalized content phrases that never make an acceptable raw ingredient.
 *
 * Lowercase, accent-stripped, single-spaced — the form `contentPhrase`
 * produces. Plurals and spellings are ENUMERATED rather than derived: a
 * singularizer is exactly the kind of fuzzy step that made "Whites" collide
 * with "White", and an explicit list is reviewable at a glance.
 *
 *  - Homonyms (one word, two foods), evidenced by aborted backfill runs:
 *    pepper (spice vs capsicum; Dutch "peper" reproduced it in prod), clove
 *    (spice vs garlic — and "Cloves, Minced" flipped sense between two
 *    temperature-0 runs), chilli in all its spellings (fresh vs dried — the
 *    prod flag "Chillies, Soaked & Deseeded" vs "Fresh Chilli, To Taste").
 *  - Debris stubs, evidenced by the residue flags: bare colours ("White" vs
 *    "Whites" collided once singularized; "Green" is named in the same v1
 *    residue list and has the same shape against "Greens"), bare "Leaves",
 *    and bare butchery cuts with no animal named ("Breasts" vs "Breast
 *    (cooked, Sliced)"). Thigh, leg, wing and fillet are the direct
 *    analogues of breast — a cut word whose meaning depends entirely on the
 *    animal the parser dropped (a chicken thigh and a lamb leg must never
 *    total together) — so they are listed with it rather than waiting to be
 *    rediscovered one abort at a time.
 */
/**
 * Butchery cuts with no animal named. Kept as their own set because, unlike
 * the other entries, cut words COMPOUND without disambiguating: "Breast
 * Fillet" or "Thigh Fillets, Boneless" still names no animal, so a phrase made
 * ONLY of cut words is as ambiguous as one cut word. (A colour on a homonym is
 * the opposite case — "White Pepper", "Green Chilli" each name one food — so
 * the all-words rule is applied to cuts alone.)
 */
const CUT_WORDS: ReadonlySet<string> = new Set([
    'breast', 'breasts', 'thigh', 'thighs', 'leg', 'legs', 'wing', 'wings', 'fillet', 'fillets',
]);

export const AMBIGUOUS_RAW: ReadonlySet<string> = new Set([
    // homonyms
    'pepper', 'peppers', 'peper', 'pepers',
    'clove', 'cloves',
    'chilli', 'chillies', 'chillis', 'chili', 'chilies', 'chilis', 'chile', 'chiles',
    // debris: bare colours
    'white', 'whites', 'green', 'greens',
    // debris: bare fragments
    'leaf', 'leaves',
    // debris: butchery cuts with no animal named
    ...CUT_WORDS,
]);

/**
 * Words that carry no food identity: quantities, fillers, and kitchen prep /
 * state words (the same kind the raw rules' MERGE list strips). They are
 * removed before a phrase is compared with `AMBIGUOUS_RAW`, so "Pinch Of
 * Pepper", "Pepper, Sliced" and "Fresh Chilli, To Taste" are all recognised as
 * a bare ambiguous word.
 *
 * Deliberately NOT here: words that DO disambiguate or name a shelf product —
 * colours on a homonym ("black", "red", "bell"), "ground", "whole", "dried",
 * "smoked", any animal or plant name. A missing prep word here fails safe
 * twice over: the label then counts as having another word (so its raw is
 * checked on its own), and the raw is caught anyway unless it kept that same
 * prep word.
 */
const NON_FOOD_WORDS: ReadonlySet<string> = new Set([
    // quantities and fillers
    'a', 'an', 'the', 'of', 'and', 'or', 'to', 'for', 'as', 'with', 'plus', 'some', 'few',
    'pinch', 'dash', 'handful', 'taste', 'needed', 'optional', 'more', 'extra', 'about',
    'any', 'mixed', 'color', 'colors', 'colour', 'colours',
    // size
    'large', 'medium', 'small',
    // cut / size prep
    'chopped', 'diced', 'sliced', 'minced', 'grated', 'shredded', 'julienned', 'cubed',
    'halved', 'quartered', 'torn', 'cut', 'into', 'pieces', 'strips', 'finely', 'roughly',
    'coarsely', 'thinly', 'thickly', 'crushed',
    // kitchen state
    'fresh', 'freshly', 'cooked', 'raw', 'melted', 'softened', 'chilled', 'cold', 'warm',
    'beaten', 'whisked', 'sifted', 'peeled', 'seeded', 'deseeded', 'cored', 'stemmed',
    'trimmed', 'rinsed', 'drained', 'thawed', 'soaked', 'rehydrated', 'boneless', 'skinless',
]);

/**
 * The food-bearing content of a label or raw name, as one normalized phrase:
 * parentheticals dropped (they hold prep notes and context — "Breast (cooked,
 * Sliced)", "Pepper To Taste (curry)"), accents stripped the way
 * `standardizeIngredientName` strips them, lowercased, split on anything that
 * is not a letter or digit, then numbers and `NON_FOOD_WORDS` removed.
 *
 * Returns '' when nothing food-bearing is left.
 */
function contentPhrase(text: string): string {
    return text
        .replace(/\([^)]*\)/g, ' ')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(word => word && !/^\p{N}+$/u.test(word) && !NON_FOOD_WORDS.has(word))
        .join(' ');
}

/**
 * True when `text` carries nothing but an ambiguous word, nothing but cut
 * words ("Breast Fillet"), or nothing at all.
 */
export function isAmbiguousRaw(text: string): boolean {
    const phrase = contentPhrase(text);
    if (phrase === '' || AMBIGUOUS_RAW.has(phrase)) return true;
    return phrase.split(' ').every(word => CUT_WORDS.has(word));
}

/**
 * Returns `raw` when it is safe to merge rows on, otherwise undefined — and
 * undefined means "key this line by its own label", the pre-raw behaviour.
 *
 * Two checks, both on content phrases (see `contentPhrase`):
 *
 *  1. The RAW NAME is a bare ambiguous word ("Pepper", "Whites", "Fresh
 *     Chilli", "Cooked Breast"). Merging on it is the collision itself.
 *  2. The LABEL is a bare ambiguous word plus prep ("Cloves, Minced", "Pinch
 *     Of Pepper", "Breasts"). Then any qualified raw the model returned
 *     ("Garlic Clove", "Black Pepper", "Chicken Breast") is a GUESS at a sense
 *     the label never states — the very guess that flipped between runs — so
 *     it is refused too, rather than letting a coin toss pick the row.
 *
 * A label that names the sense itself ("Garlic Cloves, Minced", "Black Pepper",
 * "Chicken Breasts", "Egg Whites", "Bay Leaves") passes both checks and merges
 * normally.
 */
export function guardRawIngredient(label: string, raw: string | undefined): string | undefined {
    if (raw === undefined) return undefined;
    if (isAmbiguousRaw(raw)) return undefined;
    if (isAmbiguousRaw(label)) return undefined;
    return raw;
}
