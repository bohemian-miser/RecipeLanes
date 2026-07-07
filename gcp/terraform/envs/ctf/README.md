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
