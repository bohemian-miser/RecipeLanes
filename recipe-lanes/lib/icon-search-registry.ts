/**
 * Single registry of all icon search implementations.
 *
 * Add a new method here and it automatically appears in:
 *   - icon_overview search panels (via iconSearchProviders re-export)
 *   - lanes toolbar ICONS dropdown (any method with batchApply)
 *
 * Set isDefault: true on exactly one method to make it the pre-selected
 * choice in the lanes dropdown.
 */

import type { IconStats } from './recipe-lanes/types';
import {
    searchIconCandidatesAction,
    serverIconSearchAction,
    nextjsIconSearchAction,
    applyBatchIconSearchAction,
    serverBatchIconSearchApplyAction,
} from '@/app/actions';
import { getBatchFastPass } from './icon-search-strategy';
import { collection, query as fsQuery, where, getDocs, documentId } from 'firebase/firestore';
import { db } from './firebase-client';

export type IconSearchResult = {
    icons: IconStats[];
    matchScores: Record<string, number>;
};

export type BatchIngredient = { name: string; queries: string[] };
export type BatchApplyResult = { applied: number; elapsed: number };

export type IconSearchMethod = {
    id: string;
    name: string;
    description: string;
    /** Pre-selected method in the lanes ICONS dropdown. Set on exactly one entry. */
    isDefault?: boolean;
    /** Single-query search — powers icon_overview panels. */
    search: (queryStr: string, limit: number) => Promise<IconSearchResult>;
    /** Batch fill for an entire recipe — powers lanes toolbar. Omit if not applicable. */
    batchApply?: (recipeId: string, ingredients: BatchIngredient[]) => Promise<BatchApplyResult>;
};

async function hydrateIconIds(fastMatches: { icon_id: string; score: number }[]): Promise<IconSearchResult> {
    const matchScores: Record<string, number> = Object.fromEntries(fastMatches.map(m => [m.icon_id, m.score]));
    const ids = fastMatches.map(m => m.icon_id);
    const icons: IconStats[] = [];
    for (let i = 0; i < ids.length; i += 10) {
        const chunk = ids.slice(i, i + 10);
        const q = fsQuery(collection(db, 'icon_index'), where(documentId(), 'in', chunk));
        const snap = await getDocs(q);
        snap.docs.forEach(doc => {
            const data = doc.data();
            icons.push({
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
    icons.sort((a, b) => (matchScores[b.id] || 0) - (matchScores[a.id] || 0));
    return { icons, matchScores };
}

export const iconSearchMethods: IconSearchMethod[] = [
    {
        id: 'client-cf',
        name: 'CF · browser',
        description: 'MiniLM 384d · Firebase callable SDK from browser',
        isDefault: true,
        search: async (queryStr, limit) => {
            const results = await getBatchFastPass([{ name: queryStr, queries: [queryStr] }], limit);
            return hydrateIconIds(results[0]?.fast_matches ?? []);
        },
        batchApply: async (recipeId, ingredients) => {
            const t0 = Date.now();
            const results = await getBatchFastPass(ingredients, 12);
            const res = await applyBatchIconSearchAction(recipeId, results as any);
            if (!res.success) throw new Error(res.error ?? 'batchApply failed');
            return { applied: res.applied, elapsed: Date.now() - t0 };
        },
    },
    {
        id: 'server-cf',
        name: 'CF · Next.js server',
        description: 'MiniLM 384d · plain fetch from Cloud Run server',
        search: async (queryStr, limit) => serverIconSearchAction(queryStr, limit),
        batchApply: async (recipeId, ingredients) => {
            const res = await serverBatchIconSearchApplyAction(recipeId, ingredients, 'server-cf');
            if (!res.success) throw new Error(res.error ?? 'batchApply failed');
            return { applied: res.applied, elapsed: res.elapsed };
        },
    },
    {
        id: 'nextjs-inprocess',
        name: 'Next.js · in-process',
        description: 'MiniLM 384d · ONNX baked into container, zero network hops',
        search: async (queryStr, limit) => nextjsIconSearchAction(queryStr, limit),
        batchApply: async (recipeId, ingredients) => {
            const res = await serverBatchIconSearchApplyAction(recipeId, ingredients, 'nextjs');
            if (!res.success) throw new Error(res.error ?? 'batchApply failed');
            return { applied: res.applied, elapsed: res.elapsed };
        },
    },
    {
        id: 'vertex',
        name: 'Vertex AI',
        description: '768d embedding · Firestore findNearest (legacy)',
        // No batchApply — legacy ANN method, not suitable for batch recipe fill
        search: async (queryStr, _limit) => {
            const result = await searchIconCandidatesAction(queryStr);
            return { icons: result.candidates, matchScores: result.matchScores };
        },
    },
];

export const defaultIconSearchMethod: IconSearchMethod =
    iconSearchMethods.find(m => m.isDefault) ?? iconSearchMethods[0];

/** Subset of methods that support batch recipe fill (for the lanes dropdown). */
export const batchIconSearchMethods: IconSearchMethod[] =
    iconSearchMethods.filter(m => m.batchApply != null);
