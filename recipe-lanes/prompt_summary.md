# Project Summary: Recipe Lanes (Recipe RPG)

## Overview
**Recipe Lanes** (formerly Recipe RPG) is a comprehensive visual recipe platform. It consists of three integrated modules:

1.  **Icon Maker (/)**: A retro 8-bit style tool to "forge" ingredient icons using AI (Imagen 4). Acts as the asset factory.
2.  **Lanes Editor (/lanes)**: A visual flowchart editor that converts text recipes into "Swimlane" diagrams using React Flow and Gemini 2.5.
3.  **Gallery (/gallery)**: A hub for browsing, searching, and managing user-created recipe visualizations.

## Tech Stack
*   **Framework:** Next.js 16 (App Router) with React 19 & TypeScript.
*   **Styling:** Tailwind CSS v4, Lucide Icons.
*   **Data:** Firebase Firestore & Storage.
*   **Auth:** Firebase Auth (Google Provider) + Session Cookies.
*   **AI:** Google Genkit
    *   **Logic/Parsing:** `gemini-2.5-flash`
    *   **Art:** `imagen-4.0-generate-001`
    *   **Embeddings:** `text-embedding-004`
*   **Graph:** React Flow, Dagre/Elk layout engines.
*   **Testing:** Playwright (E2E), Vitest (Logic).

## Key Architecture & Patterns
*   **Server Actions:** All mutations go through `app/actions.ts` for security.
*   **Dual-Mode Storage:** Production uses Firebase; Local/Test uses In-Memory or Emulators.
*   **Asset Reuse:** Icons generated in Module 1 are cached and reused in Module 2.
*   **Forking System:**
    *   Recipes can be copied/forked.
    *   Smart naming ("Copy of...", "Yet another copy of...").
    *   "Override" capability for personal copies.
*   **Persistence:**
    *   **Drafts:** `localStorage` for unsaved work.
    *   **Cloud:** Firestore for saved recipes (User ID linked).

## Current Implementation State
*   **Icon Maker:** Fully functional with "Reroll" feedback loop and Community Gallery.
*   **Lanes Editor:**
    *   Text-to-Graph parsing with Gemini.
    *   Interactive Drag-and-Drop editor.
    *   Chat-based adjustment ("Add a side of rice").
    *   JSON export/import.
*   **Gallery:**
    *   Public, Mine, and Starred views.
    *   Server-side full-text search.
    *   Auth integration for personalized views.

## Environment & Secrets
*   **Configuration:** `apphosting.yaml` for Prod.
*   **Credentials:** Uses Application Default Credentials (ADC) in Prod (Cloud Run), and `.env` keys for Local.

## Important Commands
*   `npm run dev`: Start local server (port 8001).
*   `npm run test`: Run both Unit and E2E tests.
*   `npm run test:unit`: Run fast logic tests.
*   `npm run test:e2e`: Run Playwright tests (requires Emulators).

## Known Quirks
*   **Auth Loading:** The `/lanes` route may block on auth loading; ensure `NEXT_PUBLIC_USE_FIREBASE_EMULATOR` is set correctly if using emulators.
*   **Graph Layout:** Uses `dagre` by default but supports `elk` and `force` layouts.