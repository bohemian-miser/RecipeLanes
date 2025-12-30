#!/bin/bash
set -e

# 1. Java Setup (Fix for Java 25+ environments)
if [ -d "/usr/lib/jvm/java-21-openjdk-amd64" ]; then
    export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
    export PATH=$JAVA_HOME/bin:$PATH
fi

# 2. Google Credentials
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT" || exit 1

export GOOGLE_APPLICATION_CREDENTIALS="$PROJECT_ROOT/mock-service-account.json"
export MOCK_AI=true
export NEXT_PUBLIC_FIREBASE_PROJECT_ID="local-project-id"
export NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="local-project-id.firebasestorage.app"

# Ensure Functions picks up the env var (robust workaround for emulator env inheritance)
echo "MOCK_AI=true" > "$PROJECT_ROOT/functions/.env"

# 3. Build Functions (Ensure they are fresh for emulators)
echo "Building Functions..."
# Clean previous build to force fresh load
rm -rf "$PROJECT_ROOT/functions/lib"

# Only run install if node_modules doesn't exist to save time, or always run it? 
# For correctness in CI/Dev, running it is safer, but slow. 
# We'll run it.
npm install --prefix "$PROJECT_ROOT/functions" --quiet
npm run build --prefix "$PROJECT_ROOT/functions"

# 4. Construct Test Command
# Default to running all tests if no args provided
TEST_ARGS="${@:-}" 
CMD="npx playwright test $TEST_ARGS"

# 5. Cleanup & Run
echo "Cleaning up port 8002..."
fuser -k 8002/tcp || true

echo "----------------------------------------------------------------"
echo "Starting Firebase Emulators and running: $CMD"
echo "----------------------------------------------------------------"

# We use 'npx firebase' to ensure we use the local project version
npx firebase emulators:exec --only auth,firestore,storage,functions --project local-project-id "$CMD"
