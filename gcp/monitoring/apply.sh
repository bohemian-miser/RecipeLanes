#!/usr/bin/env bash
#
# apply.sh — idempotently apply the icon-forge monitoring stack to a GCP project.
#
# Usage:
#   ./apply.sh <PROJECT_ID> [ALERT_EMAIL]
#   PROJECT_ID=recipe-lanes-staging ALERT_EMAIL=you@example.com ./apply.sh
#
# Env vars (all overridable):
#   PROJECT_ID               GCP project (positional $1 wins). Required.
#   ALERT_EMAIL              Email for the notification channel (positional $2 wins).
#                            Default: you@example.com
#   ALERT_THRESHOLD          N — fire when count > N.       Default: 50
#   ALERT_ALIGNMENT_PERIOD   X — alignment window seconds.  Default: 600s
#   DRY_RUN=1 (or --dry-run) Print gcloud commands without executing.
#
# Idempotent: create-or-update for the metric, the channel, and the policy.
# Untested against live gcloud — run with --dry-run first.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- args / env -------------------------------------------------------------
DRY_RUN="${DRY_RUN:-0}"
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done

PROJECT_ID="${POSITIONAL[0]:-${PROJECT_ID:-}}"
# No committed default — pass the alert recipient explicitly (positional $2 or ALERT_EMAIL).
# Only required when the notification channel must be created (it doesn't exist yet).
ALERT_EMAIL="${POSITIONAL[1]:-${ALERT_EMAIL:-}}"
ALERT_THRESHOLD="${ALERT_THRESHOLD:-20}"
ALERT_ALIGNMENT_PERIOD="${ALERT_ALIGNMENT_PERIOD:-86400s}"

METRIC_NAME="icon_forged_count"
CHANNEL_DISPLAY_NAME="Icon-forge alerts"
POLICY_DISPLAY_NAME="Icon forge rate too high"

METRIC_FILE="${SCRIPT_DIR}/log-metric.icon_forged_count.yaml"
CHANNEL_FILE="${SCRIPT_DIR}/notification-channel.email.yaml"
POLICY_FILE="${SCRIPT_DIR}/alert-policy.icon_forged_rate.yaml"

if [ -z "${PROJECT_ID}" ]; then
  echo "Usage: $0 <PROJECT_ID> [ALERT_EMAIL]   (or set PROJECT_ID / ALERT_EMAIL env)" >&2
  exit 1
fi

# --- helpers ----------------------------------------------------------------
# run: echo (dry-run) or execute a command.
run() {
  if [ "${DRY_RUN}" = "1" ]; then
    printf '  [dry-run]'; printf ' %q' "$@"; printf '\n'
    return 0
  fi
  "$@"
}

# capture: like run, but returns stdout (always executes unless dry-run, in which
# case it echoes and returns empty so callers fall through to the "create" path).
capture() {
  if [ "${DRY_RUN}" = "1" ]; then
    { printf '  [dry-run]'; printf ' %q' "$@"; printf '\n'; } >&2
    echo ""
    return 0
  fi
  "$@"
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "==> icon-forge monitoring apply"
echo "    project       : ${PROJECT_ID}"
echo "    alert email   : ${ALERT_EMAIL}"
echo "    threshold (N) : ${ALERT_THRESHOLD}"
echo "    window    (X) : ${ALERT_ALIGNMENT_PERIOD}"
echo "    dry-run       : ${DRY_RUN}"
echo

# --- preflight --------------------------------------------------------------
if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud CLI not found on PATH." >&2
  exit 1
fi
echo "[0/3] gcloud found: $(command -v gcloud)"

# --- 1. log-based metric (create-or-update) ---------------------------------
echo "[1/3] log-based metric '${METRIC_NAME}'"
if gcloud logging metrics describe "${METRIC_NAME}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "      exists -> update"
  run gcloud logging metrics update "${METRIC_NAME}" \
    --project="${PROJECT_ID}" \
    --config-from-file="${METRIC_FILE}"
else
  echo "      missing -> create"
  run gcloud logging metrics create "${METRIC_NAME}" \
    --project="${PROJECT_ID}" \
    --config-from-file="${METRIC_FILE}"
fi

# --- 2. email notification channel (lookup-or-create) -----------------------
echo "[2/3] notification channel '${CHANNEL_DISPLAY_NAME}'"
CHANNEL_ID="$(capture gcloud beta monitoring channels list \
  --project="${PROJECT_ID}" \
  --filter="displayName=\"${CHANNEL_DISPLAY_NAME}\"" \
  --format="value(name)" | head -n1 || true)"

if [ -n "${CHANNEL_ID}" ]; then
  echo "      exists -> ${CHANNEL_ID}"
else
  echo "      missing -> create"
  if [ -z "${ALERT_EMAIL}" ]; then
    echo "ERROR: notification channel '${CHANNEL_DISPLAY_NAME}' does not exist and no ALERT_EMAIL was given." >&2
    echo "       Re-run with the recipient, e.g.: $0 ${PROJECT_ID} you@example.com" >&2
    exit 1
  fi
  RENDERED_CHANNEL="${TMP_DIR}/channel.yaml"
  sed "s|__ALERT_EMAIL__|${ALERT_EMAIL}|g" "${CHANNEL_FILE}" > "${RENDERED_CHANNEL}"
  CHANNEL_ID="$(capture gcloud beta monitoring channels create \
    --project="${PROJECT_ID}" \
    --channel-content-from-file="${RENDERED_CHANNEL}" \
    --format="value(name)" || true)"
  if [ -z "${CHANNEL_ID}" ] && [ "${DRY_RUN}" != "1" ]; then
    echo "ERROR: failed to create/resolve notification channel." >&2
    exit 1
  fi
  echo "      created -> ${CHANNEL_ID:-<dry-run-channel>}"
fi
# Placeholder so dry-run rendering is still valid/inspectable.
CHANNEL_ID="${CHANNEL_ID:-projects/${PROJECT_ID}/notificationChannels/DRY_RUN}"

# --- 3. alert policy (create-or-update by displayName) ----------------------
echo "[3/3] alert policy '${POLICY_DISPLAY_NAME}'"
RENDERED_POLICY="${TMP_DIR}/policy.yaml"
sed \
  -e "s|__THRESHOLD__|${ALERT_THRESHOLD}|g" \
  -e "s|__ALIGNMENT_PERIOD__|${ALERT_ALIGNMENT_PERIOD}|g" \
  -e "s|__NOTIFICATION_CHANNEL__|${CHANNEL_ID}|g" \
  "${POLICY_FILE}" > "${RENDERED_POLICY}"

POLICY_ID="$(capture gcloud alpha monitoring policies list \
  --project="${PROJECT_ID}" \
  --filter="displayName=\"${POLICY_DISPLAY_NAME}\"" \
  --format="value(name)" | head -n1 || true)"

if [ -n "${POLICY_ID}" ]; then
  echo "      exists -> update (${POLICY_ID})"
  run gcloud alpha monitoring policies update "${POLICY_ID}" \
    --project="${PROJECT_ID}" \
    --policy-from-file="${RENDERED_POLICY}"
else
  echo "      missing -> create"
  run gcloud alpha monitoring policies create \
    --project="${PROJECT_ID}" \
    --policy-from-file="${RENDERED_POLICY}"
fi

echo
echo "==> done."
echo "    metric  : ${METRIC_NAME}"
echo "    channel : ${CHANNEL_ID}"
echo "    policy  : ${POLICY_DISPLAY_NAME} (N=${ALERT_THRESHOLD}, X=${ALERT_ALIGNMENT_PERIOD})"
