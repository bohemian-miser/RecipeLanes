import { getFastPass } from './icon-search-strategy';

/**
 * Common search function used by both client-side hooks and server-side actions.
 * Orchestrates the "Fast Pass" (In-Memory Node CF) and can be extended for merging.
 */
export async function unifiedIconSearch(queryInput: string | string[], limit: number = 12) {
    const res = await getFastPass(queryInput, limit);
    return {
        embedding: res.embedding,
        fast_matches: res.fast_matches,
        snapshot_timestamp: res.snapshot_timestamp
    };
}
