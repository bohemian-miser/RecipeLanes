# Recipe Lanes 🍳🛣️ (Main Application)

This directory contains the core Next.js application for [RecipeLanes.com](http://recipelanes.com/).

## Quick Links
-   **Main Documentation:** See the root [README.md](../README.md) for a full project overview, features, and philosophy.
-   **Architecture:** Detailed database and queue logic in [ARCHITECTURE.md](ARCHITECTURE.md).
-   **Features:** Roadmap and detailed feature list in [FEATURES.md](../docs/FEATURES.md).

## Technical Overview

### Stack
-   **Next.js 16** (App Router)
-   **Tailwind CSS 4**
-   **React Flow** (Graph Visualization)
-   **Google Genkit** (AI Integration)
-   **Firebase** (Firestore, Auth, Storage, Functions)

### Development
```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run unit tests
npm run test:unit

# Run E2E tests
npm run test:e2e
```

### Environment Variables
Ensure you have a `.env` file with the following (see `.env.example` if available):
-   `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
-   `NEXT_PUBLIC_FIREBASE_API_KEY`
-   `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
-   ...and other standard Firebase/GCP credentials.

## Scripts
-   `npm run mcp`: Starts the Playwright MCP server for agentic interaction.
-   `npm run verify`: Full build and test suite.
-   `npm run build`: Production build.
