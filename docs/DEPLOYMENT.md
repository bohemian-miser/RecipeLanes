# Deploying a New Instance

This guide is for setting up a brand new Firebase project from scratch. If you just want to run the app locally with emulators, see the [Getting Started](../README.md#-getting-started) section in the root README.

## 1. Create Firebase Projects

Create two Firebase projects — one for staging, one for production. The existing setup uses:
- **Staging:** `recipe-lanes-staging`
- **Production:** `recipe-lanes`

In each project, enable these services:
- **Firestore** (Native mode)
- **Authentication** (enable Email/Password and Google providers)
- **Storage**
- **Functions** (requires Blaze pay-as-you-go plan)
- **App Hosting** (for Next.js deployment)
- **Cloud Tasks** (enabled automatically when Functions is used)

## 2. Create a Service Account for Cloud Tasks

The icon processing function dispatches Cloud Tasks using a dedicated service account. There's a script that handles creation and all required IAM roles — run it for each project:

```bash
# Run from recipe-lanes/
bash scripts/setup-icon-processor-sa.sh YOUR_PROJECT_ID
```

This creates the `icon-processor` service account and grants it the roles it needs (Firestore, Storage, AI Platform, Cloud Tasks, Cloud Run invoker, etc.). It's idempotent so safe to re-run.

## 3. Add Your Gemini API Key to Secret Manager

The app uses the Gemini API for AI features. Add your key to Secret Manager in each project:

```bash
echo -n "YOUR_GEMINI_API_KEY" | gcloud secrets create GEMINI_API_KEY \
  --project=PROJECT_ID \
  --data-file=-
```

Grant the App Hosting service account access:
```bash
gcloud secrets add-iam-policy-binding GEMINI_API_KEY \
  --project=PROJECT_ID \
  --member="serviceAccount:firebase-app-hosting-compute@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## 4. Configure App Hosting Environment Variables

Create `apphosting.staging.yaml` and `apphosting.prod.yaml` from the existing files, updating the Firebase config values (found in Firebase Console → Project Settings → General → Your apps) and your project IDs. The `GEMINI_API_KEY` is pulled from Secret Manager automatically via the `secret:` reference in `apphosting.yaml`.

## 5. Set Admin Emails

Admins are controlled by the `ADMIN_EMAILS` environment variable (comma-separated list). Add this to your `apphosting.staging.yaml` and `apphosting.prod.yaml`:

```yaml
env:
  - variable: ADMIN_EMAILS
    value: you@example.com,other@example.com
```

## 6. Deploy

```bash
cd recipe-lanes

# Login to Firebase
npx firebase login

# Deploy firestore rules, storage rules, and functions to staging
npx firebase use recipe-lanes-staging
npx firebase deploy --only firestore,storage,functions

# App Hosting deploys automatically when you push to the staging/main branches (see CONTRIBUTING.md)
```

## 7. Firestore Indexes

Indexes are tracked in `firestore.indexes.json` and deployed with `firebase deploy --only firestore`. Do not create indexes manually in the console — they won't be tracked and will cause drift between environments.
