#!/bin/bash
set -e

# Usage: ./vector-search.sh [deploy|test|status] [--local|--staging|--prod]

COMMAND=$1
ENV=$2

if [ -z "$COMMAND" ] || [ -z "$ENV" ]; then
  echo "Usage: ./vector-search.sh [deploy|test|status] [--local|--staging|--prod]"
  exit 1
fi

case $ENV in
  --local)
    PROJECT="local"
    ;;
  --staging)
    PROJECT="recipe-lanes-staging"
    ;;
  --prod)
    PROJECT="recipe-lanes-prod"
    ;;
  *)
    echo "Error: Environment must be --local, --staging, or --prod."
    exit 1
    ;;
esac

echo "==================================================="
echo "🚀 Target Environment: $ENV ($PROJECT)"
echo "==================================================="

if [ "$COMMAND" == "deploy" ]; then
    if [ "$ENV" == "--local" ]; then
      echo "You cannot deploy to local. Run 'npm run serve' inside functions/ to start emulators."
      exit 1
    fi
    
    echo "1. Pulling latest $ENV database to bake into Cloud Function..."
    ENV_NAME=$(echo $ENV | sed 's/--//')
    npx tsx pull-db.ts --$ENV_NAME

    echo "2. Building Node.js Firebase Functions..."
    cd ../functions
    npm run build

    echo "3. Deploying vectorSearch-searchIconVector to $PROJECT..."
    # We only deploy the specific function to keep deployments lightning fast
    firebase deploy --project $PROJECT --only functions:vectorSearch-searchIconVector

elif [ "$COMMAND" == "test" ]; then
    echo "1. Running integration test query..."
    npx tsx test-search.ts "Spicy Chicken Curry" $ENV
    
elif [ "$COMMAND" == "status" ]; then
    if [ "$ENV" == "--local" ]; then
        echo "Local emulators running status: check your terminal window."
        exit 0
    fi
    echo "Fetching Cloud Function status and recent logs..."
    gcloud functions describe vectorSearch-searchIconVector --project $PROJECT --region us-central1 --format="value(state, updateTime, environment)"
    echo "Recent Logs:"
    gcloud logging read "resource.type=cloud_function AND resource.labels.function_name=vectorSearch-searchIconVector" --project $PROJECT --limit=5 --format="table(timestamp, textPayload)"

else
    echo "Error: Unknown command. Use deploy, test, or status."
    exit 1
fi

echo "==================================================="
echo "✅ Complete."