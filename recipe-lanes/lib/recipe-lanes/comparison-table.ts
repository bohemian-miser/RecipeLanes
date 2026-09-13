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
    label: string;
    unit: string;
    iconUrl?: string;
    /** Keyed by recipe id; absent when the recipe does not use the ingredient. */
    cells: Record<string, ComparisonCell>;
    /** Distinct source lines behind this row, across recipes (tooltip). */
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

/**
 * Merges the selected recipes into table rows.
 *
 * - Columns follow `recipes` order (the caller owns column order).
 * - Rows: one per ingredient+unit key. When `rowOrder` is given, rows keep
 *   that order and any newly discovered keys are appended in first-seen order;
 *   keys in `rowOrder` that no selected recipe uses any more are dropped.
 * - A row's total sums every numeric cell; `totalIsPartial` flags rows where
 *   some recipe lists the ingredient without a number.
 */
export function buildComparisonTable(recipes: ComparisonRecipe[], rowOrder?: string[]): ComparisonTable {
    const rowsByKey = new Map<string, ComparisonRow>();
    const discovered: string[] = [];

    for (const recipe of recipes) {
        for (const line of recipe.ingredients) {
            let row = rowsByKey.get(line.key);
            if (!row) {
                row = {
                    key: line.key,
                    label: line.label,
                    unit: line.unit,
                    iconUrl: line.iconUrl,
                    cells: {},
                    sources: [],
                    total: 0,
                    totalIsPartial: false,
                };
                rowsByKey.set(line.key, row);
                discovered.push(line.key);
            } else if (!row.iconUrl && line.iconUrl) {
                row.iconUrl = line.iconUrl;
            }
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
        let total = 0;
        let partial = false;
        for (const cell of Object.values(row.cells)) {
            if (cell.quantity != null) total += cell.quantity;
            if (cell.unquantified) partial = true;
        }
        row.total = roundQuantity(total);
        row.totalIsPartial = partial;
    }

    const orderedKeys = reconcileOrder(rowOrder ?? [], discovered);
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

/** Formats a quantity for a table cell: trims float noise, keeps up to 2 decimals. */
export function formatQuantity(n: number): string {
    if (!Number.isFinite(n)) return '';
    return String(roundQuantity(n));
}
