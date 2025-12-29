# Module: Icon Maker (Recipe RPG)

**Note:** This document describes the "Icon Maker" module, which is the default landing page (`/`) of the **Recipe Lanes** application.

A retro 8-bit style web application where users "forge" recipe ingredients into pixel art icons. The app combines generative AI with a feedback-driven ranking system to curate a high-quality library of game assets for use in the main Recipe Lanes editor.

## Tech Stack
- **Framework:** Next.js (App Router) with Server Actions.
- **Language:** TypeScript.
- **Styling:** Tailwind CSS, `Press Start 2P` font, dark mode pixel-art aesthetic.
- **AI Generation:** Genkit with Google AI (`vertexai/imagen-4.0-generate-001`).
- **Persistence:** Firebase Admin SDK (Firestore & Cloud Storage) with a robust in-memory fallback.

## Architecture & Data Flow

### 1. Server-Side Authority
All critical logic resides in `app/actions.ts`. The client (`app/page.tsx`) interacts exclusively via Server Actions, ensuring secure database access and API key protection.

### 2. Dual-Mode Storage (Robust Fallback)
The application is designed to work in two environments seamlessly:
- **Cloud Mode:** When valid Google Cloud/Firebase credentials are present, it persists data to Firestore and images to Google Cloud Storage.
- **Fallback Mode:** If credentials are missing or auth fails (common in local dev), the app automatically degrades to using a stateful in-memory store (`lib/store.ts`). This allows full feature testing (generation, rerolling, ranking, deletion) without external dependencies.
- **Error Handling:** Deletion and retrieval actions wrap database calls in robust try-catch blocks to handle missing indexes (`FAILED_PRECONDITION`) or auth errors gracefully.

### 3. Data Model
- **Ingredients:** Grouped by normalized name (Title Case, e.g., "Sugar", "Apple").
- **Icons:** Each ingredient has a subcollection of icons.
  - `url`: Public URL of the image.
  - `impressions`: Number of times this icon was selected/shown.
  - `rejections`: Number of times a user "rerolled" away from this icon.
  - `popularity_score`: Lower Confidence Bound (LCB) of the Wilson Score Interval, calculated from impressions/rejections.

## Core Features

### Forge (Generation)
1.  **Normalization:** User input is converted to Title Case (e.g., "sugar" -> "Sugar") to prevent duplicates.
2.  **Check Existing:** The system checks if the ingredient group exists.
3.  **Selection Strategy:**
    -   If icons exist, it calculates their Wilson Score.
    -   It returns the highest-rated icon unless the "quality floor" is breached or the cache is exhausted.
4.  **Generation:** If no good icons exist (or randomly based on weights), Genkit generates a new 64x64 pixel art image with a transparent background.

### Reroll (Feedback Loop)
-   Users can "reroll" an item they don't like.
-   **Action:** Records a `rejection` for the current icon (lowering its score) and fetches a new one (potentially generating a fresh asset).
-   **Stats:** Usage stats (`impressions`, `rejections`) are tracked to improve future selections.

### Inventory & Management
-   **Inventory:** Session-based list of forged items. Users can delete items from their view (client-side only).
-   **Debug Gallery:** A server-side view of all stored assets (persisted).
    -   **Smart Deletion:** Allows deleting individual icons or entire categories.
    -   **Optimization:** Uses a targeted deletion strategy (finding the parent ingredient doc first) to avoid requiring global Firestore indexes.

## File Structure
-   `app/page.tsx`: Main game UI (Icon Maker).
-   `app/actions.ts`: Server Actions (Logic core).
-   `lib/store.ts`: In-memory `MemoryStore` implementation.
-   `lib/genkit.ts`: AI model configuration.
-   `lib/firebase-admin.ts`: DB connection setup.
-   `components/`: UI components (`icon-display`, `debug-gallery`, etc.).
-   `scripts/`: Integration tests (`test-lifecycle.ts`, `test-deletion.ts`) for verifying logic in both Cloud and Fallback modes.