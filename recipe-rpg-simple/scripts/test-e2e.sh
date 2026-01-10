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

# Load test environment variables
set -a
source "$PROJECT_ROOT/.env.test"
set +a

# Ensure Functions picks up the env var (robust workaround for emulator env inheritance)
# echo "MOCK_AI=true" > "$PROJECT_ROOT/functions/.env"



# 4. Construct Test Command
# Default to running all tests if no args provided
TEST_ARGS="${@:-}" 
CMD="npx playwright test $TEST_ARGS"

# 5. Smart Execution
# lsof -Pi :8080 -sTCP:LISTEN -t >/dev/null ;
if nc -z localhost 8080 2>/dev/null; then
    echo "🟢 Emulators detected on port 8080. Running tests against EXISTING emulators."
    echo "Running: $CMD"
    
    # We assume functions are already running/built in the existing emulator session
    # Run command
    npx env-cmd -f .env.test $CMD
    
else
    echo "🟡 No emulators detected. Starting NEW emulators."

    # Cleanup ports just in case
    echo "Cleaning up ports..."
    fuser -k 8002/tcp || true
    fuser -k 9099/tcp || true
    fuser -k 8080/tcp || true
    fuser -k 9199/tcp || true
    fuser -k 5001/tcp || true

        # 3. Build Functions (Ensure they are fresh for emulators)
    echo "Building Functions..."
    # Clean previous build to force fresh load
    rm -rf "$PROJECT_ROOT/functions/lib"

    npm install --prefix "$PROJECT_ROOT/functions" 
    npm run build --prefix "$PROJECT_ROOT/functions"

    # # Cleanup .env on exit This is not needed, it was overly cautious by gem.
    # cleanup() {
    #   echo "Removing test env file..."
    #   rm -f "$PROJECT_ROOT/functions/.env"
    # }
    # trap cleanup EXIT

    echo "----------------------------------------------------------------"
    echo "Starting Firebase Emulators and running: $CMD"
    echo "----------------------------------------------------------------"

    # We use 'npx firebase' to ensure we use the local project version
    npx env-cmd -f .env.test firebase emulators:exec --only auth,firestore,storage,functions --project local-project-id "$CMD"
fi
