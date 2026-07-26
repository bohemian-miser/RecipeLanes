# Per-PR Cloud Run preview pipeline (.github/workflows/pr-preview.yml).
# Source of truth was recipe-lanes/scripts/setup-preview-pipeline.sh.
# Gated by enable_preview_pipeline — previews deploy to staging only.

locals {
  # Deploy SA: what pr-preview.yml authenticates as (FIREBASE_SERVICE_ACCOUNT_STAGING).
  preview_deploy_sa = "firebase-adminsdk-fbsvc@${var.project_id}.iam.gserviceaccount.com"
  # Runtime SA: what the deployed Cloud Run service runs as (default compute SA).
  preview_runtime_sa = "${var.project_number}-compute@developer.gserviceaccount.com"

  preview_deploy_roles = [
    "roles/run.admin",
    "roles/iam.serviceAccountUser",
    "roles/artifactregistry.writer",
    "roles/artifactregistry.admin",
    # pr-preview.yml's authorized-domains automation PATCHes the Identity
    # Toolkit Admin API to (de)register each PR's preview hostname in Firebase
    # Auth authorized domains; needs firebaseauth.configs.update.
    "roles/firebaseauth.admin",
  ]
  preview_runtime_roles = [
    "roles/aiplatform.user",
    "roles/datastore.user",
    "roles/storage.objectAdmin",
  ]
}

resource "google_artifact_registry_repository" "preview" {
  count = var.enable_preview_pipeline ? 1 : 0

  project       = var.project_id
  location      = var.region
  repository_id = "preview"
  format        = "DOCKER"

  depends_on = [google_project_service.apis]
}

resource "google_project_iam_member" "preview_deploy" {
  for_each = var.enable_preview_pipeline ? toset(local.preview_deploy_roles) : toset([])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${local.preview_deploy_sa}"
}

resource "google_project_iam_member" "preview_runtime" {
  for_each = var.enable_preview_pipeline ? toset(local.preview_runtime_roles) : toset([])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${local.preview_runtime_sa}"
}
