# App Hosting runtime SA (firebase-app-hosting-compute) role grants shared by
# all envs. The Next.js server actions run as this SA and need:
#   - aiplatform.user          Vertex AI (recipe parser: genkit vertexAI)
#   - cloudtasks.enqueuer       enqueue icon-forge tasks to processIconTask
#   - iam.serviceAccountUser    mint the OIDC token the queue uses to invoke it
#   - cloudtrace.agent / logging.logWriter   telemetry
# (run.invoker is granted separately by app_hosting_run_invoker in
# icon-processor.tf — kept there to avoid churning its state address.)
#
# Prod had these from historical imperative grants that were never in Terraform;
# capturing them here closes that gap and gives staging/ctf the same parity.
locals {
  app_hosting_sa = "firebase-app-hosting-compute@${var.project_id}.iam.gserviceaccount.com"

  app_hosting_extra_roles = [
    "roles/aiplatform.user",
    "roles/cloudtasks.enqueuer",
    "roles/iam.serviceAccountUser",
    "roles/cloudtrace.agent",
    "roles/logging.logWriter",
  ]
}

resource "google_project_iam_member" "app_hosting_extra" {
  for_each = toset(local.app_hosting_extra_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${local.app_hosting_sa}"
}
