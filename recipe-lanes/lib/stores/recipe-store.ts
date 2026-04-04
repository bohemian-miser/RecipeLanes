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
 * Central Zustand store for recipe state.
 *
 * ## Design principles
 *
 * - `graph` is the single source of truth. `graph.nodes[i].shortlistIndex` IS
 *   the current display index — there is no separate indexes map.
 * - `mergeSnapshot` is the only function that receives Firestore data. It
 *   preserves local state (shortlistIndex, position overrides) for fields that
 *   the user may have changed since the last save, and updates the rest.
 * - `cycleShortlist` mutates `shortlistIndex` on the relevant node in place,
 *   preserving object references for all other nodes so MinimalNode selectors
 *   do not fire unnecessarily.
 * - `isDirty` is true when the local graph differs from what Firestore has.
 *   It is set by user interactions (node drag, cycle, text edit) and cleared
 *   on successful save.
 *
 * ## Selector pattern for MinimalNode
 *
 *   const node = useRecipeStore(s => s.graph?.nodes.find(n => n.id === id));
 *
 * Because cycleShortlist creates a new object only for the cycled node,
 * unchanged nodes keep their reference and their MinimalNode does not re-render.
 *
 * See docs/STATE_AND_PERSISTENCE.md for the full picture.
 */

import { create } from 'zustand';
import { RecipeGraph, RecipeNode } from '../recipe-lanes/types';
import { getNodeShortlistKey } from '../recipe-lanes/model-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecipeStatus = 'idle' | 'loading' | 'complete' | 'error';

interface RecipeState {
    graph: RecipeGraph | null;
    recipeId: string | null;
    status: RecipeStatus;
    error: string | null;
    ownerId: string | null;
    ownerName: string | null;
    isDirty: boolean;
}

interface RecipeActions {
    /**
     * Merges an incoming Firestore snapshot into the store.
     *
     * Rules applied per-node:
     * - If nothing meaningful changed, the existing node object reference is
     *   kept so downstream selectors do not re-render.
     * - shortlistIndex is preserved when the shortlist contents are unchanged
     *   (user may have cycled locally). It is reset to the server value when
     *   the shortlist itself changes (forge produced a new one).
     * - isDirty is NOT reset by a snapshot — only an explicit save resets it.
     */
    mergeSnapshot: (
        incoming: RecipeGraph,
        meta?: { ownerId?: string; ownerName?: string },
    ) => void;

    setRecipeId: (id: string | null) => void;
    setStatus: (status: RecipeStatus) => void;
    setError: (error: string | null) => void;
    setDirty: (dirty: boolean) => void;

    /**
     * Advances shortlistIndex on the named node by one, wrapping at `length`.
     * All other nodes keep their existing object reference.
     */
    cycleShortlist: (nodeId: string, length: number) => void;

    /**
     * Applies a local graph mutation (serves scaling, JSON edit, etc.).
     * Marks the recipe dirty — use mergeSnapshot for Firestore data.
     */
    setGraph: (graph: RecipeGraph) => void;

    /** Clears all state — call when the user navigates away from a recipe. */
    reset: () => void;
}

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

/**
 * Merges one incoming node with the locally-held version.
 * Returns the existing reference unchanged when nothing meaningful differs,
 * so Zustand selectors subscribed to that node do not re-render.
 */
function mergeNode(existing: RecipeNode, incoming: RecipeNode): RecipeNode {
    const existingShortlistKey = getNodeShortlistKey(existing);
    const incomingShortlistKey = getNodeShortlistKey(incoming);
    const shortlistChanged = existingShortlistKey !== incomingShortlistKey;

    // Fast path: nothing we care about changed → keep exact reference.
    if (
        !shortlistChanged &&
        existing.text === incoming.text &&
        existing.quantity === incoming.quantity &&
        existing.unit === incoming.unit &&
        existing.visualDescription === incoming.visualDescription
    ) {
        return existing;
    }

    return {
        ...incoming,
        // When the shortlist was regenerated (forge), the server resets index
        // to 0. Otherwise preserve whatever the user has locally.
        shortlistIndex: shortlistChanged
            ? (incoming.shortlistIndex ?? 0)
            : existing.shortlistIndex,
    };
}

function mergeNodes(
    existing: RecipeNode[],
    incoming: RecipeNode[],
): RecipeNode[] {
    // Build a lookup map so merging is O(n) not O(n²).
    const existingById = new Map(existing.map(n => [n.id, n]));
    const merged = incoming.map(n => {
        const ex = existingById.get(n.id);
        return ex ? mergeNode(ex, n) : n;
    });

    // Return the original array reference if nothing actually changed.
    const changed = merged.some((n, i) => n !== existing[i] || existing.length !== incoming.length);
    return changed ? merged : existing;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const initialState: RecipeState = {
    graph: null,
    recipeId: null,
    status: 'idle',
    error: null,
    ownerId: null,
    ownerName: null,
    isDirty: false,
};

export const useRecipeStore = create<RecipeState & RecipeActions>((set, get) => ({
    ...initialState,

    mergeSnapshot: (incoming, meta) => {
        const state = get();

        // First load: accept wholesale.
        if (!state.graph) {
            set({
                graph: incoming,
                status: 'complete',
                error: null,
                ...(meta?.ownerId !== undefined && { ownerId: meta.ownerId }),
                ...(meta?.ownerName !== undefined && { ownerName: meta.ownerName }),
            });
            return;
        }

        const mergedNodes = mergeNodes(state.graph.nodes, incoming.nodes);
        const newGraph: RecipeGraph = {
            ...incoming,
            // Keep merged node array (preserves local shortlistIndex etc.)
            nodes: mergedNodes,
        };

        set({
            graph: newGraph,
            status: 'complete',
            error: null,
            ...(meta?.ownerId !== undefined && { ownerId: meta.ownerId }),
            ...(meta?.ownerName !== undefined && { ownerName: meta.ownerName }),
        });
    },

    setRecipeId: (id) => set({ recipeId: id }),
    setStatus: (status) => set({ status }),
    setError: (error) => set({ error, status: error ? 'error' : get().status }),
    setDirty: (dirty) => set({ isDirty: dirty }),

    setGraph: (graph) => set({ graph, isDirty: true }),

    cycleShortlist: (nodeId, length) => {
        const state = get();
        if (!state.graph || length === 0) return;

        const nodes = state.graph.nodes.map(n => {
            if (n.id !== nodeId) return n; // preserve reference
            const next = ((n.shortlistIndex ?? 0) + 1) % length;
            return { ...n, shortlistIndex: next };
        });

        set({ graph: { ...state.graph, nodes } });
    },

    reset: () => set(initialState),
}));
