# Recipe Lanes - Feature Roadmap

## 1. User Accounts & Saving
*   **Personal Library:** Allow users to save parsed recipes to their profile.
*   **History:** View previously generated lanes.
*   **Edits:** Allow users to tweak the graph (change text, drag nodes) and save changes.
*   **Profile Page:** View saved recipes with custom thumbnail icons.
*   [DONE] **Sharing:** Shareable UUID links.

## 2. Public & Social
* Re-enable auth.
* Every recipe made by a logged in user is saved to their account, and they can choose to share it by url while being unlisted, or make it public (can then be found by searching the gallery). When viewing a recipe, don't show or associate the recipe with the account that created it. If you make edits, show a lil "Log in to save edits" and if they click that then they log in and their edits are saved.
* Save all the edits made to each of the layouts independently (people can reset at any time to the original for that layout)
* All Recipies can be starred (Show a starred secion in gallery, these point to the orignal recipe), coppied, given a thumbs up / thumbs down (Store the id of recipies liked / disliked in each account and have a count saved of each stored with the recipe and prevent an account from liking/disliking recipies they have already liked/disliked).
* Logged in users can copy a recipe they are looking at. (remember to prompt them in the ui with a banner when they start making changes)
* Enable Searching the public database (Gallery) for "Spaghetti", "Cake", etc.

# UI
* arrows are still broken. They should point to/from the centre of an icon and stop short at the radius from the centre to a corner of the icon.
* Undo is still not working. Make a test that tests it end to end in the ui. Prevent pushing any furhter changes that would break it.

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
        *   [BROKEN] needs fixing.




# Icon Maker 

* shrink the groups and only have groups when there's multiple.
  * Tile them better to show a lot on screen.



# Steps to check
* Are all tests passing locally, and in github?
  * Check using gh
* Is the build okay in firebase?
  * Check using firebase cli
* Is all the mocking correct?
* Is there anything more you could test for in this current change to prevent/detect it breaking in the future?