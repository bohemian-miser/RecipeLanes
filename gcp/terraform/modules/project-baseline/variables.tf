variable "project_id" {
  description = "GCP project id (recipe-lanes or recipe-lanes-staging)."
  type        = string
}

variable "project_number" {
  description = "Numeric project number (for the default compute runtime SA)."
  type        = string
}

variable "region" {
  description = "Primary region for regional resources (Artifact Registry)."
  type        = string
  default     = "us-central1"
}

variable "enable_preview_pipeline" {
  description = "Provision the per-PR Cloud Run preview pipeline (Artifact Registry repo + deploy/runtime IAM). Staging only today."
  type        = bool
  default     = false
}

variable "alert_email" {
  description = "Recipient for the icon-forge alert notification channel."
  type        = string
}

variable "alert_threshold" {
  description = "Icon-forge alert: fire when icon_forged_count > N within the alignment window."
  type        = number
  default     = 20
}

variable "alert_alignment_period" {
  description = "Icon-forge alert: alignment window (seconds, e.g. \"86400s\" = 1 day)."
  type        = string
  default     = "86400s"
}
