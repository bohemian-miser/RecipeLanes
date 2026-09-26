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
 * Multi-recipe comparison table (gallery "Compare" feature).
 *
 * Pure, framework-free logic: turns a set of recipe graphs into a table whose
 * columns are recipes and whose rows are ingredients (one row per ingredient +
 * unit pair), with a per-row total across every selected recipe. The React
 * component in `components/recipe-comparison/` only handles rendering and
 * drag-and-drop; every ordering / merging / totalling rule lives here so it
 * can be unit-tested in the pure tier.
 */

import { RecipeGraph, RecipeNode } from './types';
import { getNodeIconUrl, getNodeIngredientName } from './model-utils';
import { standardizeIngredientName } from '../utils';
import { boundRawIngredientName, categoryRank } from './ingredient-taxonomy';

/** One ingredient line from one recipe, already scaled to the recipe's current serves. */
export interface ComparisonIngredient {
    /** Row identity shared across recipes: the standardized label + unit. */
    key: string;
    /** Human label (canonical name when the parser produced one, else the ingredient name). */
    label: string;
    /** The recipe line the row came from (e.g. "1 rack of lamb"), for tooltips. */
    text?: string;
    /** Normalised unit ('' when the ingredient is counted by piece or has no unit). */
    unit: string;
    iconUrl?: string;
    /** Scaled quantity; undefined when the recipe lists the ingredient without a number. */
    quantity?: number;
    /**
     * Taxonomy category id from the `ingredient_categories` lookup, stamped on
     * by the server action (see `lib/ingredient-category-lookup.ts`). Optional
     * by design: a label with no lookup doc simply has none, and everything
     * downstream treats "no category" the same as `other`.
     */
    category?: string;
    /**
     * The pantry item this line was bought as, from the same lookup doc — the
     * label with this recipe's own prep stripped off ("Carrot, Chopped" →
     * "Carrot"), so that two recipes phrasing one ingredient differently can
     * be totalled on one row.
     *
     * Optional in the same way `category` is, and absence means IDENTITY: the
     * line is its own raw ingredient and keeps the row it has today — see
     * `rowIdentity`, which is the only thing that reads this field.
     */
    raw?: string;
}

/** The slim, serialisable shape the server action returns per selected recipe. */
export interface ComparisonRecipe {
    id: string;
    title: string;
    previewIcon?: string;
    ingredients: ComparisonIngredient[];
}

export interface ComparisonCell {
    /** Sum of the numeric quantities this recipe lists for the row. */
    quantity?: number;
    /** True when at least one occurrence in this recipe has no numeric quantity. */
    unquantified: boolean;
}

export interface ComparisonRow {
    key: string;
    /**
     * What the row is called: the RAW INGREDIENT name when one drove the row
     * ("Carrot" for a row merged out of "Carrot" and "Carrot, Chopped"), the
     * contributing lines' own label otherwise. The differing prep the merge
     * threw away is still visible in `sources`.
     *
     * Carries a "(unit)" suffix when merging left two rows of one pantry item
     * that would otherwise read identically — see `disambiguateSharedLabels`.
     */
    label: string;
    unit: string;
    /**
     * The icon of the row's canonically-first contributing line, chosen
     * independently of column order (`pickRowIcon`). Undefined when no
     * contributing line had one.
     */
    iconUrl?: string;
    /**
     * Taxonomy category id: the most common one among the contributing lines,
     * ties broken by taxonomy rank then id (`pickRowCategory`). Undefined when
     * no contributing line was classified — grouping treats that as `other`.
     *
     * Independent of column order on purpose: this drives both the row's
     * colour and its place in the default sort, and dragging a recipe column
     * must not change either.
     */
    category?: string;
    /** Keyed by recipe id; absent when the recipe does not use the ingredient. */
    cells: Record<string, ComparisonCell>;
    /**
     * Distinct source lines behind this row, across recipes (tooltip). On a
     * merged row this is the union over every label that merged into it, which
     * is what explains the merge to the reader: a row reading "Carrot" whose
     * tooltip lists "2 carrots, chopped" and "1 carrot" is self-evident.
     */
    sources: string[];
    /** Sum of every numeric cell quantity. */
    total: number;
    /** True when some recipe lists the ingredient without a number, so `total` is a lower bound. */
    totalIsPartial: boolean;
}

export interface ComparisonTable {
    columns: ComparisonRecipe[];
    rows: ComparisonRow[];
}

/** Upper bound on recipes in one comparison (also caps the server action's fan-out). */
export const MAX_COMPARISON_RECIPES = 12;

/**
 * Mirrors the Firestore `recipes` read rule (public/unlisted, or owner) so the
 * comparison action cannot leak a private recipe to a non-owner: the action
 * runs on the Admin SDK, which bypasses rules.
 */
export function canViewRecipeForComparison(
    recipe: { ownerId?: string; visibility?: string },
    uid: string,
): boolean {
    if (recipe.ownerId && recipe.ownerId === uid) return true;
    return recipe.visibility === 'public' || recipe.visibility === 'unlisted';
}

/** Units are compared case-insensitively and without surrounding whitespace. */
export function normalizeUnit(unit: string | undefined): string {
    return (unit ?? '').trim().toLowerCase();
}

/**
 * Builds the row key for an ingredient. Two lines from different recipes land
 * on the same row iff they carry the same label (after the app's standard
 * name normalisation) in the same unit — summing "2 cup flour" with "200 g
 * flour" would be meaningless, so units split rows.
 *
 * The key is derived from the *displayed* label, not from the node's icon
 * description: the icon description is a per-recipe art prompt ("Salt
 * shaker" vs "Sea salt") and keying on it produced two rows that both read
 * "Salt · tsp". Whatever the user sees as one label is one row.
 */
export function ingredientRowKey(label: string, unit: string | undefined): string {
    return `${standardizeIngredientName(label).toLowerCase()}|${normalizeUnit(unit)}`;
}

/** Which row a line belongs on, and whether a raw ingredient put it there. */
interface RowIdentity {
    key: string;
    label: string;
    /** True when a raw ingredient name (this line's or a sibling's) chose the row. */
    rawDriven: boolean;
}

/**
 * The row identity a line's OWN raw ingredient gives it, or undefined when it
 * has no usable one.
 *
 * Two normalisations, both load-bearing:
 *
 *  - `boundRawIngredientName` first, because `standardizeIngredientName` does
 *    not collapse internal whitespace. Without it a model answer of
 *    "Olive  Oil" (double space) keys differently from the identity path's
 *    "Olive Oil" and you get two rows whose labels are visually identical.
 *    Bounding also makes this agree with what the writers store, by
 *    construction rather than by argument.
 *  - `standardizeIngredientName` second, for the display casing the row label
 *    needs. The writers already store display casing; this is the defensive
 *    half of that contract.
 *
 * An empty result is treated as NO raw name — identity, the conservative
 * default — rather than as a row keyed on the empty string.
 */
function rawRowIdentity(line: ComparisonIngredient): { key: string; label: string } | undefined {
    if (!line.raw) return undefined;
    const raw = standardizeIngredientName(boundRawIngredientName(line.raw));
    if (!raw) return undefined;
    return { key: ingredientRowKey(raw, line.unit), label: raw };
}

/**
 * Maps a line's own label-derived key to the raw identity its LABEL resolved
 * to, anywhere in this comparison.
 *
 * This is what makes the merge consistent within one table, and it fixes a
 * real regression. Raw resolution happens per server-action call — one per
 * batch of newly ticked recipes — and the component freezes each answer into
 * its loaded-recipe cache. The same label can therefore arrive WITH a raw name
 * in one batch and WITHOUT one in another, because the second batch timed out
 * or ran past the classify-on-miss cap. Keying each line independently would
 * then split one label across two rows — "Carrot, Chopped" from recipe A on
 * `carrot, chopped|` and the identical label from recipe B on `carrot|` —
 * which is strictly worse than today, and does not heal until the view is
 * rebuilt.
 *
 * So: one pass first, collecting what each label resolved to for the lines
 * that did resolve, and the main pass lets an unresolved line borrow its own
 * label's answer. Because the map is keyed on the label key — which already
 * carries the unit — a borrowed identity can never cross a unit boundary.
 *
 * Ties are broken by the smallest raw key rather than by first encounter. Two
 * lines with one label resolving to DIFFERENT raw names is a classifier
 * contradiction that should not happen, but if it does the table must not
 * depend on which recipe the user ticked first.
 */
function buildRawIdentityMap(recipes: ComparisonRecipe[]): Map<string, { key: string; label: string }> {
    const byLabelKey = new Map<string, { key: string; label: string }>();
    for (const recipe of recipes) {
        for (const line of recipe.ingredients) {
            const identity = rawRowIdentity(line);
            if (!identity) continue;
            const previous = byLabelKey.get(line.key);
            if (!previous || identity.key < previous.key) byLabelKey.set(line.key, identity);
        }
    }
    return byLabelKey;
}

/**
 * The row one ingredient line belongs on.
 *
 * Own raw name first, then the answer its label got elsewhere in this table,
 * then its own label. Three properties are deliberate:
 *
 *  - UNITS STILL SPLIT ROWS. A raw name replaces only the label half of the
 *    key; `ingredientRowKey` supplies the unit half exactly as before, because
 *    summing 200 g of carrot with 2 cups of carrot is meaningless whether or
 *    not the two lines came from one pantry item.
 *  - DEGRADATION IS PER-LABEL. A label that resolved nowhere in this table
 *    keys by itself — today's behaviour, byte for byte — so a comparison
 *    mixing classified and unclassified labels renders correctly rather than
 *    falling back wholesale.
 *  - IDENTICAL LABELS NEVER SPLIT, whichever batch resolved them (see
 *    `buildRawIdentityMap`).
 */
function rowIdentity(
    line: ComparisonIngredient,
    rawByLabelKey: Map<string, { key: string; label: string }>,
): RowIdentity {
    const own = rawRowIdentity(line);
    if (own) return { ...own, rawDriven: true };
    const borrowed = rawByLabelKey.get(line.key);
    if (borrowed) return { ...borrowed, rawDriven: true };
    return { key: line.key, label: line.label, rawDriven: false };
}

/**
 * The factor the editor applies to stored (base-serves) quantities to show
 * the recipe at its current `serves` setting. Mirrors `handleUpdateServes`
 * in app/lanes/page.tsx so the comparison shows the same numbers the diagram does.
 */
export function servesScale(graph: Pick<RecipeGraph, 'serves' | 'baseServes'>): number {
    const base = graph.baseServes || 1;
    const serves = graph.serves || base;
    const scale = serves / base;
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function roundQuantity(n: number): number {
    return Math.round(n * 100) / 100;
}

/**
 * Extracts every ingredient node of a graph as a comparison line. Action nodes
 * are skipped. Quantities are scaled to the graph's current serves.
 */
export function extractComparisonIngredients(graph: RecipeGraph): ComparisonIngredient[] {
    const scale = servesScale(graph);
    const out: ComparisonIngredient[] = [];
    for (const node of graph.nodes ?? []) {
        if (node.type !== 'ingredient') continue;
        const line = ingredientFromNode(node, scale);
        if (line) out.push(line);
    }
    return out;
}

function ingredientFromNode(node: RecipeNode, scale: number): ComparisonIngredient | null {
    const ingredientName = (getNodeIngredientName(node) ?? '').trim();
    const canonical = (node.canonicalName ?? '').trim();
    const labelSource = canonical || ingredientName;
    if (!labelSource) return null;

    const unit = normalizeUnit(node.unit);
    const hasQuantity = typeof node.quantity === 'number' && Number.isFinite(node.quantity);
    const label = standardizeIngredientName(labelSource);
    const text = (node.text ?? '').trim();
    return {
        key: ingredientRowKey(label, unit),
        label,
        text: text || undefined,
        unit,
        iconUrl: getNodeIconUrl(node),
        quantity: hasQuantity ? roundQuantity((node.quantity as number) * scale) : undefined,
    };
}

/** Convenience wrapper producing the server-action payload for one recipe. */
export function toComparisonRecipe(id: string, title: string | undefined, graph: RecipeGraph, previewIcon?: string): ComparisonRecipe {
    const ingredients = extractComparisonIngredients(graph);
    return {
        id,
        title: (title || graph.title || 'Untitled Recipe').trim() || 'Untitled Recipe',
        // Same pick as the gallery card (mapRecipeDoc): the last resolved icon.
        previewIcon: previewIcon ?? ingredients.map(i => i.iconUrl).findLast((u): u is string => !!u),
        ingredients,
    };
}

/** One ingredient line contributing to a row, with the recipe it came from. */
interface Contribution {
    line: ComparisonIngredient;
    recipeId: string;
}

/**
 * A total order over a row's contributing lines that does NOT depend on
 * column order. Used to pick a row's icon.
 *
 * Column order is user-controlled — recipes can be dragged — so "first seen"
 * is not a property of the data, it is a property of the current arrangement.
 * Sorting on the line's own content instead means dragging a column can never
 * change what a row looks like.
 */
function contributionOrder(c: Contribution): string {
    return [c.line.label, c.recipeId, c.line.text ?? '', c.line.iconUrl ?? ''].join(' ');
}

/**
 * The category a row carries: the most common one among its contributing
 * lines, ties broken by taxonomy rank and then by id.
 *
 * Why not first-seen. A row's category drives its colour dot AND its position
 * in the default category sort, and first-seen means first COLUMN — so with
 * lines disagreeing, dragging a recipe column left could recolour a row and
 * move it. Majority-with-a-deterministic-tiebreak depends only on the set of
 * lines, so the arrangement cannot change it.
 *
 * Disagreement should not happen at all: two labels sharing a raw ingredient
 * but not a category is a classifier contradiction, and the backfill flags
 * every cross-category merge for owner review before a production write. This
 * is about what the table does when it happens anyway — pick one answer and
 * always the same one.
 */
function pickRowCategory(contributions: Contribution[]): string | undefined {
    const counts = new Map<string, number>();
    for (const { line } of contributions) {
        if (line.category) counts.set(line.category, (counts.get(line.category) ?? 0) + 1);
    }
    let best: string | undefined;
    let bestCount = 0;
    for (const [id, count] of counts) {
        if (best === undefined || count > bestCount) {
            best = id;
            bestCount = count;
            continue;
        }
        if (count < bestCount) continue;
        // Equal counts: the earlier taxonomy rank wins, and an id comparison
        // settles even two unrecognised ids (which share `other`'s rank).
        const rank = categoryRank(id);
        const bestRank = categoryRank(best);
        if (rank < bestRank || (rank === bestRank && id < best)) best = id;
    }
    return best;
}

/** The icon a row shows: the one on its canonically-first contributing line. */
function pickRowIcon(contributions: Contribution[]): string | undefined {
    let best: Contribution | undefined;
    for (const c of contributions) {
        if (!c.line.iconUrl) continue;
        if (!best || contributionOrder(c) < contributionOrder(best)) best = c;
    }
    return best?.line.iconUrl;
}

/**
 * Makes sure no two rows of a merged table read identically.
 *
 * Units split rows, so one pantry item listed in grams by one recipe and by
 * the piece in another produces two rows that both say "Carrot". The unit is
 * rendered as a chip beside the label — but a unit-less row has no chip, so
 * the pair reads as a duplicate rather than as a split. Appending the unit to
 * the label of the rows that HAVE one separates them, and leaves the unit-less
 * row as the clean pantry name.
 *
 * Deliberately NOT applied to a clash that merging did not cause. Two rows
 * reading "Flour" because one recipe used grams and another cups is
 * pre-existing behaviour, and this PR's contract is that a table with no raw
 * ingredients anywhere is byte-identical to today's. Relabelling those would
 * break it for a cosmetic win that belongs in its own change.
 *
 * The unit-less row keeps the raw name rather than falling back to one of its
 * originating labels: on a row that merged "Carrot, Chopped" and "Carrot,
 * Grated", showing either one would name a single origin and misrepresent the
 * merge. The origins are all in `sources`, which the tooltip shows.
 */
function disambiguateSharedLabels(
    rowsByKey: Map<string, ComparisonRow>,
    rawDrivenKeys: Set<string>,
): void {
    const byLabel = new Map<string, ComparisonRow[]>();
    for (const row of rowsByKey.values()) {
        const group = byLabel.get(row.label);
        if (group) group.push(row);
        else byLabel.set(row.label, [row]);
    }
    for (const group of byLabel.values()) {
        if (group.length < 2) continue;
        if (!group.some(row => rawDrivenKeys.has(row.key))) continue;
        for (const row of group) {
            if (row.unit) row.label = `${row.label} (${row.unit})`;
        }
    }
}

/**
 * Merges the selected recipes into table rows.
 *
 * - Columns follow `recipes` order (the caller owns column order).
 * - Rows: one per ROW IDENTITY (`rowIdentity` — raw ingredient + unit where the
 *   lookup resolved one, label + unit otherwise), ordered by ingredient
 *   category (taxonomy order, uncategorised last) by default. When `rowOrder`
 *   is given, rows keep that order instead and any newly discovered keys are
 *   appended after it; keys in `rowOrder` that no selected recipe uses any more
 *   are dropped — including keys that merging just retired, which is why a
 *   rows-just-merged rebuild needs no migration of the user's arrangement.
 * - A row's total sums every numeric cell; `totalIsPartial` flags rows where
 *   some recipe lists the ingredient without a number.
 */
export function buildComparisonTable(recipes: ComparisonRecipe[], rowOrder?: string[]): ComparisonTable {
    const rawByLabelKey = buildRawIdentityMap(recipes);

    const rowsByKey = new Map<string, ComparisonRow>();
    // Every line behind a row, kept so `category` and `iconUrl` can be chosen
    // from the whole set rather than from whichever line happened to arrive
    // first (see `pickRowCategory` / `pickRowIcon`).
    const contributionsByKey = new Map<string, Contribution[]>();
    const rawDrivenKeys = new Set<string>();
    const discovered: string[] = [];

    for (const recipe of recipes) {
        for (const line of recipe.ingredients) {
            const { key, label, rawDriven } = rowIdentity(line, rawByLabelKey);
            if (rawDriven) rawDrivenKeys.add(key);
            let row = rowsByKey.get(key);
            if (!row) {
                row = {
                    key,
                    label,
                    unit: line.unit,
                    // Both resolved after accumulation, from every contributing
                    // line at once; the keys stay present so the row shape is
                    // unchanged.
                    iconUrl: undefined,
                    category: undefined,
                    cells: {},
                    sources: [],
                    total: 0,
                    totalIsPartial: false,
                };
                rowsByKey.set(key, row);
                contributionsByKey.set(key, []);
                discovered.push(key);
            }
            contributionsByKey.get(key)!.push({ line, recipeId: recipe.id });
            if (line.text && !row.sources.includes(line.text)) row.sources.push(line.text);

            const cell = row.cells[recipe.id] ?? { unquantified: false };
            if (line.quantity == null) {
                cell.unquantified = true;
            } else {
                cell.quantity = roundQuantity((cell.quantity ?? 0) + line.quantity);
            }
            row.cells[recipe.id] = cell;
        }
    }

    for (const row of rowsByKey.values()) {
        const contributions = contributionsByKey.get(row.key)!;
        row.category = pickRowCategory(contributions);
        row.iconUrl = pickRowIcon(contributions);
    }

    disambiguateSharedLabels(rowsByKey, rawDrivenKeys);

    for (const row of rowsByKey.values()) {
        let total = 0;
        let partial = false;
        for (const cell of Object.values(row.cells)) {
            if (cell.quantity != null) total += cell.quantity;
            if (cell.unquantified) partial = true;
        }
        row.total = roundQuantity(total);
        row.totalIsPartial = partial;
    }

    // The table's *default* order groups the ingredients by category: a stable
    // sort by taxonomy rank, so rows of one category keep their first-seen order
    // and uncategorised rows fall in with `other`, at the end. This is an
    // initial sort and nothing more — `reconcileOrder` still gives a
    // hand-arranged `rowOrder` absolute priority, so once the user drags a row
    // the table never re-sorts itself under them; newly discovered rows are
    // appended as before, in category order rather than first-seen order.
    const defaultOrder = [...discovered].sort(
        (a, b) => categoryRank(rowsByKey.get(a)?.category) - categoryRank(rowsByKey.get(b)?.category),
    );

    const orderedKeys = reconcileOrder(rowOrder ?? [], defaultOrder);
    return {
        columns: recipes,
        rows: orderedKeys.map(k => rowsByKey.get(k)!),
    };
}

/**
 * Keeps a user-arranged order stable as the underlying set changes: ids from
 * `previous` that are still `available` keep their relative order, ids that
 * vanished are dropped, and ids new to `available` are appended in the order
 * `available` lists them.
 */
export function reconcileOrder(previous: string[], available: string[]): string[] {
    const availableSet = new Set(available);
    const kept = previous.filter(id => availableSet.has(id));
    const keptSet = new Set(kept);
    return [...kept, ...available.filter(id => !keptSet.has(id))];
}

/** Moves the item at `from` to index `to`, returning a new array (no-op for bad indices). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
    if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
}

/**
 * Moves the item identified by `fromKey` to where `toKey` currently sits.
 *
 * Drag-and-drop must resolve positions by IDENTITY, at drop time, not by the
 * indices captured at dragstart. The table rebuilds whenever an async recipe
 * arrives (or a phantom one is unticked), and because the default row order is
 * a category sort, a late arrival can INSERT rows above the one being dragged
 * rather than only appending — so a stale index silently points at a different
 * row by the time the drop lands, and the wrong arrangement gets pinned into
 * `rowOrder` permanently. Returns null when either key has vanished from the
 * list mid-drag, which the caller treats as "drop did nothing".
 */
export function moveItemByKey(list: readonly string[], fromKey: string, toKey: string): string[] | null {
    const from = list.indexOf(fromKey);
    const to = list.indexOf(toKey);
    if (from < 0 || to < 0) return null;
    return moveItem(list, from, to);
}

/**
 * Moves the item identified by `key` `delta` places along the list — the
 * keyboard equivalent of a drag, resolving the item's CURRENT position at
 * keypress time for the same reason. Returns null when the key is gone or the
 * move would leave the list.
 */
export function nudgeItemByKey(list: readonly string[], key: string, delta: number): string[] | null {
    const from = list.indexOf(key);
    if (from < 0) return null;
    const to = from + delta;
    if (to < 0 || to >= list.length) return null;
    return moveItem(list, from, to);
}

/** Formats a quantity for a table cell: trims float noise, keeps up to 2 decimals. */
export function formatQuantity(n: number): string {
    if (!Number.isFinite(n)) return '';
    return String(roundQuantity(n));
}
