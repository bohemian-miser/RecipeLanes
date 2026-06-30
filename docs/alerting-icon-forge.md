# Icon-forge alerting (Bug 171) — pure-GCP runbook

Alert when **more than N icons are generated in X minutes**.

> **Source of truth: [`gcp/monitoring/`](../gcp/monitoring/).** The metric,
> notification channel, and alert policy are committed there as gcloud-consumable
> YAML, with `apply.sh` (idempotent create-or-update, per-project channel) and
> `export.sh` (capture live config back into the repo). Apply with
> `./gcp/monitoring/apply.sh recipe-lanes-staging you@example.com` (run with
> `--dry-run` first). The prose below explains the design and the manual gcloud
> equivalents; prefer the committed scripts for any real change.

## Design: why pure-GCP

The app's only job is to emit a clean, structured log signal on each successful
icon generation. **All counting, thresholds, and notification delivery live in
GCP Cloud Monitoring — never in the app.** Rationale:

- **No app config/UI for thresholds.** Tuning N and X is an ops concern; baking it
  into the app would mean a redeploy for every threshold tweak.
- **Delivery is GCP's job.** Email/Slack/PagerDuty routing is configured once as a
  notification channel and reused; the app never touches it.
- **Survives app bugs.** Because the alert counts log entries in GCP, it keeps
  working even if app-side counting logic regressed — there is no app-side counting
  logic to regress.
- **Tune with zero redeploy.** Changing N or X is a `gcloud`/console edit of the
  alert policy. That is the entire point of this approach.

## The app signal

On each **successful** icon generation, `processIconTaskHandler`
(`recipe-lanes/functions/src/index.ts`) emits exactly one structured JSON log line
*after the publish transaction commits* (genuine success only — never on
retry/failure paths):

```json
{ "event": "icon_forged", "ingredient": "<standardized name>", "queueDocId": "<id>", "recipeCount": 3, "ts": "2026-06-13T..." }
```

Because it is JSON written to stdout, Cloud Logging parses it into `jsonPayload`,
so the alert can match on the stable field `jsonPayload.event="icon_forged"`.

## Resource type

The icon function is a **Firebase Functions v2** function
(`firebase-functions/v2/tasks` → `onTaskDispatched`). v2 functions run on Cloud
Run, so logs carry the resource type **`cloud_run_revision`**, and the function
name appears as the Cloud Run service label `resource.labels.service_name`.

> No explicit region is set in the code, so the default region is `us-central1`.
> Project ids: `recipe-lanes` (prod), `recipe-lanes-staging` (staging).

## 1. Create the log-based counter metric

Run once per project (swap `--project` for staging vs prod).

```bash
gcloud logging metrics create icon_forged_count \
  --project=recipe-lanes \
  --description="Count of successful icon generations (Bug 171 alerting)" \
  --log-filter='resource.type="cloud_run_revision"
resource.labels.service_name="processicontask"
jsonPayload.event="icon_forged"'
```

Notes:
- Cloud Run lowercases the service name, so the function `processIconTask` appears
  as `processicontask`. Verify with:
  `gcloud logging read 'jsonPayload.event="icon_forged"' --project=recipe-lanes --limit=1 --format=json`
  and copy the exact `resource.labels.service_name`.
- This is a **counter** metric (one increment per matching log entry). No value
  extractor is needed.

## 2. Create the Cloud Monitoring alert policy

Fires when the metric's count exceeds **N** within an **X-minute** alignment
window. Example below: **N = 50** icons in **X = 10** minutes. Tune freely later.

First create (or reuse) a notification channel. Email example:

```bash
gcloud beta monitoring channels create \
  --project=recipe-lanes \
  --display-name="Icon-forge alerts" \
  --type=email \
  --channel-labels=email_address=you@example.com
# Note the returned channel id: projects/recipe-lanes/notificationChannels/XXXX
```

(For Slack: `--type=slack` with a configured Slack channel, or wire a PagerDuty/
webhook channel — same `channels create` flow.)

Then create the policy from a YAML condition file:

```bash
cat > /tmp/icon-forge-policy.yaml <<'YAML'
displayName: "Icon forge rate too high"
combiner: OR
conditions:
  - displayName: "too many icon_forged"
    conditionThreshold:
      filter: 'metric.type="logging.googleapis.com/user/icon_forged_count" resource.type="cloud_run_revision"'
      comparison: COMPARISON_GT
      thresholdValue: 20            # <-- N
      duration: 0s
      aggregations:
        - alignmentPeriod: 86400s  # <-- X (1 day)
          perSeriesAligner: ALIGN_COUNT
      trigger:
        count: 1
notificationChannels:
  - projects/recipe-lanes/notificationChannels/XXXX
YAML

gcloud alpha monitoring policies create \
  --project=recipe-lanes \
  --policy-from-file=/tmp/icon-forge-policy.yaml
```

How it reads: each `alignmentPeriod` (X = 86400s / 1 day) the aligner counts
matching log entries; if that count is greater than `thresholdValue` (N = 20) the
policy fires and notifies the attached channel(s).

## 3. Tuning N and X — no app redeploy

To change the threshold or window, edit the alert policy only:

```bash
# List policies to get the policy id
gcloud alpha monitoring policies list --project=recipe-lanes \
  --filter='displayName="Icon forge rate too high (Bug 171)"'

# Update from an edited YAML (change thresholdValue / alignmentPeriod)
gcloud alpha monitoring policies update POLICY_ID \
  --project=recipe-lanes \
  --policy-from-file=/tmp/icon-forge-policy.yaml
```

Or adjust the same two fields in the Cloud Monitoring console
(Alerting → the policy → Edit condition). **No app build or deploy is involved** —
that is the whole point of the pure-GCP design.

## Verifying end to end

1. Generate an icon in staging.
2. Confirm the log entry:
   `gcloud logging read 'jsonPayload.event="icon_forged"' --project=recipe-lanes-staging --limit=5`
3. Confirm the metric increments in Monitoring → Metrics explorer
   (`logging.googleapis.com/user/icon_forged_count`).
4. Temporarily lower N to force the alert and confirm the notification arrives.
