# Recipe Lanes 🍳🛣️

**Recipe Lanes** is a visual recipe generator that transforms text into flowchart-style diagrams using Generative AI. It helps cooks visualize the process, parallelize steps, and see what ingredients are needed when.

## Features ✨

-   **AI Parsing:** Converts recipe text into a structured node-based graph.
-   **Visual Flow:** Drag-and-drop interface to rearrange steps.
-   **Smart Icons:** Automatically generates icons for ingredients and steps (cached & reusable).
-   **Social Sharing:**
    -   **Gallery:** Browse recipes created by the community.
    -   **Search:** Find recipes by title or ingredient.
    -   **Vote & Star:** Like your favorite recipes and save them for later.
    -   **Fork/Copy:** Clone a recipe to customize it.
-   **Mobile Friendly:** Optimized for use in the kitchen on phones and tablets.

## Tech Stack 🛠️

-   **Framework:** Next.js 15 (App Router)
-   **UI:** Tailwind CSS, Lucide Icons
-   **Graph:** React Flow
-   **AI:** Google Genkit (Gemini 1.5 Flash)
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
    Open [http://localhost:3000](http://localhost:3000).

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