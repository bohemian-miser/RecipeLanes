# Development Tools & Helpers

This document lists handy tools and commands available in this environment for developers and agents.

## GitHub CLI (`gh`)
Interact with GitHub repositories, PRs, and Actions.

*   **List PRs:** `gh pr list`
*   **View PR:** `gh pr view <number>` (add `--json body,comments` for details)
*   **Checkout PR:** `gh pr checkout <number>`
*   **Watch CI:** `gh run watch <run-id> --exit-status`
*   **Check Status:** `gh pr checks <number>`
*   **Merge:** `gh pr merge <number> --auto --merge` (if authorized)

## Google Cloud SDK (`gcloud`)
Manage Google Cloud resources (if authenticated).

*   **List Projects:** `gcloud projects list`
*   **Current Config:** `gcloud config list`
*   **Deploy (App Hosting):** `gcloud app deploy` (usually handled by CI)

## Firebase CLI (`firebase`)
Manage Firebase services (Firestore, Functions, Hosting).

*   **Emulators:** `firebase emulators:start` (starts local dev environment)
*   **Deploy Functions:** `firebase deploy --only functions`
*   **Firestore Shell:** `firebase firestore:shell` (interactive data explorer)

## Local Scripts (`package.json`)
Run these from `recipe-rpg-simple/`:

*   **`npm run dev`**: Start Next.js dev server.
*   **`npm run build`**: Build the application.
*   **`npm run lint`**: Run ESLint.
*   **`npm run test:unit`**: Run unit tests (mocked DB).
*   **`npm run test:e2e`**: Run Playwright E2E tests (requires emulators).
    *   *Usage:* `./scripts/test-e2e.sh <optional-spec-file>`
*   **`npm run verify`**: Full CI check (Build + Lint + Unit + E2E).

## Playwright (`npx playwright`)
Browser automation and testing.

*   **Run Tests:** `npx playwright test`
*   **UI Mode:** `npx playwright test --ui` (if display available)
*   **Codegen:** `npx playwright codegen <url>` (generate tests by clicking)
*   **Debug:** `PWDEBUG=1 npx playwright test`

## Environment Variables
*   `MOCK_AI=true`: Uses local placeholders instead of calling Vertex AI.
*   `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true`: Points app to local emulators.

## Agent Specifics
*   **Context:** Always check `GEMINI.md` in root or subfolders for project-specific context.
*   **Memory:** Use `save_memory` to persist important facts across sessions.
