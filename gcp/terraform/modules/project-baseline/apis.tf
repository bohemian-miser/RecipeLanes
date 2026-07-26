# APIs previously enabled by recipe-lanes/scripts/setup-preview-pipeline.sh.
# disable_on_destroy = false: removing a service from this list must never
# switch the API off in a live project.
resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "aiplatform.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
