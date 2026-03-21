# Recipe Title Edit: Why Changes Don't Persist

## TL;DR

`handleTitleChange` has an early-return guard `if (newTitle === recipeTitle) return` (line 419). The `onChange` handler on the title input updates `recipeTitle` on every keystroke, so by the time blur/Enter fires, `recipeTitle` already equals `newTitle`. The guard fires immediately and the function exits — **no graph update, no save to DB, ever**.

The JSON editor works because it bypasses this path entirely: it parses the full JSON, calls `setGraph` unconditionally, then calls `saveAndHandleFork`.

---

## The Bug in Detail

**File:** `recipe-lanes/app/lanes/page.tsx`

### Title input (lines 577–585)

```tsx
<input
    value={recipeTitle}
    onChange={(e) => setRecipeTitle(e.target.value)}   // ← updates state on every keystroke
    onBlur={(e) => handleTitleChange(e.target.value)}
    onKeyDown={(e) => e.key === 'Enter' && handleTitleChange(e.currentTarget.value)}
/>
```

Every keystroke calls `setRecipeTitle(e.target.value)`, keeping `recipeTitle` state in sync with what the user is typing.

### handleTitleChange (lines 417–445)

```ts
const handleTitleChange = async (newTitle: string) => {
    setEditingTitle(false);
    if (newTitle === recipeTitle) return;   // ← ALWAYS true — onChange already synced recipeTitle
    // ... setGraph, saveRecipeAction — never reached
};
```

Because `onChange` already set `recipeTitle = newTitle`, the check is always `true`. The function returns on line 419 every single time. Nothing below it ever runs.

### Why the JSON editor works

`handleJsonSave` (lines 212–237) takes a completely different path:

1. Parses the full JSON text (which includes the title)
2. Calls `setGraph(newGraph)` — unconditionally updates graph state
3. Calls `saveAndHandleFork(newGraph)` if logged in — actually writes to Firestore

It never goes through `handleTitleChange`, so the broken early-return guard doesn't affect it.

---

## What the title editor was meant to do

The intended flow was:

1. User clicks title → `editingTitle = true`, input appears
2. User types → `recipeTitle` updates (for controlled input display)
3. User blurs/Enter → `handleTitleChange(newTitle)` is called
4. If `newTitle` is unchanged from the **original** (pre-edit) title → return early (no-op)
5. Otherwise → update graph, save to DB

The bug is that step 4 compares against the *current* `recipeTitle` state (already mutated by `onChange`) rather than the original title at the time editing began. The early-return guard is supposed to skip unchanged titles, but instead it always fires.

---

## Secondary issue (silent failure)

Even if the early return were fixed, the owner-save branch (line 430) doesn't check the return value:

```ts
if (isOwner && currentId) {
    await saveRecipeAction(newGraph, currentId);   // result ignored — errors swallowed silently
}
```

If `saveRecipeAction` returns `{ error: "..." }` (e.g. expired session cookie causes a server-side auth failure → "You are not the owner of this recipe"), there is no notification and no indication to the user that the save failed. The `onSnapshot` Firestore listener (line 279) will eventually overwrite `recipeTitle` back to the old value from the DB, making the title appear to revert for no apparent reason.

The JSON editor shows `"JSON saved."` only when `res.id` is truthy (line 231), so it at least has a success confirmation (though failures are equally silent there).
