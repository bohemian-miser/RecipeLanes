import { useState, useCallback } from 'react';
import { getActiveSearchStrategy, FastMatch } from '../../lib/icon-search-strategy';
// import { collection, query, where, getDocs, ... } from 'firebase/firestore'; 

export type HybridSearchResult = {
  icon_id: string;
  score: number;
  is_fresh: boolean; // True if it came from the slow live-DB pass
};

export function useHybridIconSearch() {
  const [isSearching, setIsSearching] = useState(false);
  const [fastResults, setFastResults] = useState<HybridSearchResult[]>([]);
  const [mergedResults, setMergedResults] = useState<HybridSearchResult[]>([]);
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
      const strategy = getActiveSearchStrategy();
      
      // 1. FAST PASS (0-50ms)
      const { embedding, fast_matches, snapshot_timestamp } = await strategy.getFastPass(queryStr, limit);
      
      // Map to standard result format
      const formattedFast = fast_matches.map(m => ({ ...m, is_fresh: false }));
      
      // INSTANT RENDER
      setFastResults(formattedFast);
      setMergedResults(formattedFast); 

      // 2. SLOW PASS (Live Firestore query in parallel)
      // Note: This relies on Next.js / Firebase client SDK. 
      // This is a stub showing the logic we will flesh out when the schema refactor is done.
      // 
      // const iconsRef = collection(db, 'icons');
      // const q = query(iconsRef, where('created_at', '>', snapshot_timestamp));
      // const snap = await getDocs(q); ... and then we do cosine similarity locally on the new deltas
      
      const freshIcons: HybridSearchResult[] = []; // fetch from live DB...
      
      // 3. MERGE
      if (freshIcons.length > 0) {
        const combinedMap = new Map<string, HybridSearchResult>();
        
        // Add fast matches to map
        formattedFast.forEach(res => combinedMap.set(res.icon_id, res));
        
        // Add or overwrite with fresh matches if they score higher
        freshIcons.forEach(res => {
          const existing = combinedMap.get(res.icon_id);
          if (!existing || res.score > existing.score) {
             combinedMap.set(res.icon_id, res);
          }
        });
        
        const finalRanked = Array.from(combinedMap.values())
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
          
        setMergedResults(finalRanked);
      }

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
