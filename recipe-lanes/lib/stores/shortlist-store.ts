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

/**
 * Zustand store for shortlist cycling state.
 *
 * shortlistIndex is ephemeral UI state — it represents which icon the user is
 * currently looking at, not a server-authoritative fact.  It is persisted to
 * Firestore only when the recipe is saved (drag-stop or Save button), because
 * performSave() reads the current index back via getShortlistIndexes().
 *
 * Do NOT write shortlistIndex to Firestore on every cycle — that triggers the
 * onSnapshot listener, which re-renders the full diagram. See docs/STATE_AND_PERSISTENCE.md.
 */

import { create } from 'zustand';

interface ShortlistStoreState {
    /** nodeId → current display index */
    indexes: Record<string, number>;
}

interface ShortlistStoreActions {
    /**
     * Advances the index for nodeId by one, wrapping around at length.
     * Returns the new index.
     */
    cycle: (nodeId: string, length: number) => number;
    /**
     * Sets the index for nodeId to the value from the server (called on mount
     * and whenever the shortlist contents change, e.g. after forge).
     */
    initialize: (nodeId: string, index: number) => void;
    /** Returns the current index for nodeId, or fallback if not yet initialized. */
    getIndex: (nodeId: string, fallback: number) => number;
    /**
     * Returns the full index map — used by getGraph() in react-flow-diagram.tsx
     * to overlay store state onto graph.nodes before saving, without needing a
     * React hook.
     */
    getIndexes: () => Record<string, number>;
}

export const useShortlistStore = create<ShortlistStoreState & ShortlistStoreActions>((set, get) => ({
    indexes: {},

    cycle: (nodeId, length) => {
        if (length === 0) return 0;
        const current = get().indexes[nodeId] ?? 0;
        const next = (current + 1) % length;
        set(state => ({ indexes: { ...state.indexes, [nodeId]: next } }));
        return next;
    },

    initialize: (nodeId, index) => {
        set(state => ({ indexes: { ...state.indexes, [nodeId]: index } }));
    },

    getIndex: (nodeId, fallback) => {
        const stored = get().indexes[nodeId];
        return stored !== undefined ? stored : fallback;
    },

    getIndexes: () => get().indexes,
}));
