# Icon-forge alerting as code (`gcp/monitoring/`)

> **Superseded by Terraform.** This stack is now declared in
> [`gcp/terraform/`](../terraform/README.md) (`modules/project-baseline/monitoring.tf`).
> These scripts remain only until both envs have been imported + applied via
> Terraform; do not evolve the YAML here — change the Terraform instead.

Source of truth for the **Cloud Monitoring** alert that fires when too many icons
are forged in a short window (Bug 171). The team originally created this by hand
in the prod project; these files commit that config and make it reproducible
across projects.

The design rationale (pure-GCP, no app-side counting/thresholds) lives in
[`docs/alerting-icon-forge.md`](../../docs/alerting-icon-forge.md). This directory
is the **machine-readable counterpart** of that runbook.

> **Untested against live gcloud.** These scripts were authored without GCP
> credentials and have only been syntax/YAML validated. **Always run `apply.sh`
> with `--dry-run` first** and eyeball the emitted gcloud commands before applying
> for real. Double-check the `gcloud alpha/beta monitoring` flag names against
> your installed gcloud version (see "Flags to verify" below).

## Files

| File | What it is |
|---|---|
| `log-metric.icon_forged_count.yaml` | Log-based **counter** metric. Filter matches the `icon_forged` JSON log from `processicontask` (Cloud Run). Consumed by `gcloud logging metrics create/update --config-from-file`. |
| `notification-channel.email.yaml` | Email notification channel template. `__ALERT_EMAIL__` is rendered per project. Channels are **per-project**. |
| `alert-policy.icon_forged_rate.yaml` | Alert policy **template** with `__THRESHOLD__`, `__ALIGNMENT_PERIOD__`, `__NOTIFICATION_CHANNEL__` placeholders rendered at apply time. |
| `apply.sh` | Idempotent create-or-update of metric + channel + policy. |
| `export.sh` | Dumps the **current live** metric + policy from a project into yaml for reconciliation. |

## Apply

```bash
# Staging
./apply.sh recipe-lanes-staging you@example.com

# Prod (only when staging is verified)
./apply.sh recipe-lanes you@example.com

# Dry run (prints gcloud commands, executes nothing) — DO THIS FIRST
DRY_RUN=1 ./apply.sh recipe-lanes-staging you@example.com
#   or:  ./apply.sh --dry-run recipe-lanes-staging you@example.com
```

Tune N (threshold) and X (window) via env vars — no app redeploy:

```bash
ALERT_THRESHOLD=100 ALERT_ALIGNMENT_PERIOD=300s ./apply.sh recipe-lanes-staging you@example.com
```

Defaults mirror the live prod policy: `ALERT_THRESHOLD=20`,
`ALERT_ALIGNMENT_PERIOD=86400s` (1 day). `ALERT_EMAIL` has no default — pass the
recipient explicitly (required only when the notification channel must be created).

### Idempotency (create-or-update)

`apply.sh` never blindly creates duplicates:

- **Metric** — `gcloud logging metrics describe` decides create vs update.
- **Channel** — looked up by `displayName`; created only if absent. The resolved
  channel id is injected into the rendered policy. **Channels are per-project**, so
  each project gets its own channel id.
- **Policy** — listed by `displayName`; `update --policy-from-file` if it exists,
  else `create`. Re-running is safe and converges to the committed definition.

## Capture / reconcile live prod config

To pull what is *actually* live (e.g. the hand-made prod policy) into the repo:

```bash
./export.sh recipe-lanes
# writes log-metric.icon_forged_count.yaml and
#        alert-policy.icon_forged_rate.live.yaml  (sidecar with concrete values)
git diff   # reconcile against the committed template by eye
```

## Log retention note

- The `icon_forged` log entries live in the **`_Default` Cloud Logging bucket**,
  which has a **30-day** default retention. If you need longer audit retention,
  either **raise the retention on the `_Default` bucket** (`gcloud logging buckets
  update _Default --location=global --retention-days=N`) or add a **BigQuery log
  sink** for the `icon_forged` filter.
- The **alert metric time series** (`logging.googleapis.com/user/icon_forged_count`)
  is retained for **~24 months** in Cloud Monitoring, independent of log retention —
  so alerting/history survives the 30-day log window.

## Flags to verify on first `--dry-run`

These commands sit on `gcloud alpha`/`beta` surfaces; confirm against your gcloud:

- `gcloud logging metrics create/update --config-from-file`
- `gcloud beta monitoring channels list/create --channel-content-from-file`
- `gcloud alpha monitoring policies list/create/update --policy-from-file`
