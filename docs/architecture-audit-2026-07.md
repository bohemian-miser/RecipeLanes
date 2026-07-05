# Architecture & Correctness Audit — July 2026

Scope: the load-bearing sync/save/merge core — `lib/stores/recipe-store.ts`,
`lib/data-service.ts`, `app/lanes/page.tsx`,
`components/recipe-lanes/react-flow-diagram.tsx` (+ its save hooks), and the LLM
boundaries `lib/recipe-lanes/parser.ts` / `adjuster.ts`. Audited at `main`
@ `1a17595`. All line references are against that commit.

Motivation: the June review (docs/architecture-review-2026-06.md) fixed the
autosave jitter (echo-suppression + debounce are now in place and working), but
the recent "CI-green-but-wrong" worker PRs (#202/#204) showed the remaining
failure class: **races and lost updates between the client's whole-graph save
path and the server's background icon writes** — bugs a unit test of either
subsystem alone will never catch. This audit hunts that class specifically.

---

## Invariants that must NOT change (why the store is load-bearing)

Any fix below must preserve these, and any test for these areas should assert
them explicitly:

1. **Reference preservation in `mergeSnapshot`/`mergeNode`/`mergeNodes`**
   (`recipe-store.ts:161-225`). Unchanged nodes must come back with the *same
   object identity*, and an unchanged node array with the same array identity.
   Every `MinimalNode` subscribes via
   `useRecipeStore(s => s.graph?.nodes.find(n => n.id === id))`; identity is
   what stops a background Firestore write from re-rendering every node
   (re-render storm = the original jitter bug).
2. **`shortlistIndex` is client-owned unless the shortlist itself changed**
   (`recipe-store.ts:191-198`). A user cycling icons locally must survive
   server writes; a forge that produces a *new* shortlist resets the index.
3. **`pendingDeletedIds` suppression** (`recipe-store.ts:257-271`): locally
   deleted nodes are filtered out of incoming snapshots until Firestore
   confirms the delete, so background icon writes can't resurrect them.
4. **Echo suppression**: the `onSnapshot` listener skips
   `metadata.hasPendingWrites` snapshots (`app/lanes/page.tsx:413`).
5. **Debounced autosave**: all drag-stop saves flow through
   `createAutosaveScheduler` (`useAutosave.ts`), flushed on
   pagehide/unmount.
6. **`isDirty` is never cleared by a snapshot** — only an explicit save clears
   it (`recipe-store.ts:89`).

---

## 1. Latent correctness risks (ranked)

### R1 — `mergeNode`'s "unchanged" comparison covers 6 of ~20 fields; server-only field changes are silently dropped  ✱highest severity

`recipe-store.ts:166-172` decides "structurally identical" from exactly
`text, quantity, unit, visualDescription, x, y` (plus the shortlist key).
`RecipeNode` (`lib/recipe-lanes/types.ts:106-143`) also carries `laneId`,
`type`, `inputs`, `status`, `temperature`, `duration`, `canonicalName`,
`rotation`, `textPos`, `shortlistCycled`, `iconQuery`, `hydeQueries`,
`fastMatches`, `iconTheme`. If a server write changes *only* an uncompared
field while the shortlist key is unchanged, the fast path at
`recipe-store.ts:175` returns the existing node and the change never reaches
the UI.

**Concrete failure:** icon generation fails → the Cloud Function calls
`failRecipeIcon`, which sets `status: 'failed'` and touches nothing else
(`data-service.ts:416-434`). Shortlist key is unchanged (both empty),
structural six are unchanged → fast path → the local node keeps
`status: 'pending'` **forever**; the user sees a spinner that never resolves,
and the next whole-graph client save (see R3) writes `pending` back to
Firestore, erasing the failure server-side too. The same mechanism drops
remote changes to `laneId`/`inputs`/`duration` (multi-device or admin edits).

Likelihood: high (every failed forge). Blast radius: medium-high (stuck UI +
state corruption in Firestore). A unit test of `failRecipeIcon` alone is green;
a unit test of `mergeNode` with the six compared fields is green — exactly the
tested-the-wrong-subsystem class.

### R2 — Client whole-graph saves clobber concurrent server icon writes (lost-update loop)

The client always saves the **entire** graph: `saveRecipe` puts the client's
`graph` into `set(..., {merge: true})` (`data-service.ts:759-761, 837`).
`merge: true` merges maps but **replaces arrays wholesale**, so
`graph.nodes` is last-writer-wins in its entirety. Meanwhile the server writes
nodes in the background: `resolveRecipeIcons` transactionally assigns
shortlists after creation (`data-service.ts:493-505`), forge tasks write
results, `queueIconForGeneration` sets `status: 'pending'`
(`data-service.ts:366-372`).

Any client save built from a graph snapshot taken *before* those writes erases
them. The store's merge makes this worse in the other direction: the
icons-only merge path (`recipe-store.ts:182-189`) splices in only
`iconShortlist`/`shortlistIndex`/`status` and keeps the local node's stale
`fastMatches`/`hydeQueries`/`iconQuery`, so even a client that *received* the
enrichment snapshot saves stale copies of those fields back.

**Concrete failure:** `handleHydrateFastMatches` (`page.tsx:227-257`) depends
on `node.fastMatches` pre-populated at creation
(`actions.ts:292`). One save/merge cycle after any server-side refresh of
those fields, the client's copy wins and the cheap hydrate path degrades to
the expensive full search — silently, forever, for that recipe.

Likelihood: high (the window is every save). Severity: medium-high (data loss
is silent and self-reinforcing).

### R3 — `handleAdjust` saves a graph captured before a multi-second LLM call (worst instance of R2)

`page.tsx:705` captures `graph` when the user hits Enter; the adjust LLM call
takes 5–15 s; then `page.tsx:718` fire-and-forgets
`saveRecipeAction(res.graph, currentId)` where `res.graph` was derived from the
**pre-LLM** graph. Every icon shortlist the server wrote during those seconds
(the busiest write window in the app — right after creation) is erased. The
follow-up snapshot then removes the icons locally too: the adjusted nodes fail
the structural comparison, so `mergeNode`'s third path
(`recipe-store.ts:191`) adopts the incoming (now shortlist-less) nodes.

**User-visible symptom:** icons appear, user asks the chatbot for a tweak,
icons vanish and re-forge. Related-but-distinct from #129 (create-flow race).

Likelihood: high whenever adjust is used in the first minute of a recipe.
Severity: high (visible regression + wasted forge quota).

### R4 — `buildGraphForSave` deletes any store node not currently rendered in ReactFlow

`useSaveAndFork.ts:39-41`: the saved node list is
`graph.nodes.filter(n => currentNodes.some(rn => rn.id === n.id))` — the
*intersection* of store nodes and RF nodes, and `inputs` are rebuilt from RF
edges only. Store nodes that haven't made it into RF yet (a snapshot-merged
node from `addNodeToRecipe`/another tab, or an AI-adjust node during the
5 ms layout `setTimeout` window in `react-flow-diagram.tsx:440-444`) are
**dropped from the save**, i.e. deleted in Firestore by the next debounced
autosave. The reverse hazard also exists: RF is stale after a store update, so
the rebuilt `inputs` can resurrect edges the patch removed.

Likelihood: low-medium per save, but autosave fires constantly; the corruption
is permanent when it hits. Severity: high (silent node deletion).

### R5 — Every confirmed snapshot overwrites `recipeText` and `recipeTitle` (the #204 / #156 class)

`page.tsx:423-424` runs `setRecipeText(currentGraph.originalText || '')` and
`setRecipeTitle(...)` on **every** non-echo snapshot — including the several
background icon-write snapshots that land in the first minute of a recipe's
life. Anything the user is typing into the input box or the title field is
clobbered mid-keystroke, and the draft-persistence effect (`page.tsx:192-194`)
then *persists the clobbered value over the user's draft*. This is the root
cause behind issue #156 and the reason worker PR #204 was green-but-wrong: it
fixed the input clear but not the listener that repopulates it.

Likelihood: high. Severity: medium (lost typing, confusing UX).

### R6 — Both Ctrl+Z handlers fire on the same keypress (two divergent undo systems)

`page.tsx:98-108` binds window Ctrl+Z → Zustand `undoStack`;
`react-flow-diagram.tsx:242-259` binds window Ctrl+Z → `useHistoryManager`'s
RF-node history. When both stacks are non-empty, **one keypress runs both
undos**: the store graph pops one state while RF positions pop a different
state, desynchronizing the two sources that `buildGraphForSave` later
intersects (compounding R4). Redo (Ctrl+Shift+Z / Ctrl+Y) exists only in the
diagram's history, so the two stacks cannot be stepped back in sync.

Likelihood: certain for any user who undoes after both a graph mutation and a
drag. Severity: medium (corrupted layout/graph state, feeds R4).

### R7 — LLM outputs are cast, never validated

- `parseRecipeGraph` defines `RecipeGraphSchema` (`parser.ts:22-40`) and never
  calls it — `parser.ts:252` is `return rawObj as RecipeGraph`.
- `adjustRecipeAction` casts `parsed as RecipePatch` (`actions.ts:521`), and the
  patch schema advertises `updateNodes?: { id: string; [field: string]: any }`
  (`adjuster.ts:28`), which `applyPatch` merges wholesale
  (`model-utils.ts:775` `{ ...n, ...update }`).

**Concrete failures:** a model response with `nodes: undefined` throws deep in
layout instead of a friendly error; duplicate node ids or `inputs` pointing at
nonexistent ids flow straight into Firestore; a hallucinated
`updateNodes: [{ id: "n3", iconShortlist: null, x: "left" }]` corrupts a node's
icon state and coordinates with no guard. `MOCK_AI=true` means tests never
exercise malformed output, so this only fires in production.

Likelihood: low-medium per call, but every parse/adjust is exposed. Severity:
medium-high (unrecoverable graph corruption persisted to Firestore).

### R8 — Missing authorization on write-capable server actions

- `applyIconSearchResultsAction` (`actions.ts:696-731`) rewrites
  `graph.nodes` (shortlists, `status`) of **any** recipe by id with no
  `verifyAuth`/ownership check — server actions run with the Admin SDK, so
  Firestore rules don't apply. Any visitor who learns a recipe id can reset
  the owner's chosen icons.
- `getAllStorageFilesAction` (`actions.ts:482-486`) has its admin check
  commented out ("Removed Admin check"), exposing the full storage listing.

Likelihood: low (needs intent), severity: medium; cheap to fix, so it should
not wait.

### Noted, lower priority

- `saveRecipe`'s update path is a non-transactional read-modify-write
  (`data-service.ts:793-837`): concurrent saves (autosave flush + adjust's
  fire-and-forget) can double-count impression/rejection deltas computed
  against the same stale `oldNodesById`, and the stat increments fire even if
  the graph write subsequently fails.
- The store's `isDirty` (`recipe-store.ts:308`) is written but nothing reads
  it; the *actual* dirty flag lives in `useSaveAndFork`. Two flags with one
  name is a trap for future changes.
- `restoreNodes` (`recipe-store.ts:357-382`) reconstructs `RecipeNode`s from
  RF `data` with `as any`, silently carrying RF-only residue into the model.

---

## 2. Highest-leverage refactors (and what must stay fixed)

The theme across R1–R4 is one architectural gap: **there is no single place
that knows which fields belong to whom.** The client saves everything; the
server writes some fields in the background; the store merges with an ad-hoc
6-field comparison. Every new `RecipeNode` field silently falls into the wrong
bucket. The fix is small and surgical, not a rewrite:

### F1 — Declare field ownership once, derive merge + save from it

Add a single module (`lib/recipe-lanes/node-fields.ts`) declaring three sets:

- **CLIENT-owned** (trusted from the client, preserved through merges):
  `x, y, rotation, textPos, shortlistIndex, shortlistCycled`
- **SERVER-owned** (only the backend writes them; client saves must never
  regress them): `iconShortlist, status, fastMatches, hydeQueries, iconQuery`
- **STRUCTURAL/shared** (last edit wins, compared field-by-field):
  `text, laneId, type, inputs, quantity, unit, canonicalName,
  visualDescription, temperature, duration, iconTheme`

Then:
- `mergeNode` compares **every** field from the declaration (a lint-style
  exhaustiveness check — a `satisfies` mapping over `keyof RecipeNode` — makes
  adding a field without classifying it a compile error). Fast path and
  reference preservation stay byte-for-byte identical in behavior for the
  already-covered fields (**do not degrade invariant #1/#2**).
- `saveRecipe`'s update path takes SERVER-owned fields from the existing doc
  when present (it already loads `oldNodesById` at `data-service.ts:814` — the
  reconciliation is nearly free), which closes R2/R3 at the sink regardless of
  how stale any client is.

This is the one refactor that converts a recurring bug *class* into a type
error. Effort: ~1–2 days across two PRs (store side, save side). Risk: medium,
mitigated by keeping the invariants above as explicit unit tests first.

### F2 — One undo owner, one dirty flag

Remove the page-level Ctrl+Z handler (`page.tsx:98-108`) and the store
`undoStack`, or make the diagram's history the only listener and have it drive
the store. Merge `store.isDirty` and `useSaveAndFork.isDirty` into one flag in
the store. Effort: ~half day. Risk: low.

### F3 — Validate at the LLM boundary

Wire the existing `RecipeGraphSchema` into `parseRecipeGraph` (it's already
written!), add a `RecipePatchSchema` with a **whitelist** of updatable fields
(explicitly excluding `iconShortlist`, `id`-rewrites, and coordinates unless
intended), and return a user-visible "the AI returned something unusable — try
rephrasing" error instead of casting. Effort: ~half day. Risk: low.

### F4 — God-file decomposition (unchanged from the June review, reordered)

The June plan (split `data-service.ts` by domain → page hooks → layout
extraction) remains right, but **F1 should land first**: it shrinks and
clarifies exactly the code the split will move, and the split PRs then move
already-correct code. During the `lanes/page.tsx` hook extraction, fold the
listener callback (R5) into a `useRecipeSubscription` hook whose contract is
"merge into store; never touch input-box state after first load."

### What must NOT be "improved" along the way

- Do not replace `mergeSnapshot`'s manual merge with a generic deep-merge or
  immer — object identity per node is the render-performance contract.
- Do not remove the `hasPendingWrites` skip or "fix" it to also process echo
  snapshots.
- Do not make autosave immediate again (the scheduler exists precisely to
  batch drag-stops).
- `buildGraphForSave`'s deliberate `graph.layouts` mutation is pinned by
  `tests/layout-saving.test.ts` (see its header comment); change behavior only
  with that test.

---

## 3. Sequenced remediation plan (one worker-sized, testable unit each)

Ordered by (severity × cheapness). Items 1–6 are independent; 7–9 build on 6.

| # | Task | Fix | Proof test | Effort | Risk |
|---|------|-----|-----------|--------|------|
| 1 | **Single Ctrl+Z owner** (R6) | Remove page-level handler + store `undoStack` usage on /lanes; diagram history is sole owner | e2e: drag node, adjust via chat, press Ctrl+Z once → exactly one state reverts; store graph and RF positions agree | S | Low |
| 2 | **Auth on icon-write actions** (R8) | `verifyAuth` + ownership (mirror `rejectRecipeIcon`'s check) in `applyIconSearchResultsAction`; restore admin check in `getAllStorageFilesAction` | integration: non-owner call returns error and leaves `graph.nodes` untouched | S | Low |
| 3 | **Snapshot must stop clobbering input/title** (R5, closes #156's root cause) | In the `onSnapshot` callback, set `recipeText`/`recipeTitle` only on first load of a recipe (or when the field is not focused/dirty) | e2e: load recipe, type in input box, trigger a background icon write → typed text survives; title mid-edit survives | S | Low |
| 4 | **Validate LLM output** (R7/F3) | Enable `RecipeGraphSchema.safeParse` in `parseRecipeGraph`; add `RecipePatchSchema` with field whitelist for `updateNodes` | unit: malformed fixtures (missing `nodes`, dup ids, `updateNodes` touching `iconShortlist`) → clean error, graph unchanged | S/M | Low |
| 5 | **`handleAdjust` must not save a stale base** (R3) | Apply the patch to the *current* store graph after the LLM returns (return the patch to the client, or re-fetch latest before save); drop the pre-LLM capture | emulator integration: create recipe → server writes shortlist during a delayed mock adjust → adjust save → shortlists still present in Firestore | M | Med |
| 6 | **Exhaustive field classification + `mergeNode` coverage** (R1/F1a) | `node-fields.ts` with compile-time exhaustiveness; `mergeNode` compares all structural fields, splices all server-owned fields in the icons-only path | unit: server-only `status:'failed'` change is merged (spinner→failed); `laneId` change merged; unchanged node keeps identity (invariant test); local cycle survives enrichment | M | Med |
| 7 | **Server-owned field reconciliation in `saveRecipe`** (R2/F1b) | Update path prefers existing doc's SERVER-owned node fields over the client's copies | emulator integration: create → `resolveRecipeIcons` writes shortlist+fastMatches → save a *stale* client graph → enrichment survives in Firestore | M | Med |
| 8 | **`buildGraphForSave` stops dropping store-only nodes** (R4) | Save the union: store nodes not in RF keep their store positions/inputs instead of being filtered out | unit: store has node absent from RF → saved graph contains it; e2e: add node via second client mid-drag → autosave doesn't delete it | M | Med |
| 9 | **Transactional `saveRecipe` update path** | Wrap read-check-write in `db.runTransaction`; move impression/rejection side-effects after commit | emulator integration: two concurrent saves → deltas counted once | M | Low |
| 10 | **God-file splits** (F4, June plan §3) | data-service by domain → page hooks (incl. `useRecipeSubscription`) → layout engines to `lib/layout/` | behavior-preserving; existing suite + one new pure-layout unit test per engine | L | Med |

Notes for the cloud worker: items 3, 5, 6, 7, 8 are precisely the class where
a green unit test can lie — each MUST land with the listed *cross-subsystem*
test (emulator or e2e) proving the user-visible outcome, per the
review-loop rule in CLAUDE.md.

---

*Cross-references: #156 (symptom of R5), #129 (sibling race in the create
flow), #98 (undo UX, adjacent to R6), #205 (Firestore validation — R7's server-side
complement), docs/architecture-review-2026-06.md (June roadmap; jitter fix
verified landed).*
