# Project Summary: Recipe RPG / Icon Maker

## Overview
This project is a Next.js application called "Icon Maker" (part of Recipe RPG). It allows users to generating 64x64 pixel art icons from text ingredients using Generative AI.

**Core Loop:**
1.  User enters an ingredient (e.g., "Spicy Burger").
2.  System checks **Firestore** for existing cached icons.
    *   **Guest/Unauthenticated:** Can only retrieve existing cached icons.
    *   **Authenticated:** Can generate NEW icons if none exist or quality is low.
3.  **Generation (Server-Side):**
    *   **Text:** `gemini-2.5-flash` (via Vertex AI) enriches the prompt (e.g., "A burger with jalapenos...").
    *   **Image:** `imagen-3.0-generate-001` (via Vertex AI) creates the pixel art.
4.  **Storage:** Images saved to **Firebase Storage**. Metadata saved to **Firestore**.
5.  **Feedback:** Users can "Reroll" (reject) icons, lowering their Wilson Score (popularity). High-score items appear in the Shared Gallery.

## Tech Stack
*   **Framework:** Next.js 16 (App Router) with React 19 & TypeScript.
*   **Styling:** Tailwind CSS v4.
*   **Backend:** Firebase App Hosting (Cloud Run).
*   **Data:** Cloud Firestore (`ingredients` collection -> `icons` subcollection).
*   **Auth:** Firebase Auth (Google Provider) + Session Cookies (HTTP-only).
*   **AI:** Genkit (`@genkit-ai/google-genai` with `vertexAI` plugin).

## Key Architecture & Patterns
*   **Service Layer (`lib/`):**
    *   `DataService`: Interface for DB operations. Implemented by `FirebaseDataService` (Prod) and `MemoryDataService` (Tests).
    *   `AIService`: Interface for Generation. Implemented by `GenkitAIService` (Prod) and `MockAIService` (Tests).
    *   `AuthService`: Interface for Identity. Implemented by `RealAuthService` (Prod - checks Headers/Cookies) and `MockAuthService` (Tests).
*   **Dependency Injection:** Scripts like `scripts/test-lifecycle.ts` inject Mocks to run full integration tests without credentials.
*   **Server Actions (`app/actions.ts`):** The only entry point for mutations. Enforces RBAC (Role-Based Access Control).
*   **RBAC:** Admins are defined by `users/{uid}.isAdmin == true` in Firestore or `ADMIN_EMAILS` env var. Admins see the **Debug Gallery**.

## Current Implementation State
*   **Auth:** Fully functional. Guests are read-only (cache). Logged-in users can Forge.
*   **AI Backend:** Migrated to **Vertex AI** via Genkit to use Application Default Credentials (ADC), removing reliance on API Keys in production.
*   **Galleries:**
    *   `IconDisplay`: User's current session/inventory.
    *   `SharedGallery`: Top 4 icons per category (filtered for active items).
    *   `DebugGallery`: Admin view of raw Storage files.
*   **Testing:** `npm run verify` runs `build` and comprehensive lifecycle tests using Mocks.

## Environment & Secrets
*   **Configuration:** `apphosting.yaml` manages Prod environment variables.
*   **Secrets:** `GEMINI_API_KEY` (Secret Manager) - *Note: Vertex AI migration attempts to use ADC, but key might still be referenced in legacy paths.*
*   **Local Dev:** Uses `gcloud auth application-default login` for credentials.

## Important Commands
*   `npm run dev`: Start local server.
*   `npm run verify`: Build project and run all test scripts.
*   `npx tsx scripts/make-admin.ts <email>`: Grant admin privileges to a user.
*   `npx tsx scripts/verify-env.ts`: Check connectivity to Firebase/AI.

## Known Quirks
*   **Strict Mocks:** Test scripts use strict URL matching (`===`) because `placehold.co` mock URLs differ only by query params.
*   **Index Requirements:** `getSharedGalleryAction` requires a Firestore Composite Index (`collectionGroup: icons`, `marked_for_deletion ASC`, `popularity_score DESC`).
