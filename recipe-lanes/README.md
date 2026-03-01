# Recipe Lanes 🍳🛣️

**Recipe Lanes** is a comprehensive visual recipe platform that transforms text into flowchart-style diagrams and lets users forge custom pixel-art icons.

## Architecture & Database
See [ARCHITECTURE.md](ARCHITECTURE.md) for details on the Schema V2 (Unified Queue) architecture.

## Modules 🧩

### 1. Icon Maker (Recipe RPG) - `/`
The landing page features the **Icon Maker** (internally "Recipe RPG").
-   **Forge Icons:** Generate 8-bit pixel art icons for ingredients using AI.
-   **Community Gallery:** Vote and browse icons created by others.
-   **Social:** Reroll, star, and share your creations.

### 2. Lanes Editor - `/lanes`
The core visualization tool.
-   **AI Parsing:** Converts recipe text into a structured node-based graph.
-   **Visual Flow:** Drag-and-drop interface to rearrange steps.
-   **Integration:** Uses icons forged in the Icon Maker for steps and ingredients.

### 3. Gallery - `/gallery`
Browse and manage recipes.
-   **Search:** Find recipes by title or ingredient.
-   **Fork/Copy:** Clone a recipe to customize it.

## Features ✨

-   **AI Parsing & Generation:** Gemini 2.5 Flash for logic, Imagen 4 for art.
-   **Smart Icons:** Automatically generates icons for ingredients and steps (cached & reusable).
-   **Mobile Friendly:** Optimized for use in the kitchen on phones and tablets.
-   **Unified Queue:** Scalable background generation for icons.

## Tech Stack 🛠️

-   **Framework:** Next.js 16 (App Router)
-   **UI:** Tailwind CSS, Lucide Icons
-   **Graph:** React Flow
-   **AI:** Google Genkit (Gemini 2.5 Flash, Imagen 4)
-   **Database:** Firebase Firestore (Schema V2)
-   **Storage:** Firebase Storage
-   **Testing:** Playwright, Vitest

## Getting Started 🚀

1.  **Install Dependencies:**
    ```bash
    npm install
    cd functions && npm install && cd ..
    ```

2.  **Environment Setup:**
    Create a `.env` file with your Firebase and Genkit credentials.

3.  **Run Development Server (with Emulators):**
    ```bash
    ./scripts/test-e2e.sh # Runs emulators + tests
    # OR for interactive dev:
    firebase emulators:start --import=./debug/firebase-export
    npm run dev
    ```

## Testing 🧪

We use a combination of Logic Tests (Unit) and E2E Tests (Playwright).

```bash
# Run all tests
npm test

# Run only logic/unit tests
npm run test:unit

# Run only E2E tests (requires Firebase Emulators)
npm run test:e2e
```

## Deployment 🌍

Deployed on Vercel/Firebase App Hosting.
Data migration scripts are in `scripts/`.