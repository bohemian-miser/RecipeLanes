#!/usr/bin/env bash
#
# One-time bootstrap: create the GCS bucket that holds Terraform state for
# both envs (prefixes envs/staging and envs/prod). Lives in the PROD project
# because that's the durable admin home; the bucket itself is tiny.
#
# Usage: ./bootstrap-state-bucket.sh   (needs owner gcloud auth)

set -euo pipefail

BUCKET="recipe-lanes-tfstate"
PROJECT="recipe-lanes"
LOCATION="us-central1"

if gcloud storage buckets describe "gs://${BUCKET}" --project="${PROJECT}" >/dev/null 2>&1; then
  echo "Bucket gs://${BUCKET} already exists."
else
  echo "Creating gs://${BUCKET} in ${PROJECT} (${LOCATION})..."
  gcloud storage buckets create "gs://${BUCKET}" \
    --project="${PROJECT}" \
    --location="${LOCATION}" \
    --uniform-bucket-level-access \
    --public-access-prevention
fi

# Versioning: lets us recover from a corrupted/clobbered state file.
gcloud storage buckets update "gs://${BUCKET}" --versioning
echo "✅ State bucket ready: gs://${BUCKET}"
