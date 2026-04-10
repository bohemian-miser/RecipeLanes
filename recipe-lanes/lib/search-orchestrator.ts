import { getFastPass, getBatchFastPass, BatchIngredient, BatchSearchResult } from './icon-search-strategy';

/**
 * Single-ingredient search — used by the reroll/reject flow and client hooks.
 */
export async function unifiedIconSearch(queryInput: string | string[], limit: number = 12) {
    const res = await getFastPass(queryInput, limit);
    return {
        embedding: res.embedding,
        fast_matches: res.fast_matches,
        snapshot_timestamp: res.snapshot_timestamp
    };
}

/**
 * Batch search — one CF call for all ingredients in a recipe.
 * Used by resolveRecipeIcons to fan out all ingredient searches in a single round-trip.
 */
export async function batchIconSearch(
    ingredients: BatchIngredient[],
    limit: number = 12,
): Promise<BatchSearchResult[]> {
    return getBatchFastPass(ingredients, limit);
}
