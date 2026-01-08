# Recipe Lanes - Application Overview

**Recipe Lanes** is a comprehensive visual recipe platform consisting of three integrated modules. This document serves as a technical overview of each module's purpose, architecture, and data flow.

---

## Module 1: Icon Maker (Recipe RPG)
**Route:** `/`

A retro 8-bit style web application where users "forge" recipe ingredients into pixel art icons. This module acts as the "asset factory" for the entire platform, creating a reusable library of visual elements.

### Architecture & Data Flow
*   **Server-Side Authority:** All logic resides in `app/actions.ts` to protect API keys and database logic.
*   **Dual-Mode Storage:**
    *   **Cloud:** Firestore + Firebase Storage (Production).
    *   **Fallback:** In-memory store (Local/Test).
*   **Generation Strategy:**
    1.  **Normalization:** Title Case (e.g. "sugar" -> "Sugar").
    2.  **Cache Check:** Returns existing icon if high quality (Wilson Score).
    3.  **Generation:** Uses `vertexai/imagen-4.0-generate-001` via Genkit if cache is empty or quality is low.
    4.  **Feedback:** User "Rerolls" record rejections, lowering the icon's score.

### Core Features
*   **Forge:** Generate 64x64 pixel art with transparent backgrounds.
*   **Reroll:** Feedback loop to improve asset quality over time.
*   **Inventory:** Session-based tracking of created items.
*   **Smart Deletion:** Admin tools to clean up bad assets.

---

## Module 2: Lanes Editor
**Route:** `/lanes`

The core visualization tool that converts text recipes into interactive "Swimlane" flowcharts. It leverages the icons created in Module 1.

### Architecture & Data Flow
*   **AI Parsing:**
    *   **Input:** Raw recipe text.
    *   **Model:** `vertexai/gemini-2.5-flash`.
    *   **Output:** Structured JSON Graph (Nodes, Edges, Lanes).
    *   **Logic:** `lib/recipe-lanes/parser.ts` enforces strict schema (Ingredients vs Actions, split quantities).
*   **Visualization:**
    *   **Library:** React Flow (`reactflow`).
    *   **Layout:** Auto-layout using Dagre or Elk algorithms.
    *   **Interactivity:** Drag-and-drop nodes, adjustable connection lines (Bezier/Step/Straight).
*   **Asset Integration:**
    *   Automatically matches graph nodes to existing icons in the Icon Maker DB.
    *   Generates missing icons via Cloud Function trigger (`fillGraph`).

### Core Features
*   **Visual Editor:** Swimlanes for Prep/Cook/Serve.
*   **Chat Adjustment:** User can ask AI to modify the graph (e.g., "Add a side of rice").
*   **Forking System:**
    *   **Copy:** Users can fork public recipes to their own account.
    *   **Smart Naming:** Handles "Copy of...", "Yet another copy of..." automatic naming.
    *   **Override:** Option to overwrite existing personal copies with new versions.
*   **Persistence:**
    *   **Drafts:** `localStorage` draft saving.
    *   **Cloud:** Saves to Firestore (linked to User ID).

---

## Module 3: Gallery
**Route:** `/gallery`

The hub for browsing, searching, and managing recipe visualizations.

### Architecture & Data Flow
*   **Rendering:** Server Components (`dynamic = 'force-dynamic'`) for SEO and performance.
*   **Data Access:** Direct service calls via `lib/data-service.ts`.
*   **Filtering:**
    *   **Public:** Global feed of shared recipes.
    *   **Mine:** Authenticated user's personal collection.
    *   **Starred:** Bookmarked recipes.

### Core Features
*   **Search:** Server-side full-text search (Title/Ingredients).
*   **Social:** Star/Like system.
*   **Management:** Users can edit or delete their own recipes (via Editor).
*   **Auth Integration:** Conditional rendering of Login/Logout and personalized views using Firebase Auth.

---

## Tech Stack 🛠️
- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS, Lucide Icons
- **AI:** Google Genkit
    - **Logic:** `vertexai/gemini-2.5-flash`
    - **Art:** `vertexai/imagen-4.0-generate-001`
    - **Embeddings:** `vertexai/text-embedding-004`
- **Database:** Firebase Firestore
- **Storage:** Firebase Storage
- **Testing:** Playwright (E2E), Vitest (Logic)
