#!/usr/bin/env bash
#
# import.sh — adopt the already-live GCP resources into Terraform state so the
# first `terraform apply` converges instead of trying to re-create them.
#
# Usage (from gcp/terraform/):
#   ./import.sh staging      # or: ./import.sh prod
#
# Prereqs:
#   - owner gcloud auth (gcloud auth login + gcloud auth application-default login)
#   - state bucket exists (./bootstrap-state-bucket.sh)
#   - terraform init has been run in the env dir
#   - TF_VAR_alert_email set (terraform needs vars even to import)
#
# Best-effort and idempotent: a resource that is already in state, or that
# doesn't exist remotely yet (apply will create it), logs a warning and the
# script moves on. Review `terraform plan` output afterwards — the goal is a
# plan that is empty or additive-only.

set -uo pipefail

ENV="${1:-}"
case "${ENV}" in
  staging) PROJECT_ID="recipe-lanes-staging"; PROJECT_NUMBER="580985798196"; PREVIEW=1 ;;
  prod)    PROJECT_ID="recipe-lanes";         PROJECT_NUMBER="173546820314"; PREVIEW=0 ;;
  *) echo "Usage: $0 staging|prod" >&2; exit 1 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/envs/${ENV}"

REGION="us-central1"
ICON_SA="icon-processor@${PROJECT_ID}.iam.gserviceaccount.com"
APP_HOSTING_SA="firebase-app-hosting-compute@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA="firebase-adminsdk-fbsvc@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

imp() {
  local addr="$1" id="$2"
  echo "--> import ${addr}"
  if ! terraform import "${addr}" "${id}"; then
    echo "    WARN: import failed for ${addr} (already in state, or not live yet) — continuing"
  fi
}

# --- APIs ---------------------------------------------------------------
for api in run.googleapis.com artifactregistry.googleapis.com aiplatform.googleapis.com; do
  imp "module.baseline.google_project_service.apis[\"${api}\"]" "${PROJECT_ID}/${api}"
done

# --- icon-processor SA + roles -------------------------------------------
imp 'module.baseline.google_service_account.icon_processor' \
    "projects/${PROJECT_ID}/serviceAccounts/${ICON_SA}"

for role in roles/datastore.user roles/storage.objectAdmin roles/aiplatform.user \
            roles/logging.logWriter roles/cloudtrace.agent \
            roles/iam.serviceAccountTokenCreator roles/cloudtasks.enqueuer roles/run.invoker; do
  imp "module.baseline.google_project_iam_member.icon_processor[\"${role}\"]" \
      "${PROJECT_ID} ${role} serviceAccount:${ICON_SA}"
done

imp 'module.baseline.google_project_iam_member.app_hosting_run_invoker' \
    "${PROJECT_ID} roles/run.invoker serviceAccount:${APP_HOSTING_SA}"

# --- preview pipeline (staging only) --------------------------------------
if [ "${PREVIEW}" = "1" ]; then
  imp 'module.baseline.google_artifact_registry_repository.preview[0]' \
      "projects/${PROJECT_ID}/locations/${REGION}/repositories/preview"

  for role in roles/run.admin roles/iam.serviceAccountUser \
              roles/artifactregistry.writer roles/artifactregistry.admin; do
    imp "module.baseline.google_project_iam_member.preview_deploy[\"${role}\"]" \
        "${PROJECT_ID} ${role} serviceAccount:${DEPLOY_SA}"
  done

  for role in roles/aiplatform.user roles/datastore.user roles/storage.objectAdmin; do
    imp "module.baseline.google_project_iam_member.preview_runtime[\"${role}\"]" \
        "${PROJECT_ID} ${role} serviceAccount:${RUNTIME_SA}"
  done
fi

# --- monitoring stack ------------------------------------------------------
# Metric name is deterministic; channel/policy ids are numeric and looked up
# live by displayName (matching gcp/monitoring/apply.sh semantics).
imp 'module.baseline.google_logging_metric.icon_forged_count' "icon_forged_count"

CHANNEL_ID="$(gcloud beta monitoring channels list --project="${PROJECT_ID}" \
  --filter='displayName="Icon-forge alerts"' --format='value(name)' 2>/dev/null | head -n1)"
if [ -n "${CHANNEL_ID}" ]; then
  imp 'module.baseline.google_monitoring_notification_channel.icon_forge_email' "${CHANNEL_ID}"
else
  echo "    NOTE: no live 'Icon-forge alerts' channel in ${PROJECT_ID}; apply will create it"
fi

POLICY_ID="$(gcloud alpha monitoring policies list --project="${PROJECT_ID}" \
  --filter='displayName="Icon forge rate too high"' --format='value(name)' 2>/dev/null | head -n1)"
if [ -n "${POLICY_ID}" ]; then
  imp 'module.baseline.google_monitoring_alert_policy.icon_forged_rate' "${POLICY_ID}"
else
  echo "    NOTE: no live 'Icon forge rate too high' policy in ${PROJECT_ID}; apply will create it"
fi

echo
echo "==> imports done for ${ENV}. Now run:  terraform plan"
echo "    Expect an empty or additive-only plan. Investigate any change/destroy"
echo "    before applying — especially in prod."
