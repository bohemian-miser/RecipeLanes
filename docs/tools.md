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
*   **Deploy Functions:** `firebase deploy --only functions` # from the functions folder i think.
*   **Firestore Shell:** `firebase firestore:shell` (interactive data explorer)

## Local Scripts (`package.json`)
Run these from `recipe-lanes/`:

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



I've just added an index to firestore.indexes.json, how do i deploy?
 firebase use recipe-lanes-staging && firebase deploy --only firestore:indexes





Other things that have been handy:


firebase apphosting:backends:list
firebase apphosting:backends:list --project recipe-lanes-staging

gcloud builds list --region=asia-southeast1 --project=recipe-lanes-staging --limit=3 # get the build id
gcloud builds log 89059c6b-7ab3-4664-b9d2-686fdfa4cd32 --region=asia-southeast1 --project=recipe-lanes-staging

gcloud run services list --project recipe-lanes-staging
gcloud run services logs read skipping-down --limit=50 --project recipe-lanes-staging
gcloud config set run/region asia-southeast1

### Enabling Cloud Tasks
TODO: Have a list of these that need to be run when setting up a new project.

gcloud services enable cloudtasks.googleapis.com --project=recipe-lanes-staging
gcloud services enable cloudtasks.googleapis.com --project=recipe-lanes

### Delete functions when you remove them from code.
firebase functions:delete processIconQueue --region us-central1