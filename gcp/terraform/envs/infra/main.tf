terraform {
  required_version = ">= 1.7"

  backend "gcs" {
    bucket = "recipe-lanes-tfstate"
    prefix = "envs/infra"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

# recipe-lanes-infra is the dedicated home for cross-cutting infrastructure
# (starting with DNS). Kept separate from the prod app project so infra and
# product concerns don't share a blast radius.
provider "google" {
  project = "recipe-lanes-infra"
  region  = "us-central1"
}
