terraform {
  required_version = ">= 1.7"

  backend "gcs" {
    bucket = "recipe-lanes-tfstate"
    prefix = "envs/staging"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = "recipe-lanes-staging"
  region  = "us-central1"
}

variable "alert_email" {
  description = "Recipient for icon-forge alerts (pass via TF_VAR_alert_email or terraform.tfvars — not committed)."
  type        = string
}

module "baseline" {
  source = "../../modules/project-baseline"

  project_id              = "recipe-lanes-staging"
  project_number          = "580985798196"
  enable_preview_pipeline = true

  alert_email = var.alert_email
}
