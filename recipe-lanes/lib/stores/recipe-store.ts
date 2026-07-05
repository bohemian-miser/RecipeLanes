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
import { RecipeGraph, RecipeNode, IconStyleId, LineStyleId, LayoutModeId, BackgroundElementId, ChatMessage } from '../recipe-lanes/types';
import { getNodeShortlistKey, cycleShortlistNodes } from '../recipe-lanes/model-utils';

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
    iconStyle: IconStyleId;
    lineStyle: LineStyleId;
    nodeLayout: LayoutModeId;
    /** When true, leaf nodes (out-degree 0, e.g. the finished dish) render smaller. Global view setting. */
    smallerLeafNodes: boolean;
    backgrounds: BackgroundElementId[];
    activePresetId: string;
    undoStack: RecipeGraph[];
    messages: ChatMessage[];
    /**
     * Node IDs deleted locally that have not yet been confirmed absent in a
     * Firestore snapshot.  mergeSnapshot filters these out of incoming data so
     * that background writes (e.g. resolveRecipeIcons) cannot resurrect a node
     * the user just deleted before the autosave has propagated to Firestore.
     */
    pendingDeletedIds: string[];
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
    cycleShortlist: (nodeId: string) => void;

    /**
     * Applies a local graph mutation (serves scaling, JSON edit, etc.).
     * Marks the recipe dirty — use mergeSnapshot for Firestore data.
     */
    setGraph: (graph: RecipeGraph) => void;

    /**
     * Pushes the current graph onto the undo stack, then applies the mutation.
     * Call this before any user-initiated change that should be undoable.
     */
    setGraphWithUndo: (graph: RecipeGraph) => void;

    /** Pops the last snapshot from the undo stack and restores it. */
    undo: () => void;

    addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
    clearMessages: () => void;

    /**
     * Records a locally-deleted node ID so mergeSnapshot can suppress any
     * incoming Firestore writes that would resurrect it (e.g. resolveRecipeIcons
     * writing icon data back before the delete autosave has propagated).
     * The ID is cleared automatically when a snapshot arrives that no longer
     * contains the node, confirming the delete reached Firestore.
     */
    markNodeDeleted: (nodeId: string) => void;

    /**
     * Restores nodes that were previously marked as deleted (e.g. on undo).
     * Clears the node IDs from pendingDeletedIds and merges the nodes back into
     * the graph, so that mergeSnapshot and the layout effect see a consistent state.
     * rfNodes should be the ReactFlow node objects from the undo snapshot; their
     * data fields are used to reconstruct the RecipeNode entries.
     */
    restoreNodes: (rfNodes: any[]) => void;

    /** Clears all state — call when the user navigates away from a recipe. */
    reset: () => void;
    setVisualPreset: (presetId: string) => void;
    setIconStyle: (style: IconStyleId) => void;
    setLineStyle: (style: LineStyleId) => void;
    setNodeLayout: (layout: LayoutModeId) => void;
    setSmallerLeafNodes: (smaller: boolean) => void;
    toggleBackground: (bg: BackgroundElementId) => void;
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

    const structurallyIdentical =
        existing.text === incoming.text &&
        existing.quantity === incoming.quantity &&
        existing.unit === incoming.unit &&
        existing.visualDescription === incoming.visualDescription &&
        existing.x === incoming.x &&
        existing.y === incoming.y;

    // Fast path: nothing changed → keep exact reference.
    if (!shortlistChanged && structurallyIdentical) {
        return existing;
    }

    // Icons-only update (resolveRecipeIcons writes back shortlists without touching
    // structure): preserve all local fields, splice in only the icon-related ones.
    // This prevents a server write from overwriting local position/text state.
    if (shortlistChanged && structurallyIdentical) {
        return {
            ...existing,
            iconShortlist: incoming.iconShortlist,
            shortlistIndex: incoming.shortlistIndex ?? 0,
            status: incoming.status,
        };
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
    const incomingIds = new Set(incoming.map(n => n.id));

    const merged = incoming.map(n => {
        const ex = existingById.get(n.id);
        return ex ? mergeNode(ex, n) : n;
    });

    // Preserve locally-added nodes not yet written to Firestore.
    // This prevents a race where resolveRecipeIcons fires a snapshot using the
    // pre-adjustment Firestore state and silently drops nodes added by the AI.
    // Downside: a node deleted on another device will linger until next full reload —
    // acceptable given single-owner editing is the dominant use case.
    const pendingLocal = existing.filter(n => !incomingIds.has(n.id));
    const result = pendingLocal.length > 0 ? [...merged, ...pendingLocal] : merged;

    // Return the original array reference if nothing actually changed.
    const changed = result.length !== existing.length || result.some((n, i) => n !== existing[i]);
    return changed ? result : existing;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const MAX_UNDO_DEPTH = 20;

const initialState: RecipeState = {
    graph: null,
    recipeId: null,
    status: 'idle',
    error: null,
    ownerId: null,
    ownerName: null,
    isDirty: false,
    iconStyle: 'classic',
    lineStyle: 'straight',
    nodeLayout: 'dagre',
    smallerLeafNodes: false,
    backgrounds: [],
    activePresetId: 'classic',
    undoStack: [],
    messages: [],
    pendingDeletedIds: [],
};

export const useRecipeStore = create<RecipeState & RecipeActions>((set, get) => ({
    ...initialState,

    mergeSnapshot: (incoming, meta) => {
        const state = get();

        // Filter out any locally-deleted node IDs from the incoming snapshot.
        // This prevents background Firestore writes (e.g. resolveRecipeIcons
        // updating a node's icon shortlist) from resurrecting a node the user
        // deleted before the autosave has propagated.
        // IDs whose deletion is confirmed (node absent from incoming) are cleared.
        const incomingIdSet = new Set(incoming.nodes.map(n => n.id));
        const stillPendingDeleted = state.pendingDeletedIds.filter(id => incomingIdSet.has(id));
        const filteredIncoming: RecipeGraph = stillPendingDeleted.length > 0
            ? { ...incoming, nodes: incoming.nodes.filter(n => !stillPendingDeleted.includes(n.id)) }
            : incoming;
        // IDs no longer in incoming: deletion reached Firestore — remove from pending list.
        const confirmedDeleted = state.pendingDeletedIds.filter(id => !incomingIdSet.has(id));
        const newPendingDeletedIds = confirmedDeleted.length > 0
            ? state.pendingDeletedIds.filter(id => incomingIdSet.has(id))
            : state.pendingDeletedIds;

        // First load: accept wholesale (filtered).
        if (!state.graph) {
            set({
                graph: filteredIncoming,
                status: 'complete',
                error: null,
                pendingDeletedIds: newPendingDeletedIds,
                ...(meta?.ownerId !== undefined && { ownerId: meta.ownerId }),
                ...(meta?.ownerName !== undefined && { ownerName: meta.ownerName }),
            });
            return;
        }

        const mergedNodes = mergeNodes(state.graph.nodes, filteredIncoming.nodes);
        const newGraph: RecipeGraph = {
            ...filteredIncoming,
            // Keep merged node array (preserves local shortlistIndex etc.)
            nodes: mergedNodes,
        };

        set({
            graph: newGraph,
            status: 'complete',
            error: null,
            pendingDeletedIds: newPendingDeletedIds,
            ...(meta?.ownerId !== undefined && { ownerId: meta.ownerId }),
            ...(meta?.ownerName !== undefined && { ownerName: meta.ownerName }),
        });
    },

    setRecipeId: (id) => set({ recipeId: id }),
    setStatus: (status) => set({ status }),
    setError: (error) => set({ error, status: error ? 'error' : get().status }),
    setDirty: (dirty) => set({ isDirty: dirty }),

    setGraph: (graph) => set({ graph, isDirty: true }),

    setGraphWithUndo: (graph) => set((state) => ({
        graph,
        isDirty: true,
        undoStack: state.graph
            ? [...state.undoStack.slice(-MAX_UNDO_DEPTH + 1), state.graph]
            : state.undoStack,
    })),

    undo: () => set((state) => {
        if (state.undoStack.length === 0) return {};
        const undoStack = [...state.undoStack];
        const graph = undoStack.pop()!;
        return { graph, undoStack, isDirty: true };
    }),

    cycleShortlist: (nodeId) => {
        const state = get();
        if (!state.graph) return;

        const nodes = cycleShortlistNodes(state.graph, nodeId);

        set({ graph: { ...state.graph, nodes } });
    },

    addMessage: ({ role, content }) => set((state) => ({
        messages: [...state.messages, {
            id: crypto.randomUUID(),
            role,
            content,
            timestamp: Date.now(),
        }],
    })),

    clearMessages: () => set({ messages: [] }),

    markNodeDeleted: (nodeId) => set((state) => ({
        pendingDeletedIds: state.pendingDeletedIds.includes(nodeId)
            ? state.pendingDeletedIds
            : [...state.pendingDeletedIds, nodeId],
        // Also remove the node from the local graph immediately so the store
        // is consistent with the ReactFlow state and the layout effect does not
        // see a "new" node (in Zustand but not RF) and call runLayout.
        graph: state.graph
            ? { ...state.graph, nodes: state.graph.nodes.filter(n => n.id !== nodeId) }
            : state.graph,
    })),

    restoreNodes: (rfNodes) => set((state) => {
        if (!state.graph) return {};
        const restoredIds = new Set(rfNodes.map((n: any) => n.id));
        // Clear restored IDs from pendingDeletedIds.
        const newPendingDeletedIds = state.pendingDeletedIds.filter(id => !restoredIds.has(id));
        // Merge restored nodes back into graph: reconstruct RecipeNode from RF data,
        // preserving any existing Zustand node if already present.
        const existingById = new Map(state.graph.nodes.map(n => [n.id, n]));
        const restoredGraphNodes = rfNodes
            .filter((n: any) => restoredIds.has(n.id) && !existingById.has(n.id))
            .map((n: any) => {
                // n.data contains ...originalNode spread at snapshot time.
                // Strip RF-only fields and reconstruct as a RecipeNode.
                const { onDelete, onSetLongPress, textPos, depth, ...nodeData } = n.data || {};
                return { ...nodeData, id: n.id } as any;
            });
        const newNodes = restoredGraphNodes.length > 0
            ? [...state.graph.nodes, ...restoredGraphNodes]
            : state.graph.nodes;
        return {
            pendingDeletedIds: newPendingDeletedIds,
            graph: restoredGraphNodes.length > 0
                ? { ...state.graph, nodes: newNodes }
                : state.graph,
        };
    }),

    reset: () => set(initialState),
    setVisualPreset: (presetId) => set({ activePresetId: presetId }),
    setIconStyle: (iconStyle) => set({ iconStyle, activePresetId: 'custom' }),
    setLineStyle: (lineStyle) => set({ lineStyle, activePresetId: 'custom' }),
    setNodeLayout: (nodeLayout) => set({ nodeLayout, activePresetId: 'custom' }),
    setSmallerLeafNodes: (smallerLeafNodes) => set({ smallerLeafNodes }),
    toggleBackground: (bg) => set((state) => { const backgrounds = state.backgrounds.includes(bg) ? state.backgrounds.filter(b => b !== bg) : [...state.backgrounds, bg]; return { backgrounds, activePresetId: 'custom' }; }),
}));
