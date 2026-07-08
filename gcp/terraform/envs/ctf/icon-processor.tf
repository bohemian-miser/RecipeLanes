# Icon-processor function identity for the CTF project.
# The processIconTask Cloud Function runs AS this SA, so it must exist before
# the function can deploy. Mirrors modules/project-baseline/icon-processor.tf
# (envs/ctf doesn't use that module — it's a standalone project).
#
# Isolation still holds: these grants are all on recipe-lanes-ctf only.

resource "google_service_account" "icon_processor" {
  project      = google_project.ctf.project_id
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

  project = google_project.ctf.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.icon_processor.email}"
}

# gen2 Cloud Functions build runs as the default compute SA, which on new
# org projects gets no roles by default — grant the builder role so function
# builds succeed.
resource "google_project_iam_member" "compute_cloudbuild_builder" {
  project = google_project.ctf.project_id
  role    = "roles/cloudbuild.builds.builder"
  member  = "serviceAccount:${google_project.ctf.number}-compute@developer.gserviceaccount.com"
}

# App Hosting runtime SA (the Next.js server actions run as this). To FORGE
# icons it enqueues Cloud Tasks to the processIconTask queue and mints the
# invoker OIDC token, so it needs cloudtasks.enqueuer + iam.serviceAccountUser.
# The rest mirror prod's firebase-app-hosting-compute grants (trace/logging/
# run.invoker) so the CTF app has parity. Without cloudtasks.enqueuer the forge
# silently no-ops (nothing reaches processIconTask).
locals {
  apphosting_sa = "firebase-app-hosting-compute@${google_project.ctf.project_id}.iam.gserviceaccount.com"
  apphosting_roles = [
    "roles/cloudtasks.enqueuer",
    "roles/iam.serviceAccountUser",
    "roles/run.invoker",
    "roles/cloudtrace.agent",
    "roles/logging.logWriter",
  ]
}

resource "google_project_iam_member" "apphosting_sa" {
  for_each = toset(local.apphosting_roles)

  project = google_project.ctf.project_id
  role    = each.value
  member  = "serviceAccount:${local.apphosting_sa}"
}
