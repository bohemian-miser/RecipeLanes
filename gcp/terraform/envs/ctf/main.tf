terraform {
  required_version = ">= 1.7"

  backend "gcs" {
    bucket = "recipe-lanes-tfstate"
    prefix = "envs/ctf"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
  }
}

# No project set on the providers: the google_project resource below CREATES
# recipe-lanes-ctf, so API calls during creation are billed to the ADC quota
# project, not the not-yet-existing CTF project.
provider "google" {
  region = "us-central1"
}

provider "google-beta" {
  region = "us-central1"
}

# No default: this is an internal identifier we keep out of the public repo.
# Pass it at apply time via TF_VAR_billing_account (same one prod/staging use).
variable "billing_account" {
  description = "Billing account to attach recipe-lanes-ctf to (same one prod/staging use). Set via TF_VAR_billing_account."
  type        = string
}

variable "alert_email" {
  description = "Recipient for the icon-forge alert (same as prod). Set via TF_VAR_alert_email."
  type        = string
}

# --- the CTF project --------------------------------------------------------
# A deliberately-vulnerable teaching fork of the app. It is a SEPARATE project
# on purpose: its own Firestore/Auth/Storage and service accounts, zero access
# to prod or staging data. A student who exploits it can only reach throwaway
# CTF data. Nothing here should ever be granted IAM on recipe-lanes[-staging].
resource "google_project" "ctf" {
  name            = "RecipeLanes CTF"
  project_id      = "recipe-lanes-ctf"
  billing_account = var.billing_account

  # The recipelanes.com Cloud org (auto-created with the Workspace domain).
  # New projects land in it by default; pinning this keeps Terraform from
  # trying to move the project OUT of the org on apply. (Prod predates the
  # org and is org-less, so it has no org_id.)
  org_id = "247736101927"

  labels = {
    environment = "ctf"
    purpose     = "security-training"
  }

  # Guard against a fat-fingered `terraform destroy` nuking the project.
  lifecycle {
    prevent_destroy = true
  }
}

# --- APIs -------------------------------------------------------------------
# Everything the App Hosting fork will need at deploy + runtime. App Hosting
# itself (firebaseapphosting) and the domain claim are wired in a later PR,
# once the fork branch exists and the backend can generate its serving records.
resource "google_project_service" "ctf" {
  # run / artifactregistry / aiplatform are owned by module.baseline (shared
  # across envs); the rest are CTF-specific extras the module doesn't cover.
  for_each = toset([
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
    "firebase.googleapis.com",
    "firestore.googleapis.com",
    "identitytoolkit.googleapis.com",
    "storage.googleapis.com",
    "firebasestorage.googleapis.com",
    "cloudbuild.googleapis.com",
    "firebaseapphosting.googleapis.com",
  ])

  project            = google_project.ctf.project_id
  service            = each.value
  disable_on_destroy = false
}

# --- Firebase ---------------------------------------------------------------
# Turns the bare GCP project into a Firebase project (google-beta resource).
resource "google_firebase_project" "ctf" {
  provider = google-beta
  project  = google_project.ctf.project_id

  depends_on = [google_project_service.ctf]
}

# --- shared baseline ---------------------------------------------------------
# icon-processor SA + roles, app-hosting SA roles, core APIs, and icon-forge
# monitoring — the same module prod/staging use. Preview pipeline stays off
# (previews deploy to staging only).
module "baseline" {
  source = "../../modules/project-baseline"

  project_id              = google_project.ctf.project_id
  project_number          = google_project.ctf.number
  enable_preview_pipeline = false
  alert_email             = var.alert_email

  depends_on = [google_project_service.ctf]
}

# --- CTF-specific IAM (not in the shared module) -----------------------------
# gen2 Cloud Functions build runs as the default compute SA. New org projects
# grant that SA nothing by default (prod/staging predate the org and inherited
# Editor), so CTF alone needs the builder role explicitly for function builds.
resource "google_project_iam_member" "compute_cloudbuild_builder" {
  project = google_project.ctf.project_id
  role    = "roles/cloudbuild.builds.builder"
  member  = "serviceAccount:${google_project.ctf.number}-compute@developer.gserviceaccount.com"
}

output "ctf_project_id" {
  value = google_project.ctf.project_id
}

output "ctf_project_number" {
  value = google_project.ctf.number
}
