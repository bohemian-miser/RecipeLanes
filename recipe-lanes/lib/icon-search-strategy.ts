import { getLegacyEmbeddingAction } from '../app/actions';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase-client';

export type FastMatch = {
  icon_id: string;
  score: number;
};

export type SearchResponse = {
  embedding: number[];
  fast_matches: FastMatch[];
  snapshot_timestamp: number;
};

export type SearchMode = 'node_cf' | 'browser' | 'legacy';

/**
 * Returns the active search mode.
 */
export function getActiveSearchMode(): SearchMode {
  return (process.env.NEXT_PUBLIC_ICON_SEARCH_MODE as SearchMode) || 'node_cf';
}

/**
 * Orchestrates the "Fast Pass" dense vector math and cache lookup.
 */
export async function getFastPass(queryInput: string | string[], limit: number = 12): Promise<SearchResponse> {
  const mode = getActiveSearchMode();
  const query = Array.isArray(queryInput) ? queryInput.join(" ") : queryInput;

  if (mode === 'node_cf') {
    const searchIconVector = httpsCallable<{ queries: string[], limit: number }, SearchResponse>(functions, 'vectorSearch-searchIconVector');
    const queries = Array.isArray(queryInput) ? queryInput : [queryInput];

    try {
      const result = await searchIconVector({ queries, limit });
      return result.data;
    } catch (e: any) {
      throw new Error(`Node CF backend failed: ${e.message}`);
    }
  }

  if (mode === 'legacy') {
    // Legacy path embeds a single concatenated string via Vertex.
    const embedding = await getLegacyEmbeddingAction(query);
    
    return {
      embedding,
      fast_matches: [], 
      snapshot_timestamp: Date.now(),
    };
  }

  if (mode === 'browser') {
    throw new Error("Browser execution mode not fully migrated to main app yet.");
  }

  throw new Error(`Invalid search mode: ${mode}`);
}
