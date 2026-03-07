#!/bin/bash
set -e

# Use Java 21 to avoid Security Manager issues in Java 25+
if [ -d "/usr/lib/jvm/java-21-openjdk-amd64" ]; then
    export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
    export PATH=$JAVA_HOME/bin:$PATH
fi

# 1. Run Pure Unit Tests (Parallel, No Emulators)
# These tests use node:test and avoid Firestore/Firebase calls by using MemoryDataService or Mocks.
echo "----------------------------------------------------------------"
echo "Running Fast Unit Tests (Parallel)"
echo "----------------------------------------------------------------"
npx env-cmd -f .env.test node --import tsx --test tests/graph-utils.test.ts tests/graph-logic.test.ts tests/undo.test.ts tests/undo-complex.test.ts tests/undo-scrambled-logic.test.ts tests/stats.test.ts tests/social-features.test.ts tests/gallery-view.test.ts tests/optimistic-flow.test.ts tests/verify-production-logic.test.ts

# 2. Run Integration Tests (Require Emulators)
echo "----------------------------------------------------------------"
echo "Running Emulator-dependent Unit Tests"
echo "----------------------------------------------------------------"

# Check if Emulators are already running (Firestore on 8080)
if nc -z localhost 8080 2>/dev/null; then
    echo "🟢 Emulators detected on port 8080. Running against EXISTING emulators."
    npx env-cmd -f .env.test node --import tsx --test tests/admin-security.test.ts 
    # Add lifecycle.test.ts here once refactored
else
    echo "🟡 No emulators detected. Starting NEW emulators for tests."
    # Build Functions (Required for 'functions' emulator)
    npm install --prefix functions --quiet
    npm run build --prefix functions

    npx env-cmd -f .env.test firebase emulators:exec --only auth,firestore,storage,functions --project local-project-id "node --import tsx --test tests/admin-security.test.ts"
fi
