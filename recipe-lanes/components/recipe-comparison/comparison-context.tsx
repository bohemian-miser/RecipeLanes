/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

'use client';

/**
 * Selection state for the gallery "Compare" table (signed-in users only).
 *
 * The provider is mounted by app/gallery/page.tsx only when a session exists,
 * so `useRecipeComparison()` returning null is the "not logged in" signal the
 * card toggle uses to render nothing. The ordered id list doubles as the
 * table's column order; column drag-and-drop calls `setSelectedIds`.
 *
 * Selection is mirrored to sessionStorage (per user) because the gallery is a
 * server-rendered page and switching between the Mine / Starred / Gallery
 * tabs remounts everything — losing the ticks on every tab change would make
 * cross-tab comparisons impossible. It is exposed through
 * `useSyncExternalStore` so the server render and the first client render
 * both see the empty selection (no hydration mismatch) and the stored ticks
 * appear on the very next paint.
 */

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import { MAX_COMPARISON_RECIPES } from '@/lib/recipe-lanes/comparison-table';

export interface RecipeComparisonContextValue {
    /** Selected recipe ids in column order. */
    selectedIds: string[];
    isSelected: (id: string) => boolean;
    /** Adds or removes a recipe; returns false when the cap prevented adding. */
    toggle: (id: string) => boolean;
    remove: (id: string) => void;
    setSelectedIds: (ids: string[]) => void;
    clear: () => void;
    max: number;
}

const RecipeComparisonContext = createContext<RecipeComparisonContextValue | null>(null);

// --- Tiny external store (module-level, one selection per user) -------------

const EMPTY: string[] = [];
const listeners = new Set<() => void>();
let cache: { userId: string; ids: string[] } | null = null;

function storageKey(userId: string) {
    return `recipe-compare:${userId}`;
}

function readStored(userId: string): string[] {
    try {
        const raw = sessionStorage.getItem(storageKey(userId));
        if (!raw) return EMPTY;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return EMPTY;
        return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_COMPARISON_RECIPES);
    } catch {
        return EMPTY;
    }
}

function writeStored(userId: string, ids: string[]) {
    try {
        sessionStorage.setItem(storageKey(userId), JSON.stringify(ids));
    } catch {
        /* storage unavailable (private mode, quota) — selection is per-page then */
    }
}

/** Stable reference while unchanged, as useSyncExternalStore requires. */
function getSnapshot(userId: string): string[] {
    if (!cache || cache.userId !== userId) cache = { userId, ids: readStored(userId) };
    return cache.ids;
}

function getServerSnapshot(): string[] {
    return EMPTY;
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

function commit(userId: string, ids: string[]) {
    const next = Array.from(new Set(ids)).slice(0, MAX_COMPARISON_RECIPES);
    cache = { userId, ids: next };
    writeStored(userId, next);
    listeners.forEach(l => l());
}

// --- Provider ------------------------------------------------------------------

export function RecipeComparisonProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
    const selectedIds = useSyncExternalStore(
        subscribe,
        () => getSnapshot(userId),
        getServerSnapshot,
    );

    const setSelectedIds = useCallback((ids: string[]) => commit(userId, ids), [userId]);

    const toggle = useCallback((id: string): boolean => {
        const current = getSnapshot(userId);
        if (current.includes(id)) {
            commit(userId, current.filter(x => x !== id));
            return true;
        }
        if (current.length >= MAX_COMPARISON_RECIPES) return false;
        commit(userId, [...current, id]);
        return true;
    }, [userId]);

    const remove = useCallback((id: string) => {
        const current = getSnapshot(userId);
        if (current.includes(id)) commit(userId, current.filter(x => x !== id));
    }, [userId]);

    const clear = useCallback(() => commit(userId, []), [userId]);

    const value = useMemo<RecipeComparisonContextValue>(() => ({
        selectedIds,
        isSelected: (id: string) => selectedIds.includes(id),
        toggle,
        remove,
        setSelectedIds,
        clear,
        max: MAX_COMPARISON_RECIPES,
    }), [selectedIds, toggle, remove, setSelectedIds, clear]);

    return <RecipeComparisonContext.Provider value={value}>{children}</RecipeComparisonContext.Provider>;
}

/** Null outside the provider — i.e. for signed-out visitors, where the feature is hidden. */
export function useRecipeComparison(): RecipeComparisonContextValue | null {
    return useContext(RecipeComparisonContext);
}
