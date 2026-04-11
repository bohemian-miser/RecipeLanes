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
 * Batch search via Firebase client SDK — for browser/client contexts.
 */
export async function batchIconSearch(
    ingredients: BatchIngredient[],
    limit: number = 12,
): Promise<BatchSearchResult[]> {
    return getBatchFastPass(ingredients, limit);
}

/**
 * Server-side batch search — calls the CF directly via HTTP (no Firebase client SDK).
 * Firebase onCall functions accept unauthenticated requests; the callable protocol
 * just wraps the body as { data: {...} } and returns { result: {...} }.
 * This avoids the ~70s overhead the Firebase client SDK adds in Cloud Run.
 */
export async function serverBatchIconSearch(
    ingredients: BatchIngredient[],
    limit: number = 12,
): Promise<BatchSearchResult[]> {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const region = 'us-central1';
    const url = `https://${region}-${projectId}.cloudfunctions.net/vectorSearch-searchIconVector`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { ingredients, limit } }),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`CF batch search HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const json: any = await res.json();
    if (json.error) throw new Error(`CF batch search error: ${json.error.message}`);
    return json.result.results;
}
