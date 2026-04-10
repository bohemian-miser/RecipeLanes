import { useState, useCallback } from 'react';
import { getFastPass } from '../../lib/icon-search-strategy';
import { collection, query, where, getDocs, documentId } from 'firebase/firestore'; 
import { db } from '@/lib/firebase-client';
import { IconStats } from '@/lib/recipe-lanes/types';

export type HybridSearchResult = {
  icon_id: string;
  score: number;
  is_fresh: boolean; // True if it came from the slow live-DB pass
};

export function useHybridIconSearch() {
  const [isSearching, setIsSearching] = useState(false);
  const [fastResults, setFastResults] = useState<IconStats[]>([]);
  const [mergedResults, setMergedResults] = useState<IconStats[]>([]);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (queryStr: string, limit: number = 12) => {
    if (!queryStr.trim()) {
      setFastResults([]);
      setMergedResults([]);
      return;
    }

    setIsSearching(true);
    setError(null);

    try {
      // 1. FAST PASS (0-50ms)
      const { embedding, fast_matches, snapshot_timestamp } = await getFastPass(queryStr, limit);
      
      const formattedFast = fast_matches.map(m => ({ ...m, is_fresh: false }));
      const idsToFetch = formattedFast.map(f => f.icon_id);
      
      const scoresMap: Record<string, number> = {};
      formattedFast.forEach(f => scoresMap[f.icon_id] = f.score);
      
      // Hydrate via Firestore (In production this could be cached or bundled)
      let hydratedFast: IconStats[] = [];
      if (idsToFetch.length > 0) {
          // Chunk to 10 for 'in' query limits
          const chunks = [];
          for (let i = 0; i < idsToFetch.length; i += 10) {
             chunks.push(idsToFetch.slice(i, i + 10));
          }
          
          for (const chunk of chunks) {
              const q = query(collection(db, 'icon_index'), where(documentId(), 'in', chunk));
              const snap = await getDocs(q);
              snap.docs.forEach(doc => {
                  const data = doc.data();
                  hydratedFast.push({
                      id: doc.id,
                      visualDescription: data.visualDescription || data.ingredient_name,
                      score: data.score,
                      impressions: data.impressions,
                      rejections: data.rejections,
                      metadata: data.metadata,
                      searchTerms: data.searchTerms,
                  });
              });
          }
      }
      
      // Sort hydrated to match original ranked order
      hydratedFast.sort((a, b) => (scoresMap[b.id] || 0) - (scoresMap[a.id] || 0));

      // INSTANT RENDER
      setFastResults(hydratedFast);
      setMergedResults(hydratedFast); 

    } catch (err: any) {
      console.error('[useHybridIconSearch] Error:', err);
      setError(err.message || 'Search failed');
    } finally {
      setIsSearching(false);
    }
  }, []);

  return {
    search,
    isSearching,
    fastResults,
    mergedResults,
    error
  };
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
