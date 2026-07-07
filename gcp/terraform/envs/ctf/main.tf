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

# --- the CTF project --------------------------------------------------------
# A deliberately-vulnerable teaching fork of the app. It is a SEPARATE project
# on purpose: its own Firestore/Auth/Storage and service accounts, zero access
# to prod or staging data. A student who exploits it can only reach throwaway
# CTF data. Nothing here should ever be granted IAM on recipe-lanes[-staging].
resource "google_project" "ctf" {
  name            = "RecipeLanes CTF"
  project_id      = "recipe-lanes-ctf"
  billing_account = var.billing_account

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
  for_each = toset([
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
    "firebase.googleapis.com",
    "firestore.googleapis.com",
    "identitytoolkit.googleapis.com",
    "storage.googleapis.com",
    "firebasestorage.googleapis.com",
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "firebaseapphosting.googleapis.com",
    "aiplatform.googleapis.com",
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

output "ctf_project_id" {
  value = google_project.ctf.project_id
}

output "ctf_project_number" {
  value = google_project.ctf.number
}
