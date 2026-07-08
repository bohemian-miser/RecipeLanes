#!/usr/bin/env bash
#
# runtime-adopt.sh — import the CTF runtime resources (created imperatively
# while bringing the site up) into Terraform state, so runtime.tf manages them
# without recreating anything.
#
# Run AFTER this branch's runtime.tf is merged to main (so shared state and the
# main config agree). Needs owner creds:
#   export GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token)
#
# Idempotent-ish: a resource already in state logs a warning and is skipped.

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

imp() {
  echo "--> import $1"
  terraform import "$1" "$2" || echo "    WARN: import failed (already in state?) — continuing"
}

imp 'google_firestore_database.default'                'projects/recipe-lanes-ctf/databases/(default)'
imp 'google_project_iam_member.apphosting_aiplatform'  'recipe-lanes-ctf roles/aiplatform.user serviceAccount:firebase-app-hosting-compute@recipe-lanes-ctf.iam.gserviceaccount.com'
imp 'google_identity_platform_config.auth'             'projects/recipe-lanes-ctf'

echo
echo "==> done. Now run:  terraform plan   (expect no changes / additive-only)"
