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
import { RecipeGraph, RecipeNode, NodeLayout, IconStyleId, LineStyleId, LayoutModeId, BackgroundElementId, CanvasBackgroundId, ChatMessage } from '../recipe-lanes/types';
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
    backgrounds: BackgroundElementId[];
    /** The paper/surface the canvas is drawn on — independent of iconStyle. */
    canvasBackground: CanvasBackgroundId;
    activePresetId: string;
    /**
     * Global setting: scale factor for leaf nodes (nodes with no incoming edge).
     * 1 = normal size; < 1 renders them smaller. Driven by a toolbar slider (#155).
     */
    leafNodeScale: number;
    /**
     * Single undo/redo history for the whole /lanes page (issue #216).
     * Entries are full graph snapshots (nodes with x/y + the layouts map), so
     * one Ctrl+Z reverts exactly one user action — graph edits and node drags
     * share one timeline instead of living in two divergent stacks.
     */
    undoPast: RecipeGraph[];
    undoFuture: RecipeGraph[];
    /**
     * Bumped on every undo/redo. Views subscribe to this to re-apply node
     * positions from the restored graph (a position-only change is otherwise
     * deliberately ignored by the diagram's sync effect).
     */
    historyVersion: number;
    messages: ChatMessage[];
    /**
     * Node IDs deleted locally that have not yet been confirmed absent in a
     * Firestore snapshot.  mergeSnapshot filters these out of incoming data so
     * that background writes (e.g. resolveRecipeIcons) cannot resurrect a node
     * the user just deleted before the autosave has propagated to Firestore.
     */
    pendingDeletedIds: string[];
    /**
     * Node IDs the cook has ticked off while working through the recipe (#281).
     *
     * Deliberately a top-level store field rather than a flag on the RecipeNode:
     * this is per-person, per-cooking-session state, and the save path writes
     * every node field verbatim (data-service has no field whitelist), so a flag
     * on the node would be persisted to Firestore and leak one cook's progress
     * to everyone else viewing a shared recipe.
     */
    completedNodeIds: string[];
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

    /**
     * Steps back one entry in the history. Nodes the step removes are added
     * to pendingDeletedIds (so a background Firestore snapshot cannot
     * resurrect them before the follow-up save lands); nodes it restores are
     * cleared from pendingDeletedIds. Bumps historyVersion so views re-apply
     * positions from the restored graph.
     */
    undo: () => void;

    /** Steps forward again after an undo. Same reconciliation as undo. */
    redo: () => void;

    /**
     * Records the rendered node positions for a layout mode WITHOUT pushing a
     * history entry or marking the recipe dirty. Called by views after every
     * layout pass so the store graph always mirrors what is on screen — the
     * precondition for history snapshots capturing correct positions.
     */
    syncNodePositions: (mode: string, positions: NodeLayout[]) => void;

    /**
     * User-initiated position change (drag stop): pushes a history entry with
     * the pre-move graph, then applies the positions to graph.nodes x/y and
     * graph.layouts[mode], and marks the recipe dirty.
     */
    commitNodePositions: (mode: string, positions: NodeLayout[]) => void;

    /**
     * Pushes a history entry of the current graph without changing anything
     * else. For view-initiated wholesale position changes (layout reset,
     * entering physics mode) where the new positions only exist in the view
     * until the next syncNodePositions.
     */
    pushUndoSnapshot: () => void;

    /**
     * User-initiated node delete: pushes a history entry, removes the node,
     * bridges its children onto its inputs (every consumer of the deleted
     * node now consumes the node's own inputs — the model-level equivalent of
     * calculateBridgeEdges), and records the id in pendingDeletedIds so
     * background snapshots cannot resurrect it before the save propagates.
     */
    deleteNodeWithUndo: (nodeId: string) => void;

    /**
     * Applies a partial field patch to a single node, pushing the change onto
     * the undo stack so it is undoable. No-op when the graph is missing, the
     * node is absent, or the patch changes nothing. Every other node keeps its
     * existing object reference (so per-node selectors don't re-render).
     */
    updateNode: (nodeId: string, patch: Partial<RecipeNode>) => void;

    /**
     * Sets a single node's visualDescription (the text describing what the
     * node's icon should depict). Thin wrapper over updateNode; see it for the
     * undo / no-op / reference-preservation semantics.
     */
    updateNodeVisualDescription: (nodeId: string, visualDescription: string) => void;

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
     * Clears the given node IDs from pendingDeletedIds without touching the
     * graph. Used by views whose undo restores a whole prior graph snapshot
     * directly (e.g. the notation/timeline view): once the nodes are back in
     * the graph, their pending-delete flags must be cleared so mergeSnapshot
     * does not immediately re-suppress them on the next Firestore snapshot.
     */
    unmarkNodesDeleted: (ids: string[]) => void;

    /**
     * Toggles the "done" tick on a node (#281). Purely local view state: it
     * leaves `graph` untouched, does not mark the recipe dirty, and is never
     * written to Firestore. Unknown node IDs are accepted — a tick simply has
     * no effect until a node with that ID exists.
     */
    toggleNodeCompleted: (nodeId: string) => void;

    /**
     * Un-ticks every node at once — backs the "clear ticks" toolbar button,
     * which activates as soon as anything is ticked. Same purely-local
     * semantics as toggleNodeCompleted.
     */
    clearCompletedNodes: () => void;

    /** Clears all state — call when the user navigates away from a recipe. */
    reset: () => void;
    setVisualPreset: (presetId: string) => void;
    setIconStyle: (style: IconStyleId) => void;
    setLineStyle: (style: LineStyleId) => void;
    setNodeLayout: (layout: LayoutModeId) => void;
    toggleBackground: (bg: BackgroundElementId) => void;
    setLeafNodeScale: (scale: number) => void;
    setCanvasBackground: (bg: CanvasBackgroundId) => void;
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

    // x/y are CLIENT-owned: the store mirrors the rendered positions
    // (syncNodePositions after every layout pass), so a background snapshot
    // whose x/y differ must neither break node identity (that re-renders
    // every node on every icon write) nor clobber the mirror (a later history
    // snapshot would then capture coordinates the user never saw). Saved
    // positions are restored via graph.layouts at load, not via node x/y.
    const structurallyIdentical =
        existing.text === incoming.text &&
        existing.quantity === incoming.quantity &&
        existing.unit === incoming.unit &&
        existing.visualDescription === incoming.visualDescription;

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
        // Keep the client-owned position mirror once it exists (see above);
        // adopt the incoming coordinates only when there is no local mirror
        // yet (e.g. a node this client has never rendered).
        x: existing.x !== undefined ? existing.x : incoming.x,
        y: existing.y !== undefined ? existing.y : incoming.y,
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
// History helpers
// ---------------------------------------------------------------------------

const MAX_UNDO_DEPTH = 20;

/**
 * Snapshot a graph for the history stacks. Node arrays are immutably managed
 * throughout the store, so sharing them is safe; the layouts map is shallow-
 * cloned defensively because callers outside the store receive the live graph
 * object and could mutate the map in place.
 */
function snapshotForHistory(graph: RecipeGraph): RecipeGraph {
    return graph.layouts ? { ...graph, layouts: { ...graph.layouts } } : graph;
}

/** The undo-stack partial produced by every history-pushing mutation. */
function pushHistory(state: RecipeState, graph: RecipeGraph | null) {
    return graph
        ? {
              undoPast: [...state.undoPast.slice(-MAX_UNDO_DEPTH + 1), snapshotForHistory(graph)],
              undoFuture: [] as RecipeGraph[],
          }
        : {};
}

/**
 * Shared undo/redo transition: restore `restored` as the live graph and
 * reconcile pendingDeletedIds — ids the step removes are suppressed from
 * incoming snapshots (they would otherwise be resurrected by any background
 * icon write until the follow-up save propagates); ids the step restores are
 * un-suppressed.
 */
function historyTransition(state: RecipeState, restored: RecipeGraph) {
    const restoredIds = new Set(restored.nodes.map(n => n.id));
    const removedByStep = state.graph
        ? state.graph.nodes.map(n => n.id).filter(id => !restoredIds.has(id))
        : [];
    const pendingDeletedIds = [
        ...state.pendingDeletedIds.filter(id => !restoredIds.has(id)),
        ...removedByStep.filter(id => !state.pendingDeletedIds.includes(id)),
    ];
    return {
        graph: restored,
        isDirty: true,
        pendingDeletedIds,
        historyVersion: state.historyVersion + 1,
    };
}

/**
 * Apply a set of rendered positions to graph.nodes x/y — and, for user
 * commits, to graph.layouts[mode]. The passive sync path must NOT touch the
 * layouts map: the diagram's "saved layouts just arrived" detection compares
 * graph.layouts[mode] against null, and a passive mirror writing it would
 * mask genuinely-saved layouts arriving in a later snapshot.
 * Returns null when nothing actually changed so callers can no-op (keeping
 * object references stable for selector subscriptions).
 */
function applyPositions(
    graph: RecipeGraph,
    mode: string,
    positions: NodeLayout[],
    includeLayouts: boolean,
): RecipeGraph | null {
    const posById = new Map(positions.map(p => [p.id, p]));
    let nodesChanged = false;
    const nodes = graph.nodes.map(n => {
        const p = posById.get(n.id);
        if (!p || (n.x === p.x && n.y === p.y)) return n;
        nodesChanged = true;
        return { ...n, x: p.x, y: p.y };
    });
    if (!includeLayouts) {
        return nodesChanged ? { ...graph, nodes } : null;
    }
    const prev = graph.layouts?.[mode];
    const layoutChanged =
        !prev ||
        prev.length !== positions.length ||
        positions.some((p, i) => {
            const q = prev[i];
            return !q || q.id !== p.id || q.x !== p.x || q.y !== p.y;
        });
    if (!nodesChanged && !layoutChanged) return null;
    return {
        ...graph,
        nodes: nodesChanged ? nodes : graph.nodes,
        layouts: {
            ...(graph.layouts || {}),
            [mode]: positions.map(p => ({ id: p.id, x: p.x, y: p.y })),
        },
    };
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
    iconStyle: 'classic',
    lineStyle: 'straight',
    nodeLayout: 'dagre',
    backgrounds: [],
    canvasBackground: 'default',
    activePresetId: 'classic',
    leafNodeScale: 1,
    undoPast: [],
    undoFuture: [],
    historyVersion: 0,
    messages: [],
    pendingDeletedIds: [],
    completedNodeIds: [],
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
        ...pushHistory(state, state.graph),
    })),

    undo: () => set((state) => {
        if (state.undoPast.length === 0 || !state.graph) return {};
        const restored = state.undoPast[state.undoPast.length - 1];
        return {
            ...historyTransition(state, restored),
            undoPast: state.undoPast.slice(0, -1),
            undoFuture: [snapshotForHistory(state.graph), ...state.undoFuture].slice(0, MAX_UNDO_DEPTH),
        };
    }),

    redo: () => set((state) => {
        if (state.undoFuture.length === 0 || !state.graph) return {};
        const [restored, ...undoFuture] = state.undoFuture;
        return {
            ...historyTransition(state, restored),
            undoFuture,
            undoPast: [...state.undoPast.slice(-MAX_UNDO_DEPTH + 1), snapshotForHistory(state.graph)],
        };
    }),

    syncNodePositions: (mode, positions) => set((state) => {
        if (!state.graph) return {};
        const next = applyPositions(state.graph, mode, positions, false);
        // Passive mirror of the rendered layout: no history entry, no dirty
        // flag — this runs after every layout pass, including for viewers.
        return next ? { graph: next } : {};
    }),

    commitNodePositions: (mode, positions) => set((state) => {
        if (!state.graph) return {};
        const next = applyPositions(state.graph, mode, positions, true);
        if (!next) return {};
        return {
            graph: next,
            isDirty: true,
            ...pushHistory(state, state.graph),
        };
    }),

    pushUndoSnapshot: () => set((state) => pushHistory(state, state.graph)),

    deleteNodeWithUndo: (nodeId) => set((state) => {
        if (!state.graph) return {};
        const victim = state.graph.nodes.find(n => n.id === nodeId);
        if (!victim) return {};
        const victimInputs = victim.inputs || [];
        // Bridge children onto the deleted node's inputs (model-level
        // calculateBridgeEdges: every consumer of the victim now consumes the
        // victim's own inputs).
        const nodes = state.graph.nodes
            .filter(n => n.id !== nodeId)
            .map(n => {
                if (!n.inputs?.includes(nodeId)) return n;
                const bridged = [
                    ...n.inputs.filter(i => i !== nodeId),
                    ...victimInputs.filter(i => i !== n.id && !n.inputs!.includes(i)),
                ];
                return { ...n, inputs: bridged };
            });
        return {
            graph: { ...state.graph, nodes },
            isDirty: true,
            ...pushHistory(state, state.graph),
            pendingDeletedIds: state.pendingDeletedIds.includes(nodeId)
                ? state.pendingDeletedIds
                : [...state.pendingDeletedIds, nodeId],
        };
    }),

    updateNode: (nodeId, patch) => {
        const { graph, setGraphWithUndo } = get();
        if (!graph) return;
        const idx = graph.nodes.findIndex(n => n.id === nodeId);
        if (idx === -1) return;
        const node = graph.nodes[idx];
        // No-op if the patch changes nothing (avoids a spurious undo entry).
        const changed = (Object.keys(patch) as (keyof RecipeNode)[])
            .some(k => node[k] !== patch[k]);
        if (!changed) return;
        // Replace only the edited node; all other nodes keep their reference so
        // the per-node selector subscriptions do not needlessly re-render.
        const nodes = graph.nodes.slice();
        nodes[idx] = { ...node, ...patch };
        setGraphWithUndo({ ...graph, nodes });
    },

    updateNodeVisualDescription: (nodeId, visualDescription) => {
        get().updateNode(nodeId, { visualDescription });
    },

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

    unmarkNodesDeleted: (ids) => set((state) => {
        if (state.pendingDeletedIds.length === 0) return {};
        const idSet = new Set(ids);
        const filtered = state.pendingDeletedIds.filter(id => !idSet.has(id));
        // No-op if none of the given IDs were pending — keep the reference stable.
        return filtered.length === state.pendingDeletedIds.length
            ? {}
            : { pendingDeletedIds: filtered };
    }),

    // NOTE (issue #276/#277 heritage): the old RF-snapshot undo needed a
    // `restoreNodes` action that reconstructed RecipeNodes from ReactFlow
    // node data and had to filter out synthetic decoration (lane bands,
    // notation stations). The single store-level history makes that entire
    // class impossible: history entries are graph snapshots, and synthetic
    // nodes never enter graph.nodes in the first place.

    toggleNodeCompleted: (nodeId) => set((state) => ({
        completedNodeIds: state.completedNodeIds.includes(nodeId)
            ? state.completedNodeIds.filter(id => id !== nodeId)
            : [...state.completedNodeIds, nodeId],
    })),

    // Keep the existing array reference when there is nothing to clear, so
    // subscribers of completedNodeIds do not re-render on a no-op.
    clearCompletedNodes: () => set((state) => (
        state.completedNodeIds.length === 0 ? {} : { completedNodeIds: [] }
    )),

    reset: () => set(initialState),
    setVisualPreset: (presetId) => set({ activePresetId: presetId }),
    setIconStyle: (iconStyle) => set({ iconStyle, activePresetId: 'custom' }),
    setLineStyle: (lineStyle) => set({ lineStyle, activePresetId: 'custom' }),
    setNodeLayout: (nodeLayout) => set({ nodeLayout, activePresetId: 'custom' }),
    toggleBackground: (bg) => set((state) => { const backgrounds = state.backgrounds.includes(bg) ? state.backgrounds.filter(b => b !== bg) : [...state.backgrounds, bg]; return { backgrounds, activePresetId: 'custom' }; }),
    setLeafNodeScale: (scale) => set({ leafNodeScale: scale }),
    setCanvasBackground: (canvasBackground) => set({ canvasBackground }),
}));
