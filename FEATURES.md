# Recipe Lanes - Feature Roadmap

## 1. User Accounts & Saving
*   **Personal Library:** Allow users to save parsed recipes to their profile.
*   **History:** View previously generated lanes.
*   **Edits:** Allow users to tweak the graph (change text, drag nodes) and save changes.

## 2. Public & Social
*   **Public Gallery:** Make recipes public / sharable via link.
*   **Search:** Search the public database for "Spaghetti", "Cake", etc.
*   **Forking:** "Remix" a public recipe.

## 3. Input Methods
*   **Raw Text:** (Implemented) Paste instructions.
*   **URL Import:** Paste a link to a recipe blog; we scrape and parse it.
*   **Image/Photo:** Upload a picture of a cookbook page.
*   **Audio/Voice:** Dictate a recipe.

## 4. Mobile Experience & Layout
*   **Responsive Graph:**
    *   [DONE] "Compact Mode" and "Smart Layout" (Dagre).
    *   [DONE] Zoom/Pan controls for large graphs.
    *   Collapsible Lanes?
*   **Layout Algorithms:**
    *   "Bending Paths": Optimize edge routing to pack nodes tighter.
    *   "Mise en Place" vs "Just in Time" views.

## 5. Interaction & Export (New)
*   **Interactive Editing:**
    *   Drag and Drop nodes to rearrange layout manually.
    *   Shift+Click to select multiple nodes for bulk moving.
    *   **Reroll Icons:** Regenerate specific icons that don't match the ingredient.
*   **Export Options:**
    *   [DONE] Download as SVG.
    *   Download as PNG (High Res).
*   **Visual Styles:**
    *   "Minimal" mode: Just icons + text (no complex headers).