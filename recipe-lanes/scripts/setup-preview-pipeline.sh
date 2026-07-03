#!/bin/bash
# One-time IAM/API setup for the per-PR Cloud Run preview pipeline
# (.github/workflows/pr-preview.yml). Run once per project.
#
# Deploys always target recipe-lanes-staging (see pr-preview.yml GCP_PROJECT),
# but this script accepts any project so the same setup can be reused if a
# second preview target (e.g. a future main-tracking backend) is added.

set -e

PROJECT_ID=$1
if [ -z "$PROJECT_ID" ]; then
    echo "Usage: $0 [PROJECT_ID]"
    echo "  e.g. $0 recipe-lanes-staging"
    exit 1
fi

REGION="us-central1"
AR_REPO="preview"

# Deploy SA: the credential the pr-preview.yml workflow authenticates as
# (FIREBASE_SERVICE_ACCOUNT_STAGING secret -> default Firebase Admin SDK SA).
DEPLOY_SA="firebase-adminsdk-fbsvc@${PROJECT_ID}.iam.gserviceaccount.com"

# Runtime SA: what the deployed Cloud Run *service* runs as (default compute
# SA, since no --service-account is passed to `gcloud run deploy` in the
# workflow). Needs the same data-plane access the app needs at runtime.
COMPUTE_PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")
RUNTIME_SA="${COMPUTE_PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "🚀 Setting up preview pipeline for project: ${PROJECT_ID}"

# 1. Enable required APIs
APIS=(
    run.googleapis.com
    artifactregistry.googleapis.com
    aiplatform.googleapis.com
)
echo "Verifying required APIs..."
for API in "${APIS[@]}"; do
    if gcloud services list --project="${PROJECT_ID}" --filter="config.name:${API}" --format="value(config.name)" 2>/dev/null | grep -q "${API}"; then
        echo "API ${API} already enabled."
    else
        echo "Enabling ${API}..."
        gcloud services enable "${API}" --project="${PROJECT_ID}"
    fi
done

# 2. Create the Artifact Registry repo the workflow pushes preview images to
# (the workflow also self-heals this, but it needs create permission first).
if gcloud artifacts repositories describe "${AR_REPO}" --project="${PROJECT_ID}" --location="${REGION}" >/dev/null 2>&1; then
    echo "Artifact Registry repo ${AR_REPO} already exists."
else
    echo "Creating Artifact Registry repo: ${AR_REPO}"
    gcloud artifacts repositories create "${AR_REPO}" \
        --project="${PROJECT_ID}" --location="${REGION}" \
        --repository-format=docker
fi

# Function to check and add role (mirrors setup-icon-processor-sa.sh)
check_and_add_role() {
    local MEMBER=$1
    local ROLE=$2

    EXISTING=$(gcloud projects get-iam-policy "${PROJECT_ID}" \
        --flatten="bindings[].members" \
        --filter="bindings.role:${ROLE} AND bindings.members:${MEMBER}" \
        --format="value(bindings.role)" 2>/dev/null || true)

    if [ "$EXISTING" == "$ROLE" ]; then
        echo "Role ${ROLE} already granted to ${MEMBER}"
    else
        echo "Adding ${ROLE} to ${MEMBER}..."
        gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
            --member="${MEMBER}" \
            --role="${ROLE}" \
            --condition=None >/dev/null
    fi
}

# 3. Grant the deploy SA what it needs to build, push, and deploy previews
DEPLOY_ROLES=(
    "roles/run.admin"
    "roles/iam.serviceAccountUser"
    "roles/artifactregistry.writer"
    "roles/artifactregistry.admin"
)
echo "Verifying deploy SA (${DEPLOY_SA}) roles..."
for ROLE in "${DEPLOY_ROLES[@]}"; do
    check_and_add_role "serviceAccount:${DEPLOY_SA}" "${ROLE}"
done

# 4. Grant the runtime SA what the deployed preview app needs to serve traffic
RUNTIME_ROLES=(
    "roles/aiplatform.user"
    "roles/datastore.user"
    "roles/storage.objectAdmin"
)
echo "Verifying runtime SA (${RUNTIME_SA}) roles..."
for ROLE in "${RUNTIME_ROLES[@]}"; do
    check_and_add_role "serviceAccount:${RUNTIME_SA}" "${ROLE}"
done

echo "✅ Preview pipeline setup complete for ${PROJECT_ID}!"
echo "Deploy SA: ${DEPLOY_SA}"
echo "Runtime SA: ${RUNTIME_SA}"
echo "Artifact Registry: ${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}"
