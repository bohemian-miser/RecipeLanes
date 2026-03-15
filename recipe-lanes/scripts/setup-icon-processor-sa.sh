#!/bin/bash
# Dedicated Service Account Setup for Icon Processor Function

set -e

# Configuration
PROJECT_ID=$1
if [ -z "$PROJECT_ID" ]; then
    echo "Usage: $0 [PROJECT_ID]"
    exit 1
fi

SA_NAME="icon-processor"
SA_ID="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
DISPLAY_NAME="Icon Processor Function Identity"

echo "🚀 Setting up Service Account for Project: ${PROJECT_ID}"

# 1. Create the Service Account if it doesn't exist
if ! gcloud iam service-accounts describe "${SA_ID}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    echo "Creating service account: ${SA_NAME}"
    gcloud iam service-accounts create "${SA_NAME}" \
        --display-name="${DISPLAY_NAME}" \
        --project="${PROJECT_ID}"
else
    echo "Service account ${SA_NAME} already exists."
fi

# 2. Grant Required Roles
ROLES=(
    "roles/datastore.user"
    "roles/storage.objectAdmin"
    "roles/aiplatform.user"
    "roles/logging.logWriter"
    "roles/cloudtrace.agent"
    "roles/iam.serviceAccountTokenCreator"
    "roles/cloudtasks.enqueuer"
)

echo "Granting roles..."
for ROLE in "${ROLES[@]}"; do
    echo "Adding ${ROLE}..."
    gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
        --member="serviceAccount:${SA_ID}" \
        --role="${ROLE}" \
        --condition=None >/dev/null
done

echo "✅ Service Account Setup Complete!"
echo "ID: ${SA_ID}"
echo "Important: Remember to update your Cloud Function configuration to use this identity."
