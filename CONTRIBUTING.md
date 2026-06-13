# Contributing to Recipe Lanes

This is my first open source project so I'm still working some things out. I'm always open to suggestions.

## Workflow

Feature branch → **PR against `main`**. `staging` is a side preview environment, not a step on the merge path. See `docs/git_workflow.md` for the exact commands.

### 1. Develop on a short-lived branch
*   Branch from the latest `origin/main` with a category prefix (`feat/`, `fix/`, `docs/`).
*   Branches are disposable — don't reuse one after it merges.

### 2. Preview on staging (optional, owner-controlled)
*   `staging` is a **disposable preview environment** — it is force-pushed to at will and its history is not precious. Pushing to it deploys the backend (Cloud Functions & Firestore Rules) to the **Staging Firebase Project** (`recipe-lanes-staging`, https://staging.recipelanes.com/).
*   The repo owner pushes to staging whenever they want a preview. **Other contributors don't push to staging directly** — request a staging push and the owner will approve/run it.

### 3. Ship via PR to main
*   **Open your PR against `main`** (`gh pr create --base main`). `main` is protected: it only ever changes through a reviewed, merged PR — nobody pushes to it directly.
*   Frontend changes are verified by CI on every PR; merging to `main` deploys to the **Production Firebase Project** (`recipe-lanes`, https://recipelanes.com/) via Firebase App Hosting.

### 4. Firestore Indexes
*   Indexes are tracked in `recipe-lanes/firestore.indexes.json`.
*   Do not manually create indexes in the console if possible; ensure they are committed to this file to prevent configuration drift between Staging and Production.
