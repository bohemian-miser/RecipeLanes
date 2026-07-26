terraform {
  required_version = ">= 1.7"

  backend "gcs" {
    bucket = "recipe-lanes-tfstate"
    prefix = "envs/prod"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = "recipe-lanes"
  region  = "us-central1"
}

variable "alert_email" {
  description = "Recipient for icon-forge alerts (pass via TF_VAR_alert_email or terraform.tfvars — not committed)."
  type        = string
}

module "baseline" {
  source = "../../modules/project-baseline"

  project_id     = "recipe-lanes"
  project_number = "173546820314"

  # Per-PR previews deploy to staging only; prod's existing `preview` Artifact
  # Registry repo is deliberately left unmanaged.
  enable_preview_pipeline = false

  alert_email = var.alert_email
}
