# State & Persistence Architecture

## The Core Paradigm

There are two distinct categories of state in the recipe editor:

1. **Server-authoritative state** — facts that live in Firestore and need to survive page reload, be visible to other users, or drive background work (Cloud Functions, icon generation queue).
2. **Ephemeral UI state** — transient view choices that only matter while the user is on the page and will be captured naturally the next time a real save happens.

**The rule:** only write to Firestore when you have a server-authoritative fact. Never write for ephemeral UI state changes — those will be persisted for free by the next genuine save.

---

## Data Flow

```
Firestore recipe doc
       │
       │  onSnapshot (app/lanes/page.tsx — listener in the recipe-load useEffect)
       │  ── skips the local write echo (docSnapshot.metadata.hasPendingWrites === true)
       ▼
  mergeSnapshot(currentGraph, meta)   (lib/stores/recipe-store.ts)
       │  ── per-node, reference-preserving merge into the Zustand `graph`
       ▼
  MinimalNode selectors re-render ONLY nodes whose object reference changed
```

`mergeSnapshot` is the **sole Firestore ingestion point** — `onSnapshot` does *not* call `setGraph`. The merge is reference-preserving: a node whose meaningful data is unchanged keeps its existing object reference, so the selector
`useRecipeStore(s => s.graph?.nodes.find(n => n.id === id))` does not fire for it. Only genuinely changed nodes (e.g. a Cloud Function backfilled an icon) get a new reference and re-render. This makes routine remote updates cheap rather than a full-graph rebuild.

> **Historical note:** an earlier design had `onSnapshot` call `setGraph`, with a `useEffect [graph, isDirty]` in `react-flow-diagram.tsx` rebuilding *all* ReactFlow nodes via `setNodes` on every snapshot. That flow is gone — the reference-preserving merge now lives entirely in the store. If you find code or docs referencing it, they are stale.

---

## Save Triggers

Saves are **explicit, user-driven** — there is no background autosave timer.

| Trigger | Code location | Notes |
|---------|--------------|-------|
| Save button | `react-flow-diagram.tsx handleSave()` | Persists full `graph.nodes` including positions, shortlist, index |
| Share button | `react-flow-diagram.tsx handleShare()` | Same as save |
| Node drag-stop | `react-flow-diagram.tsx onNodeDragStop()` | Owner-only autosave on node move |

All three call `performSave()` → `saveRecipeAction(graph, ...)` → writes `graph.nodes` to Firestore.

Because `graph.nodes` includes every node's current `shortlistIndex`, `iconShortlist`, positions, etc., **any field on a node that exists in local React state at save time will be persisted automatically**.

---

## The `isDirty` Flag

When the user has made local edits (node drag, text edit, shortlist cycle, etc.) `isDirty = true`. It is set by user interactions and cleared **only** on a successful save — `mergeSnapshot` never resets it.

`mergeSnapshot` does not consult `isDirty` to decide whether to merge; the protection against clobbering local edits is structural in the merge itself:

- `shortlistIndex` is **preserved** when the node's shortlist contents are unchanged (the user may have cycled locally); it is **reset to the server value** only when the shortlist itself changes (the forge produced a new one).
- Locally deleted nodes are suppressed via `pendingDeletedIds` so a background write (e.g. `resolveRecipeIcons`) cannot resurrect a node the user just deleted before the autosave propagates.

This is what lets icon generation results (written by Cloud Functions) appear in the UI while the user is mid-edit, without overwriting their work.

---

## What Belongs in Firestore vs. Local State

### Write to Firestore immediately (server-authoritative facts)

- A new icon has been generated and should be globally visible → `icon_index`, `ingredients_new`, and the recipe shortlist via `assignShortlistToRecipe`
- A recipe is being saved by the user
- Impressions / rejections for icon ranking analytics
- Recipe visibility changes

### Keep in local React state only (ephemeral UI)

- **`shortlistIndex`** — which icon the user is *currently looking at*. This is view state. The user cycling through shortlist options is not a server-authoritative event. The index will be written to Firestore the next time the recipe is saved (drag-stop for owners, or Save button).
- Node selection state, zoom/pan, long-press mode, UI spinners

---

## Shortlist Cycling (resolved — kept as a cautionary tale)

There used to be an `updateShortlistIndexAction` that ran a **Firestore read-modify-write transaction on the full recipe doc every time the user cycled the shortlist icon**. That triggered `onSnapshot` → a full-graph rebuild (~300ms round-trip, perceived as lag) for what is purely ephemeral view state.

This is gone. Cycling now goes through `cycleShortlist` in the store, which mutates `shortlistIndex` on the one affected node in place (preserving every other node's reference), applies optimistically, and is persisted on the next genuine save. **Do not reintroduce a per-cycle Firestore write** — `shortlistIndex` is ephemeral UI state (see above).

---

## Impression Tracking

Impressions are recorded when a user sees an icon for the first time in a cycle. They are written to `ingredients_new` (not the recipe doc) and are genuinely server-authoritative (analytics data, not view state). They should be recorded as fire-and-forget — no need to block the UI or involve a recipe transaction.

When decoupling shortlist cycling from Firestore, keep impression recording but move it to a standalone lightweight action that touches only `ingredients_new`.

---

## Cloud Function ↔ UI Sync

The `onSnapshot` listener exists primarily so that Cloud Function results (icon generation) appear in the UI without requiring a manual refresh. `mergeSnapshot`'s reference-preserving merge is specifically designed for this: it grafts new icon data onto existing nodes without touching positions or other local edits.

This means you *can* write icon data to the recipe doc from Cloud Functions and it will appear automatically — but only write from the client when you have a user-initiated save event.
