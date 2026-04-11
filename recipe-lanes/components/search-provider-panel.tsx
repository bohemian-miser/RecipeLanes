'use client';

import { useState, useEffect } from 'react';
import type { IconSearchMethod } from '@/lib/icon-search-registry';
import { IconSearchCandidates } from './icon-search-candidates';
import type { IconStats } from '@/lib/recipe-lanes/types';

export function SearchProviderPanel({
    provider,
    activeQuery,
    limit = 12,
    onIconClick,
}: {
    provider: IconSearchMethod;
    activeQuery: string;
    limit?: number;
    onIconClick: (icon: IconStats, matchScore?: number) => void;
}) {
    const [icons, setIcons] = useState<IconStats[]>([]);
    const [matchScores, setMatchScores] = useState<Record<string, number>>({});
    const [isSearching, setIsSearching] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!activeQuery) return;
        setIsSearching(true);
        setError(null);
        provider
            .search([{ name: activeQuery, queries: [activeQuery] }], limit)
            .then(results => {
                const r = results[0] ?? { icons: [], matchScores: {} };
                setIcons(r.icons);
                setMatchScores(r.matchScores);
            })
            .catch(e => setError(e.message))
            .finally(() => setIsSearching(false));
    }, [activeQuery, provider.id, limit]);

    return (
        <div>
            <div className="flex items-baseline gap-3 mb-3">
                <h2 className="text-lg font-bold">{provider.name}</h2>
                <span className="text-xs text-zinc-500 font-mono">{provider.description}</span>
            </div>
            {error && <p className="text-red-400 text-xs mb-2 font-mono">{error}</p>}
            <IconSearchCandidates
                query={activeQuery}
                candidates={icons}
                matchScores={matchScores}
                isSearching={isSearching}
                onIconClick={(icon, matchScore) => onIconClick(icon, matchScore)}
            />
        </div>
    );
}
