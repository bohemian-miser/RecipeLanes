# Recipe RPG

A retro 8-bit style web application where users "forge" recipe ingredients into pixel art icons.

## Tech Stack
- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS with "Press Start 2P" font and pixel-art aesthetic.
- **AI/ML:** Genkit with Google AI plugins (`imagen-3.0-generate-001` for images, `text-embedding-004` for similarity).
- **Backend:** Firebase Admin SDK (Firestore & Storage) for persistence.

## Core Features
1. **Forge Items:** Users input text (e.g., "Diced Onions").
2. **AI Generation:** The system generates a 64x64 pixel art icon with transparent background.
3. **Smart Re-use:**
   - Uses vector embeddings to find semantically similar existing ingredients (e.g., "Chicken" matches "Roast Chicken").
   - If a match is found, it randomly selects an existing icon biased by a `popularity_score`.
   - There is always a small chance (`NEW_ICON_WEIGHT`) to generate a fresh image even if matches exist.
4. **Reroll & Popularity:**
   - Users can "reroll" an item to get a different visual.
   - Rerolling decreases the icon's `popularity_score` by 1.
   - Newly generated icons get a score bonus based on how many times that ingredient has been generated (`POPULARITY_BONUS + log2(count + 1)`).
5. **Cleanup:** Icons with a popularity score dropping below a threshold (based on total sibling count) are marked for deletion.

## Security & Architecture
- **Server-Side Authority:** All logic for generating images, storing files, writing to the database, and calculating popularity scores MUST happen in Next.js Server Actions (`'use server'`).
- **Input Validation:** User input is strictly validated (using Zod) before processing. No direct client-side DB access.
- **Visuals:** Dark mode, high-contrast, chunky UI elements to mimic a retro RPG inventory screen.
