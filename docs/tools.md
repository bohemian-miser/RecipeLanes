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


// How to run an individual test
npx playwright test e2e/concurrent-creations.spec.ts



Other things that have been handy:


firebase apphosting:backends:list
firebase apphosting:backends:list --project recipe-lanes-staging

gcloud builds list --region=asia-southeast1 --project=recipe-lanes-staging --limit=3 # get the build id
gcloud builds log 89059c6b-7ab3-4664-b9d2-686fdfa4cd32 --region=asia-southeast1 --project=recipe-lanes-staging

gcloud run services list --project recipe-lanes-staging
gcloud run services logs read skipping-down --limit=50 --project recipe-lanes-staging
gcloud config set run/region asia-southeast1




Latest logs from backend
 gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=processicontask" --project recipe-lanes --limit 20 --format="table(timestamp, textPayload)"

### Icon Queue Forensics
If icons are failing to generate (showing Red X or stuck pending):

1.  **Check Firestore for Failed Entries:**
    Run the forensic query script to see error messages and check if linked recipes still exist:
    ```bash
    cd recipe-lanes && ./node_modules/.bin/tsx scripts/forensics-query.ts
    ```
    *Note: "Recipe not found" means a recipe was deleted while its icon was being generated.*

2.  **Repair the Queue:**
    Remove references to non-existent recipes (orphans) that are blocking processing:
    ```bash
    cd recipe-lanes && ./node_modules/.bin/tsx scripts/repair-queue.ts --dry-run
    ```

3.  **Search Logs for Specific Errors:**
    Find the exact stack trace for a failure (e.g., for "Basil Leaf"):
    ```bash
    gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=processicontask AND textPayload:\"Basil Leaf\"" --project recipe-lanes --limit 10
    ```

### Backups (Firestore)
Always backup before running major repair or migration scripts.

*   **Manual Export:**
    *   *Note: Bucket MUST be in the same region as the DB (e.g., australia-southeast1).*
    ```bash
    # Create regional bucket
    gsutil mb -p recipe-lanes -l australia-southeast1 gs://recipe-lanes-backups
    # Run export
    gcloud firestore export gs://recipe-lanes-backups --project recipe-lanes
    ```

*   **Native Scheduled Backups:**
    ```bash
    gcloud firestore backups schedules create --project=recipe-lanes --database='(default)' --retention=7d --recurrence=daily
    ```

### Recipe Database Maintenance
Useful scripts for monitoring and cleaning the database.

*   **List Latest Recipes:**
    Show the most recently created recipes with author and link.
    ```bash
    cd recipe-lanes && ./node_modules/.bin/tsx scripts/list-latest-recipes.ts 20
    # For staging:
    cd recipe-lanes && ./node_modules/.bin/tsx scripts/list-latest-recipes.ts 10 --staging
    ```

*   **List Icons:**
    Show icons across all ingredients.
    ```bash
    # Sort by most recent
    cd recipe-lanes && ./node_modules/.bin/tsx scripts/list-icons.ts
    # Sort by popularity (how many recipes they are in)
    cd recipe-lanes && ./node_modules/.bin/tsx scripts/list-icons.ts --popularity
    # Staging
    cd recipe-lanes && ./node_modules/.bin/tsx scripts/list-icons.ts --staging
    ```

*   **Cleanup Debug Recipes:**
    Delete all recipes titled "debug recipe".
    ```bash
    cd recipe-lanes && ./node_modules/.bin/tsx scripts/cleanup-debug-recipes.ts --dry-run
    ```

### Enabling Cloud Tasks
TODO: Have a list of these that need to be run when setting up a new project.

gcloud services enable cloudtasks.googleapis.com --project=recipe-lanes-staging
gcloud services enable cloudtasks.googleapis.com --project=recipe-lanes

### Service Account & IAM Management
Manage least-privilege service accounts for backend tasks.

*   **List Service Accounts:** `gcloud iam service-accounts list --project <project-id>`
*   **Check IAM Policy:** `gcloud projects get-iam-policy <project-id> --filter="bindings.members:serviceAccount:<email>"`
*   **Setup Icon Processor SA:** `./scripts/setup-icon-processor-sa.sh <project-id>`
    *   Creates `icon-processor` SA and grants roles: `datastore.user`, `storage.objectAdmin`, `aiplatform.user`, `logging.logWriter`, `cloudtrace.agent`, `iam.serviceAccountTokenCreator`, `cloudtasks.enqueuer`.

### Cloud Functions & Run Investigation
*   **Describe Function:** `gcloud functions describe <name> --gen2 --region us-central1 --project <project-id>`
*   **Describe Cloud Run:** `gcloud run services describe <service-name> --region us-central1 --project <project-id>`
*   **Update Service Account:** `gcloud run services update <service-name> --service-account <email> --region us-central1 --project <project-id>`

### Logging & Monitoring
*   **Read Service Logs:** `gcloud run services logs read <service-name> --project <project-id>`
*   **Audit SA Activity:** `gcloud logging read "protoPayload.authenticationInfo.principalEmail='<sa-email>'" --project <project-id> --limit 50`
    *   *Note: Shows what the SA is doing (e.g., writing to Firestore, uploading to Storage).*

### Delete functions when you remove them from code.
firebase functions:delete processIconQueue --region us-central1


