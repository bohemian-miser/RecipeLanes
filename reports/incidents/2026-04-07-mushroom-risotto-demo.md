# Postmortem: Mushroom Risotto Demo Failure (2026-04-07)

**Incident ID:** INC-20260407-001
**Date:** April 7, 2026
**Status:** Resolved (Analysis complete, fix pending)
**Recipe ID:** `jD0d5cHqgVuQVD3AMpfH` (Staging)

---

## ⚡ Summary
During a live demo of the Mushroom Risotto recipe, the icon generation pipeline stalled after successfully processing the first 8 ingredients. Remaining ingredients and process steps were stuck in a "pending" state. Manual intervention ("Forging") on a node partially triggered resolution for some but the core issue persisted.

## 🕵️ Root Cause Analysis
The failure was caused by a **synchronous crash in the icon resolution pipeline** due to invalid characters in ingredient names.

Specifically, the ingredient **"1/2 tsp Salt"** contains a forward slash (`/`).
1. `resolveRecipeIcons` is triggered when a recipe is saved.
2. It iterates through all nodes to process them in batches.
3. It calls `queueIconForGeneration(stdName)`, where `stdName` is "1/2 Tsp Salt".
4. `queueIconForGeneration` attempts to create a Firestore document reference:
   `db.collection(DB_COLLECTION_QUEUE).doc("1/2 Tsp Salt")`
5. **Firestore Crash:** The slash is interpreted as a path separator. Firestore throws a `PERMISSION_DENIED` or "Invalid path" error because the resulting path has an odd number of segments (collection/doc/sub-collection).
6. **Cascading Failure:** Because `resolveRecipeIcons` uses `Promise.all` over the map of ingredients, this single error crashes the entire resolution process. All subsequent nodes in the map are never processed, leaving them in a "stuck" `pending` state.

## 📊 Evidence (SDK Exception Reproduction)

When attempting to write to the queue doc for "1/2 Tsp Salt", the Firebase Admin SDK throws the following real unhandled exception, which causes the pipeline to crash:

```text
Error: Value for argument "documentPath" must point to a document, but was "1/2 Tsp Salt".
Your path does not contain an even number of components.
    at CollectionReference.doc (node_modules/@google-cloud/firestore/build/src/reference/collection-reference.js:188:19)
    at FirebaseDataService.queueIconForGeneration (lib/data-service.ts:311:64)
    at FirebaseDataService.resolveRecipeIcons (lib/data-service.ts:512:18)
```

[Node Analysis from Firestore DB state]
- Node 0-7: ✅ OK (Icons exist)
- Node 8-10: ⏳ pending (Valid names, but queued attempts blocked by crash)
- Node 11: 🚨 `1/2 tsp Salt` -> pending (CRASH POINT)
- Node 12-24: ⏳ pending (Never reached in the `Promise.all` loop)

## 🛠️ Proposed Actions

### 1. Immediate Fix (Sanitization)
Update `standardizeIngredientName` in `lib/utils.ts` (or add a `safeId` helper) to sanitize names before using them as Firestore document IDs.
```typescript
// Proposed addition to lib/utils.ts
export function getSafeDocId(name: string): string {
    return standardizeIngredientName(name).replace(/\//g, '_');
}
```

### 2. Pipeline Resilience
Wrap the loop inside `resolveRecipeIcons` and `queueIconForGeneration` in more robust error handling so a single bad ingredient doesn't block the entire recipe. Use `Promise.allSettled` instead of `Promise.all`.

### 3. Investigation Playbook (New Tooling)
New tools have been added to `scripts/investigation/` to automate this analysis for future incidents:
- `analyze-recipe.ts`: Detailed state analysis of a recipe and its ingredients.
- `recipe-logs.ts`: Reconstructs the timeline of generation failures based on DB state.

---
**Reported by:** Gemini CLI SRE
**Owner:** @bohemianmiser
