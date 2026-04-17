#!/usr/bin/env bash
# Usage: ./scripts/recipe-logs.sh <recipeId> [--prod] [--since 30m]
# Shows all backend logs related to icon resolution for a recipe.
# Tails both the Next.js app (skipping-down) and the CF (vectorsearch-searchiconvector).

set -euo pipefail

RECIPE_ID=""
PROJECT="recipe-lanes-staging"
SINCE="60m"

i=1
while [[ $i -le $# ]]; do
  arg="${!i}"
  case "$arg" in
    --prod)   PROJECT="recipe-lanes" ;;
    --since)  i=$((i+1)); SINCE="${!i}" ;;
    --since=*) SINCE="${arg#--since=}" ;;
    --*) ;;
    *)  RECIPE_ID="$arg" ;;
  esac
  i=$((i+1))
done

if [[ -z "$RECIPE_ID" ]]; then
  echo "Usage: $0 <recipeId> [--prod] [--since 30m]"
  exit 1
fi

# Convert "30m" / "2h" to a UTC timestamp
if [[ "$SINCE" =~ ^([0-9]+)m$ ]]; then
  SINCE_TS=$(date -u -d "${BASH_REMATCH[1]} minutes ago" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
             || date -u -v-"${BASH_REMATCH[1]}M" '+%Y-%m-%dT%H:%M:%SZ')
elif [[ "$SINCE" =~ ^([0-9]+)h$ ]]; then
  SINCE_TS=$(date -u -d "${BASH_REMATCH[1]} hours ago" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
             || date -u -v-"${BASH_REMATCH[1]}H" '+%Y-%m-%dT%H:%M:%SZ')
else
  SINCE_TS="$SINCE"
fi

echo "========================================================"
echo " Recipe:  $RECIPE_ID"
echo " Project: $PROJECT"
echo " Since:   $SINCE_TS"
echo "========================================================"

# ── Next.js app logs (recipe-specific + icon resolution) ─────────────────────
echo ""
echo "── App server (skipping-down) ──────────────────────────"
gcloud logging read \
  "resource.type=\"cloud_run_revision\"
   AND resource.labels.service_name=\"skipping-down\"
   AND (textPayload=~\"${RECIPE_ID}\" OR textPayload=~\"resolveRecipeIcons|resolveFromIndex|assignShortlist|queueIconForGeneration|Processing.*nodes|batch CF call|batch search failed\")
   AND timestamp>=\"${SINCE_TS}\"" \
  --project="$PROJECT" \
  --limit=100 \
  --format="value(timestamp,textPayload)" \
  2>&1 | awk 'NF && $0 !~ /^$/' | sort

# ── CF logs ───────────────────────────────────────────────────────────────────
echo ""
echo "── Vector Search CF (vectorsearch-searchiconvector) ─────"
gcloud logging read \
  "resource.type=\"cloud_run_revision\"
   AND resource.labels.service_name=\"vectorsearch-searchiconvector\"
   AND timestamp>=\"${SINCE_TS}\"" \
  --project="$PROJECT" \
  --limit=60 \
  --format="value(timestamp,textPayload,severity)" \
  2>&1 | awk 'NF && $0 !~ /^$/' | sort

echo ""
echo "========================================================"
