# Recipe Lanes 🍳🛣️

**Recipe Lanes** is a comprehensive visual recipe platform that transforms text into flowchart-style diagrams and lets users forge custom pixel-art icons.

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

-   **AI Parsing & Generation:** Gemini 1.5/2.5 Flash for logic, Imagen 3/4 for art.
-   **Smart Icons:** Automatically generates icons for ingredients and steps (cached & reusable).
-   **Mobile Friendly:** Optimized for use in the kitchen on phones and tablets.

## Tech Stack 🛠️

-   **Framework:** Next.js 15 (App Router)
-   **UI:** Tailwind CSS, Lucide Icons
-   **Graph:** React Flow
-   **AI:** Google Genkit (Gemini, Imagen)
-   **Database:** Firebase Firestore
-   **Storage:** Firebase Storage
-   **Testing:** Playwright, Vitest

## Getting Started 🚀

1.  **Install Dependencies:**
    ```bash
    npm install
    ```

2.  **Environment Setup:**
    Create a `.env` file with your Firebase and Genkit credentials.
    ```env
    GOOGLE_GENAI_API_KEY=...
    NEXT_PUBLIC_FIREBASE_API_KEY=...
    # ... other firebase config
    ```

3.  **Run Development Server:**
    ```bash
    npm run dev
    ```
    Open [http://localhost:3000](http://localhost:3000) (or port 8001 if configured).

## Testing 🧪

We use a combination of Logic Tests (for complex graph algorithms) and E2E Tests (for UI flows).

```bash
# Run all tests
npm test

# Run only logic tests
npx tsx tests/undo-scrambled-logic.test.ts
```

## Deployment 🌍

Deployed on Vercel/Firebase App Hosting.