#!/bin/bash
set -e

# Usage (run from recipe-lanes/scripts/):
#   ./vector-search.sh deploy  --staging
#   ./vector-search.sh test    --staging [query]
#   ./vector-search.sh status  --staging

COMMAND=$1
ENV=$2
QUERY="${3:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECIPE_LANES_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -z "$COMMAND" ] || [ -z "$ENV" ]; then
  echo "Usage: ./vector-search.sh [deploy|test|status] [--local|--staging|--prod] [query]"
  exit 1
fi

case $ENV in
  --local)
    PROJECT="local"
    ENV_NAME="local"
    ;;
  --staging)
    PROJECT="recipe-lanes-staging"
    ENV_NAME="staging"
    ;;
  --prod)
    PROJECT="recipe-lanes"
    ENV_NAME="prod"
    ;;
  *)
    echo "Error: Environment must be --local, --staging, or --prod."
    exit 1
    ;;
esac

echo "==================================================="
echo " Target: $ENV ($PROJECT)"
echo "==================================================="

if [ "$COMMAND" == "deploy" ]; then
    if [ "$ENV" == "--local" ]; then
      echo "Cannot deploy to local. Run 'npm run serve' inside functions/ to start emulators."
      exit 1
    fi

    echo "1. Exporting icon index (embedding_minilm) from Firestore $ENV_NAME..."
    cd "$SCRIPT_DIR"
    npx tsx export-icon-index.ts --$ENV_NAME

    echo "2. Deploying vectorSearch-searchIconVector to $PROJECT..."
    echo "   (predeploy will download model + rebuild)"
    cd "$RECIPE_LANES_DIR"
    firebase deploy --project "$PROJECT" --only functions:vectorSearch-searchIconVector

elif [ "$COMMAND" == "test" ]; then
    cd "$SCRIPT_DIR"
    QUERY_ARG="${QUERY:-Spicy Chicken Curry}"
    echo "Query: '$QUERY_ARG'"
    npx tsx test-search.ts "$QUERY_ARG" $ENV

elif [ "$COMMAND" == "status" ]; then
    if [ "$ENV" == "--local" ]; then
        echo "Local: check your emulators terminal."
        exit 0
    fi

    echo "--- Cloud Run services ---"
    gcloud run services list --project "$PROJECT" --region us-central1 \
      --filter="SERVICE:vectorsearch OR SERVICE:processicontask" \
      --format="table(SERVICE,LAST_DEPLOYED_AT,URL)" 2>/dev/null || \
      echo "(gcloud run services list failed)"

    echo ""
    echo "--- Recent logs (vectorsearch-searchiconvector, last 20) ---"
    gcloud logging read \
      "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"vectorsearch-searchiconvector\"" \
      --project "$PROJECT" \
      --limit=20 \
      --format="table(timestamp,textPayload)" 2>/dev/null || \
      echo "(log fetch failed)"

else
    echo "Error: Unknown command '$COMMAND'. Use: deploy, test, status."
    exit 1
fi

echo "==================================================="
echo " Done."
