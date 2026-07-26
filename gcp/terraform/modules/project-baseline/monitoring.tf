# Icon-forge alerting stack (Bug 171).
# Source of truth was gcp/monitoring/*.yaml + apply.sh; design rationale in
# docs/alerting-icon-forge.md. The log filter must stay byte-for-byte in sync
# with that runbook.

resource "google_logging_metric" "icon_forged_count" {
  project     = var.project_id
  name        = "icon_forged_count"
  description = "Count of successful icon generations (Bug 171 alerting)"

  # Counter metric: one increment per matching log entry (no value extractor).
  filter = "resource.type=\"cloud_run_revision\"\nresource.labels.service_name=\"processicontask\"\njsonPayload.event=\"icon_forged\""

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_monitoring_notification_channel" "icon_forge_email" {
  project      = var.project_id
  type         = "email"
  display_name = "Icon-forge alerts"
  description  = "Email channel for icon-forge rate alerts (Bug 171)"

  labels = {
    email_address = var.alert_email
  }
}

resource "google_monitoring_alert_policy" "icon_forged_rate" {
  project      = var.project_id
  display_name = "Icon forge rate too high"
  combiner     = "OR"

  conditions {
    display_name = "too many icon_forged"

    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/icon_forged_count\" resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = var.alert_threshold
      duration        = "0s"

      aggregations {
        alignment_period   = var.alert_alignment_period
        per_series_aligner = "ALIGN_COUNT"
      }

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    notification_prompts = ["OPENED"]
  }

  notification_channels = [google_monitoring_notification_channel.icon_forge_email.id]

  depends_on = [google_logging_metric.icon_forged_count]
}
