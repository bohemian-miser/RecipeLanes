#!/bin/bash
set -e

# 1. Java Setup (Fix for Java 25+ environments)
if [ -d "/usr/lib/jvm/java-21-openjdk-amd64" ]; then
    export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
    export PATH=$JAVA_HOME/bin:$PATH
fi

# 2. Google Credentials
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export GOOGLE_APPLICATION_CREDENTIALS="$PROJECT_ROOT/service-account.json"
export MOCK_AI=true

# 3. Build Functions (Ensure they are fresh for emulators)
echo "Building Functions..."
# Only run install if node_modules doesn't exist to save time, or always run it? 
# For correctness in CI/Dev, running it is safer, but slow. 
# We'll run it.
npm install --prefix "$PROJECT_ROOT/functions" --quiet
npm run build --prefix "$PROJECT_ROOT/functions"

# 4. Construct Test Command
# Default to running all tests if no args provided
TEST_ARGS="${@:-}" 
CMD="npx playwright test $TEST_ARGS"

# 5. Run Emulators & Tests
echo "----------------------------------------------------------------"
echo "Starting Firebase Emulators and running: $CMD"
echo "----------------------------------------------------------------"

# We use 'npx firebase' to ensure we use the local project version
npx firebase emulators:exec --only auth,firestore,storage,functions --project recipe-lanes "$CMD"
