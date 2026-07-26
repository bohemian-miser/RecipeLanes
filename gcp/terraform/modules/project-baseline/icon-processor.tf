# Icon-processor function identity + roles.
# Source of truth was recipe-lanes/scripts/setup-icon-processor-sa.sh.
#
# IAM is managed with additive google_project_iam_member ONLY — never
# google_project_iam_policy/binding, which are authoritative and can wipe
# bindings that exist outside this config.

resource "google_service_account" "icon_processor" {
  project      = var.project_id
  account_id   = "icon-processor"
  display_name = "Icon Processor Function Identity"
}

locals {
  icon_processor_roles = [
    "roles/datastore.user",
    "roles/storage.objectAdmin",
    "roles/aiplatform.user",
    "roles/logging.logWriter",
    "roles/cloudtrace.agent",
    "roles/iam.serviceAccountTokenCreator",
    "roles/cloudtasks.enqueuer",
    "roles/run.invoker",
  ]
}

resource "google_project_iam_member" "icon_processor" {
  for_each = toset(local.icon_processor_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.icon_processor.email}"
}

# App Hosting frontend must be able to invoke the icon-processor Cloud Run service.
resource "google_project_iam_member" "app_hosting_run_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:firebase-app-hosting-compute@${var.project_id}.iam.gserviceaccount.com"
}
