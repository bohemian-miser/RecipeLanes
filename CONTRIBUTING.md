# Contributing to Recipe Lanes

## Workflow

We enforce a Staging -> Production workflow.

### 1. Development (Staging)
*   **Target Branch:** All feature development should target the `staging` branch.
*   **Pull Requests:** Open PRs against `staging`.
*   **Automatic Deployment:** Merging a PR into `staging` triggers an automatic deployment of the Backend (Cloud Functions & Firestore Rules) to the **Staging Firebase Project** (`recipe-lanes-staging`) https://staging.recipelanes.com/.
*   **Verification:** Verify changes in the Staging environment before proceeding.

### 2. Production Release - HUMAN ONLY
*   **Promotion:** To release to production, open a PR to merge `staging` into `main`.
*   **Production Deployment:** Merging into `main` triggers deployment to the **Production Firebase Project** (`recipe-lanes`) https://recipelanes.com/.

### 3. Frontend Changes
*   Frontend changes (Next.js) are verified via CI on every PR.
*   Deployment is handled via Firebase App Hosting automatically upon merge.

### 4. Firestore Indexes
*   Indexes are tracked in `recipe-rpg-simple/firestore.indexes.json`.
*   Do not manually create indexes in the console if possible; ensure they are committed to this file to prevent configuration drift between Staging and Production.
