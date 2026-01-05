# Recipe Lanes (RecipeRPG Simple)

A Next.js application for generating visual recipes using Genkit and pixel art.

## Architecture & Database
See [ARCHITECTURE.md](ARCHITECTURE.md) for details on the Schema V2 (Unified Queue) architecture.

## Getting Started

1.  Install dependencies:
    ```bash
    npm install
    cd functions && npm install && cd ..
    ```

2.  Run the development server (with Firebase Emulators):
    ```bash
    ./scripts/test-e2e.sh # Runs emulators + tests
    # OR for interactive dev:
    firebase emulators:start --import=./debug/firebase-export
    npm run dev
    ```

## Testing
We use Playwright for E2E testing.
```bash
npm run test:e2e
```

## Deployment
Deployed via App Hosting (or Vercel).
Data migration scripts are in `scripts/`.
