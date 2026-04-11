/**
 * Single registry of all icon search implementations.
 *
 * Add a new method here — it auto-appears in:
 *   - icon_overview search panels (via iconSearchProviders re-export)
 *   - lanes toolbar ICONS dropdown
 *
 * Unified interface: search(ingredients[], limit) → SearchResult[]
 *   - For a single-query panel: pass a 1-element slice, read result[0]
 *   - For batch recipe fill: pass all ingredients, apply results via applyIconSearchResultsAction
 *
 * Set isDefault: true on exactly one method to pre-select it in the lanes dropdown.
 */

import type { IconStats } from './recipe-lanes/types';
import {
    searchIconCandidatesAction,
    serverBatchSearchAction,
    nextjsBatchSearchAction,
} from '@/app/actions';
import { getBatchFastPass } from './icon-search-strategy';
import { collection, query as fsQuery, where, getDocs, documentId } from 'firebase/firestore';
import { db } from './firebase-client';

export type BatchIngredient = { name: string; queries: string[] };

export type SearchResult = {
    name: string;
    icons: IconStats[];
    matchScores: Record<string, number>;
};

export type IconSearchMethod = {
    id: string;
    name: string;
    description: string;
    /** Pre-selected in the lanes ICONS dropdown. Set on exactly one entry. */
    isDefault?: boolean;
    /**
     * Search for icons matching the given ingredients.
     * Pass a 1-element array for a single-query panel; pass all recipe
     * ingredients for batch fill.
     */
    search: (ingredients: BatchIngredient[], limit: number) => Promise<SearchResult[]>;
};

// Client-side hydration from the Firestore icon_index (batches in chunks of 10)
async function hydrateClientSide(
    items: { name: string; fast_matches: { icon_id: string; score: number }[] }[]
): Promise<SearchResult[]> {
    const allIds = [...new Set(items.flatMap(i => i.fast_matches.map(m => m.icon_id)))];
    const iconMap = new Map<string, IconStats>();
    for (let i = 0; i < allIds.length; i += 10) {
        const chunk = allIds.slice(i, i + 10);
        const q = fsQuery(collection(db, 'icon_index'), where(documentId(), 'in', chunk));
        const snap = await getDocs(q);
        snap.docs.forEach(doc => {
            const data = doc.data();
            iconMap.set(doc.id, {
                id: doc.id,
                visualDescription: data.visualDescription || data.ingredient_name,
                score: data.score,
                impressions: data.impressions,
                rejections: data.rejections,
                metadata: data.metadata,
                searchTerms: data.searchTerms,
            } as IconStats);
        });
    }
    return items.map(item => {
        const matchScores = Object.fromEntries(item.fast_matches.map(m => [m.icon_id, m.score]));
        const icons = item.fast_matches.map(m => iconMap.get(m.icon_id)).filter(Boolean) as IconStats[];
        return { name: item.name, icons, matchScores };
    });
}

export const iconSearchMethods: IconSearchMethod[] = [
    {
        id: 'client-cf',
        name: 'CF · browser',
        description: 'MiniLM 384d · Firebase callable SDK from browser',
        isDefault: true,
        search: async (ingredients, limit) => {
            const results = await getBatchFastPass(ingredients, limit);
            return hydrateClientSide(results.map(r => ({ name: r.name, fast_matches: r.fast_matches ?? [] })));
        },
    },
    {
        id: 'server-cf',
        name: 'CF · Next.js server',
        description: 'MiniLM 384d · plain fetch from Cloud Run server',
        search: async (ingredients, limit) => serverBatchSearchAction(ingredients, limit),
    },
    {
        id: 'nextjs-inprocess',
        name: 'Next.js · in-process',
        description: 'MiniLM 384d · ONNX baked into container, zero network hops',
        search: async (ingredients, limit) => nextjsBatchSearchAction(ingredients, limit),
    },
    {
        id: 'vertex',
        name: 'Vertex AI',
        description: '768d embedding · Firestore findNearest (legacy)',
        search: async (ingredients, _limit) => {
            // Legacy method: no batch API, loop single queries in parallel
            return Promise.all(ingredients.map(async ing => {
                const result = await searchIconCandidatesAction(ing.name);
                return { name: ing.name, icons: result.candidates, matchScores: result.matchScores };
            }));
        },
    },
];

export const defaultIconSearchMethod: IconSearchMethod =
    iconSearchMethods.find(m => m.isDefault) ?? iconSearchMethods[0];
