# `envs/ctf` — recipe-lanes-ctf

A separate GCP/Firebase project for the **deliberately-vulnerable teaching
fork** of RecipeLanes (served at `ctf.recipelanes.com`). It is isolated by
design: its own Firestore/Auth/Storage and service accounts, and **no IAM on
`recipe-lanes` or `recipe-lanes-staging`** — a student exploiting the CTF app
can only reach throwaway CTF data.

## What this env manages today

- The `recipe-lanes-ctf` project + billing link (`prevent_destroy`).
- Core APIs (Firebase, Firestore, Identity Toolkit, Storage, Run, Cloud Build,
  Artifact Registry, App Hosting, Vertex AI).
- Firebase enablement (`google_firebase_project`).

## Deliberately deferred (future PRs, once the fork branch exists)

- **App Hosting backend** (`google_firebase_app_hosting_backend`) pointing at
  the fork's repo/branch. App Hosting mints its own custom-domain claim (TXT) +
  serving records, which don't exist until the backend does.
- **`ctf.recipelanes.com` DNS record** in `envs/prod/dns.tf` — target comes
  from the App Hosting backend above.
- **Data layer**: `google_firestore_database` (prod uses `australia-southeast1`;
  Firestore location is permanent — pick to match the fork's needs), Auth
  config, Storage bucket.

## Apply

```bash
export TF_VAR_billing_account=...  # the shared billing account id (kept out of the repo)
cd envs/ctf
terraform init
terraform plan     # creating a new billed project — read before applying
terraform apply
```

Creating the project needs the caller to have `billing.resourceAssociations.create`
on that billing account (the owner's user creds do). Find the id with
`gcloud billing projects describe recipe-lanes --format='value(billingAccountName)'`.

## Runtime resources (`runtime.tf`) — adopt with `runtime-adopt.sh`

`runtime.tf` manages the Firestore database, the App Hosting runtime SA's
`aiplatform.user` grant (needed by the genkit/Vertex recipe parser), and the
Identity Platform config (authorized domains). These were first created
imperatively while bringing the site up; after merging, run:

```bash
export GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token)  # TF state creds
./runtime-adopt.sh          # imports the live resources
terraform plan              # expect no changes
terraform apply
```

## What is NOT Terraform (and shouldn't be)

Infra is Terraform; **app artifacts are deployed from the app repo**, not here —
this is the normal split, not a gap:

| Thing | Managed by |
|---|---|
| Firestore **rules** & indexes, Storage rules | `firebase deploy` (app repo) / CI |
| **Cloud Functions** (`vectorSearch`, `processIconTask`) | `firebase deploy --only functions` / CI |
| The Next.js app itself | App Hosting continuous deploy from `main` |

Genuinely manual / can't be clean IaC here:
- **Google sign-in provider** — `google_identity_platform_default_supported_idp_config`
  needs an OAuth `client_id`/`client_secret`; the Firebase console auto-provisions
  a Google-managed client in one click. Putting a client secret in this **public**
  repo is a non-starter, so enabling Google stays a console click (Authentication →
  Sign-in method → Google → Enable).
- **`GEMINI_API_KEY` secret value** — the secret can be TF-managed but its value
  can't live in a public repo; supply via `TF_VAR` or create out-of-band.
