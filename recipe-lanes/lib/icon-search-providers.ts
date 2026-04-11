import type { IconStats } from './recipe-lanes/types';
import { searchIconCandidatesAction, serverIconSearchAction } from '@/app/actions';
import { getBatchFastPass } from './icon-search-strategy';
import { collection, query as fsQuery, where, getDocs, documentId } from 'firebase/firestore';
import { db } from './firebase-client';

export type IconSearchResult = {
    icons: IconStats[];
    matchScores: Record<string, number>;
};

export type IconSearchProvider = {
    id: string;
    name: string;
    description: string;
    search: (queryStr: string, limit: number) => Promise<IconSearchResult>;
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

export const iconSearchProviders: IconSearchProvider[] = [
    {
        id: 'client-cf',
        name: 'CF · browser',
        description: 'MiniLM 384d · Firebase callable SDK from browser',
        search: async (queryStr, limit) => {
            const results = await getBatchFastPass([{ name: queryStr, queries: [queryStr] }], limit);
            return hydrateIconIds(results[0]?.fast_matches ?? []);
        },
    },
    {
        id: 'server-backend',
        name: 'CF · Next.js server',
        description: 'MiniLM 384d · plain fetch from Cloud Run server',
        search: async (queryStr, limit) => {
            return serverIconSearchAction(queryStr, limit);
        },
    },
    {
        id: 'vertex',
        name: 'Vertex AI',
        description: '768d embedding · Firestore findNearest (legacy)',
        search: async (queryStr, _limit) => {
            const result = await searchIconCandidatesAction(queryStr);
            return { icons: result.candidates, matchScores: result.matchScores };
        },
    },
];
