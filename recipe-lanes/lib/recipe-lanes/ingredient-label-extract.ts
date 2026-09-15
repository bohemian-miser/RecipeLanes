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
 * The distinct-ingredient-label census that the category backfill classifies.
 *
 * This lives in the pure tier rather than inside `scripts/` for one reason: it
 * has to agree EXACTLY with the comparison table about what a label is. The
 * table's row identity is `standardizeIngredientName(label).toLowerCase()`
 * (see `ingredientRowKey`), so the lookup key this module produces has to be
 * the same string, derived the same way, or the `ingredient_categories` docs
 * the backfill writes would never join to the rows that need them.
 *
 * It therefore reuses `extractComparisonIngredients` instead of walking the
 * graph itself — one implementation of "which nodes are ingredients, and what
 * is each one called", used by both sides.
 */

import { extractComparisonIngredients } from './comparison-table';
import type { RecipeGraph } from './types';
import { standardizeIngredientName } from '../utils';

/** One distinct ingredient label across the scanned corpus. */
export interface IngredientLabelUsage {
    /**
     * The `ingredient_categories` lookup key: the standardized label,
     * lowercased. Identical to the label half of the comparison row key.
     */
    key: string;
    /** The standardized label in its display casing (e.g. "Olive Oil"). */
    label: string;
    /** How many ingredient nodes across the corpus resolved to this key. */
    usageCount: number;
    /** How many distinct recipes use it (≤ usageCount). */
    recipeCount: number;
}

/**
 * The lookup-collection key for a label. Matches the label half of
 * `ingredientRowKey`, which is what makes the join work.
 */
export function ingredientCategoryKey(label: string): string {
    return standardizeIngredientName(label).toLowerCase();
}

/**
 * Streaming accumulator, so a caller paging a large collection never has to
 * hold every graph in memory at once.
 */
export interface IngredientLabelCollector {
    /** Folds one recipe graph into the census. */
    add(graph: RecipeGraph): void;
    /** Number of graphs `add` has been called with. */
    readonly recipesSeen: number;
    /**
     * The census so far, most-used first (ties broken by key) so that reports,
     * classification batches and tests are all deterministic.
     */
    labels(): IngredientLabelUsage[];
}

export function createIngredientLabelCollector(): IngredientLabelCollector {
    // Map, not a plain object: a label can legitimately be "__proto__".
    const byKey = new Map<string, IngredientLabelUsage>();
    let recipesSeen = 0;

    return {
        add(graph: RecipeGraph): void {
            recipesSeen++;
            // Distinct keys within THIS recipe, so recipeCount counts recipes
            // and not nodes when one recipe lists an ingredient twice.
            const seenHere = new Set<string>();

            for (const line of extractComparisonIngredients(graph)) {
                // `label` is already standardized by extractComparisonIngredients;
                // re-standardizing is a no-op but keeps the key derivation in one
                // place, and the guard drops labels that normalise to nothing
                // (a node named " " survives the extractor's own trim check).
                const key = ingredientCategoryKey(line.label);
                if (!key) continue;

                let usage = byKey.get(key);
                if (!usage) {
                    usage = { key, label: standardizeIngredientName(line.label), usageCount: 0, recipeCount: 0 };
                    byKey.set(key, usage);
                }
                usage.usageCount++;
                if (!seenHere.has(key)) {
                    seenHere.add(key);
                    usage.recipeCount++;
                }
            }
        },

        get recipesSeen() {
            return recipesSeen;
        },

        labels(): IngredientLabelUsage[] {
            return [...byKey.values()].sort(
                (a, b) => b.usageCount - a.usageCount || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
            );
        },
    };
}

/** Convenience wrapper over the collector for a corpus already in memory. */
export function collectIngredientLabels(graphs: Iterable<RecipeGraph>): IngredientLabelUsage[] {
    const collector = createIngredientLabelCollector();
    for (const graph of graphs) collector.add(graph);
    return collector.labels();
}
