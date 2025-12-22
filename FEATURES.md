# Recipe Lanes - Feature Roadmap

## 1. User Accounts & Saving
*   **Personal Library:** Allow users to save parsed recipes to their profile.
*   **History:** View previously generated lanes.
*   **Edits:** Allow users to tweak the graph (change text, drag nodes) and save changes.
*   **Profile Page:** View saved recipes with custom thumbnail icons.
*   [DONE] **Sharing:** Shareable UUID links.

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
    *   [DONE] "Compact Mode", "Micro Mode" (Dots), "Smart Layout" (Dagre), "Organic" (ELK).
    *   [DONE] Zoom/Pan controls.
    *   **Layout Tuning:** Controls for spacing, force strength (Partial).
*   **Layout Algorithms:**
    *   "Bending Paths": Optimize edge routing to pack nodes tighter.
    *   "Upward Arc": Refine radial layout to prevent sprawl and strictly flow up.
    *   "Dense Tree": The most densely packed tree possible.
*   **Visuals:**
    *   [DONE] "Minimal" node style (No background, large icon, text halo).
    *   **Better Arrows:** Improve edge styling and markers.
    *   Have a loading bar when forging icons.
    *   add icons as they are generated/found. All the cached ones should show pretty quickly.

## 5. Interaction & Export
*   **Interactive Editing:**
    *   [DONE] Drag and Drop nodes to rearrange layout manually.
    *   [DONE] Shift+Click / Selection Box.
    *   **Persistence:** Remember manual node positions after save.
    *   **Reroll Icons:** Regenerate specific icons that don't match the ingredient.
*   **Export Options:**
    *   [DONE] Download as SVG.
    *   [DONE] Download as PNG (High Res).




# Icon Maker 

* shrink the groups and only have groups when there's multiple.
  * Tile them better to show a lot on screen.