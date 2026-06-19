#!/usr/bin/env bash
#
# export.sh — capture the CURRENT live config from a project into the repo yaml,
# so you can reconcile the actual (manually-created) prod config with what is
# committed here.
#
# Usage:
#   ./export.sh <PROJECT_ID>          # e.g. ./export.sh recipe-lanes
#
# Writes:
#   log-metric.icon_forged_count.yaml      (from gcloud logging metrics describe)
#   alert-policy.icon_forged_rate.live.yaml (from gcloud alpha monitoring policies)
#
# The alert policy is exported to a *.live.yaml sidecar (not the templated source),
# because the live policy contains a concrete threshold/period/channel rather than
# the __PLACEHOLDERS__. Diff it against alert-policy.icon_forged_rate.yaml by eye.
#
# Untested against live gcloud.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PROJECT_ID="${1:-${PROJECT_ID:-}}"
if [ -z "${PROJECT_ID}" ]; then
  echo "Usage: $0 <PROJECT_ID>" >&2
  exit 1
fi

METRIC_NAME="icon_forged_count"
POLICY_DISPLAY_NAME="Icon forge rate too high (Bug 171)"
METRIC_OUT="${SCRIPT_DIR}/log-metric.icon_forged_count.yaml"
POLICY_OUT="${SCRIPT_DIR}/alert-policy.icon_forged_rate.live.yaml"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud CLI not found on PATH." >&2
  exit 1
fi

echo "==> exporting log metric '${METRIC_NAME}' from ${PROJECT_ID}"
gcloud logging metrics describe "${METRIC_NAME}" \
  --project="${PROJECT_ID}" \
  --format=yaml > "${METRIC_OUT}"
echo "    wrote ${METRIC_OUT}"

echo "==> exporting alert policy '${POLICY_DISPLAY_NAME}' from ${PROJECT_ID}"
gcloud alpha monitoring policies list \
  --project="${PROJECT_ID}" \
  --filter="displayName=\"${POLICY_DISPLAY_NAME}\"" \
  --format=yaml > "${POLICY_OUT}"
echo "    wrote ${POLICY_OUT}"

echo
echo "==> done. Review the diff and reconcile by hand:"
echo "    git diff -- ${METRIC_OUT}"
echo "    diff alert-policy.icon_forged_rate.yaml ${POLICY_OUT}"
