# RecipeLanes infrastructure as Terraform (`gcp/terraform/`)

Terraform is the target home for all hand-rolled GCP infra (agent-isolation
roadmap, Tier 3). This directory migrates the three existing script bundles
into one declarative baseline per project:

| Superseded source | Now lives in |
|---|---|
| `gcp/monitoring/` (icon-forge alert metric/channel/policy + `apply.sh`) | `modules/project-baseline/monitoring.tf` |
| `recipe-lanes/scripts/setup-icon-processor-sa.sh` | `modules/project-baseline/icon-processor.tf` |
| `recipe-lanes/scripts/setup-preview-pipeline.sh` | `modules/project-baseline/apis.tf` + `preview-pipeline.tf` |

The scripts stay in the tree until the owner has run the import + first apply
for both envs; after that they should be deleted in a follow-up PR.

## Layout

```
gcp/terraform/
├── modules/project-baseline/   # everything one project needs (shared)
├── envs/staging/               # recipe-lanes-staging (preview pipeline ON)
├── envs/prod/                  # recipe-lanes        (preview pipeline OFF)
├── bootstrap-state-bucket.sh   # one-time: create gs://recipe-lanes-tfstate
└── import.sh                   # adopt live resources into state (per env)
```

- State: GCS backend, bucket `recipe-lanes-tfstate` (in the prod project,
  versioned), prefixes `envs/staging` and `envs/prod`.
- IAM is **additive-only** (`google_project_iam_member`). Authoritative IAM
  resources (`google_project_iam_policy` / `_binding`) are banned here — they
  read-modify-write whole bindings and can wipe grants made outside Terraform
  (see the 2026-07-04 authorizedDomains outage postmortem).
- `enable_preview_pipeline` gates the per-PR preview infra; it is `true` only
  for staging. Prod's existing `preview` Artifact Registry repo is deliberately
  left unmanaged.

## First-time adoption runbook (owner, one time per env)

Terraform must **import** the live resources, not re-create them. Staging
first; prod only after staging converges.

```bash
# 0. Auth (user creds — the firebase-adminsdk SAs can't read monitoring/IAM)
gcloud auth login
gcloud auth application-default login   # what the terraform provider uses

# 1. One-time state bucket
cd gcp/terraform && ./bootstrap-state-bucket.sh

# 2. Staging
export TF_VAR_alert_email=you@example.com
cd envs/staging
terraform init
cd ../.. && ./import.sh staging
cd envs/staging && terraform plan     # expect empty or additive-only
terraform apply                       # only after reading the plan

# 3. Prod — same dance with `prod`, only after staging is verified
```

**Read the plan before every apply.** After import the plan should be empty or
additive-only. Any *change* usually means live config drifted from the old
scripts (e.g. the hand-tuned prod alert threshold — override with
`TF_VAR_alert_threshold` / `TF_VAR_alert_alignment_period` if the live values
should win, or let Terraform converge them deliberately). Any *destroy* is a
red flag — stop and investigate.

## Day-2 changes

Edit the module / env files, open a PR (plan output pasted into the PR body),
and apply after merge. Never `terraform apply` unreviewed changes to prod, and
never fall back to one-off `gcloud` mutations — that recreates the drift this
directory exists to eliminate.

## Notes

- `terraform validate` needs no credentials and is safe anywhere. `plan`/
  `apply`/`import` need owner ADC.
- Alert tunables: `alert_threshold` (default 20) and `alert_alignment_period`
  (default `86400s`), same defaults as the old `apply.sh`.
- The log filter in `monitoring.tf` must stay byte-for-byte in sync with
  `docs/alerting-icon-forge.md`.
