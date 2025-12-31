# Sharing, Forking, and Override Policies

This document outlines the state machine and user experience logic for handling shared recipes. The core philosophy is **"Safe Viewing, Explicit Saving."** Users should never accidentally modify a recipe they don't own, nor should they accidentally overwrite their own distinct copies without confirmation.

## 1. Data Model Requirements

To support this logic, the Recipe document in Firestore must support lineage tracking:

```typescript
interface Recipe {
  id: string;
  ownerId: string; // The creator
  isPublic: boolean;
  
  // Forking Metadata
  copiedFromId?: string; // ID of the parent recipe
  copiedFromVersion?: number; // (Optional) For future diffing
  
  // ... graph data
}
```

## 2. State Machine & UX Logic

### Case A: Loading a Recipe (The Entry Point)

When a user loads `/lanes?id=XYZ`:

**1. Is the User the Owner? (`auth.uid === recipe.ownerId`)**
*   **State:** `EDIT_MODE`
*   **UI:** No banners. Autosave is active. Full interactability.
*   **Logic:** Standard behavior.

**2. Is the User a Guest (Not Owner)?**
*   **Action:** Query DB for existing copies owned by `auth.uid` where `copiedFromId === XYZ`.

#### Sub-Case A.1: First Time Visitor (No copies found)
*   **State:** `READ_ONLY` (View Mode)
*   **UI - Top Banner:** "You are viewing a shared recipe. Changes you make will not be saved to the original."
    *   [Primary Button]: **"Save to my Library"** (Creates a Copy)
*   **Interactions:** 
    *   Users *can* drag nodes or change filters locally (client-side state), but Autosave is **DISABLED**.
    *   If a user performs a destructive action (Edit text, Add node), trigger the **"Fork Prompt"** (see below).

#### Sub-Case A.2: Returning Visitor (One copy found)
*   **State:** `READ_ONLY`
*   **UI - Top Banner:** "You have a saved copy of this recipe."
    *   [Primary Button]: **"Go to my Copy"** (Redirects to the user's version)
    *   [Secondary Button]: **"Save as New Copy"** (Creates a duplicate, useful for "V2" iterations)

#### Sub-Case A.3: Power User (Multiple copies found)
*   **State:** `READ_ONLY`
*   **UI - Top Banner:** "You have multiple versions of this recipe."
    *   [Dropdown/Modal]: List copies (showing timestamps or titles).
    *   [Button]: **"Save Another Copy"**

---

### Case B: The "Save" Action (Forking)

When the user clicks "Save to my Library" or triggers the **Fork Prompt**:

**Logic:**
1.  Create a NEW document in `recipes` collection.
2.  Set `ownerId` = Current User.
3.  Set `copiedFromId` = Original Recipe ID.
4.  Set `title` = "Copy of [Original Title]" (User can rename later).
5.  **Redirect** the browser to the NEW Recipe ID.
6.  **Toast:** "Recipe saved to your library. You can now edit freely."

---

### Case C: The "Overwrite" Scenario (Saving changes to an existing copy)

*Scenario:* User is viewing the *Original* (A), but they already have a *Copy* (B). They start dragging nodes around on (A) and hit "Save".

**We do NOT support overwriting Copy (B) while viewing Original (A).**
*   *Why?* It is destructive and confusing. The user might have made intentional changes to (B) that they forgot about.
*   *Policy:* We always treat interactions on the Original as a request for a **New Copy** or a **Redirect**.

**Refined Logic for "Edit Attempt on Read-Only":**
If a user tries to edit text or add a node while in `READ_ONLY` mode:
1.  **Block the action** (or pause it).
2.  **Modal:** "Edit this recipe?"
    *   "This is a shared recipe. To make changes, you need your own copy."
    *   If (No Existing Copy): Button **"Create Copy & Edit"**
    *   If (Has Existing Copy): Buttons **"Edit My Existing Copy"** (Redirect) OR **"Create Brand New Copy"**

---

### Case D: Anonymous / Unauthenticated Users

*   **State:** `READ_ONLY`
*   **UI:** "Log in to save a copy of this recipe."
*   **Interaction:** 
    *   Allow purely local play (dragging nodes).
    *   If "Save" or "Edit" is attempted -> Trigger **Login Modal**.
    *   *Post-Login Hook:* If they logged in from this specific recipe page, immediately trigger the **Forking Logic** (Case B) so they don't lose context.

---

## 3. Summary of UI States

| User Status | Relation to Recipe | Existing Copies? | Mode | Banner / Action |
| :--- | :--- | :--- | :--- | :--- |
| **Owner** | Creator | N/A | **Edit** | None (Autosave On) |
| **Auth User** | Visitor | **No** | **Read-Only** | "Save to Library" |
| **Auth User** | Visitor | **Yes (1)** | **Read-Only** | "Go to my Copy" / "Save New" |
| **Auth User** | Visitor | **Yes (Many)** | **Read-Only** | "Select Copy" / "Save New" |
| **Guest** | Visitor | N/A | **Read-Only** | "Login to Save" |

## 4. Edge Cases & Safety

1.  **Deleted Original:** If the original owner deletes the recipe, the `copiedFromId` link remains, but the original link breaks.
    *   *Fix:* Copies are independent. They survive the original's deletion.
2.  **Permission Escalation:** Ensure Firestore Security Rules explicitly prevent writing to a document where `request.auth.uid != resource.data.ownerId`. The frontend UI is just a convenience; the backend rules are the enforcement.
