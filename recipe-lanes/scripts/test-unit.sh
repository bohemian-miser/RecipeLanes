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
npx env-cmd -f .env.test node --import tsx --test tests/graph.test.ts tests/data.test.ts tests/image-processing.test.ts tests/verify-production-logic.test.ts tests/title-persistence.test.ts tests/icon-search.test.ts tests/parser.test.ts tests/icon-shortlist.test.ts tests/icon-pipeline.test.ts tests/recipe-store.test.ts

# 2. Run Integration Tests (Require Emulators)
echo "----------------------------------------------------------------"
echo "Running Emulator-dependent Unit Tests"
echo "----------------------------------------------------------------"

# Check if Emulators are already running (Firestore on 8080)
if curl -s --connect-timeout 1 http://127.0.0.1:8080 > /dev/null 2>&1; then
    echo "🟢 Emulators detected on port 8080. Running against EXISTING emulators."
    npx env-cmd -f .env.test node --import tsx --test tests/admin-security.test.ts tests/lifecycle.test.ts tests/functions-metadata.test.ts tests/icon-index.test.ts
else
    echo "🟡 No emulators detected. Starting NEW emulators for tests."
    # Build Functions (Required for 'functions' emulator)
    npm install --prefix functions --quiet
    npm run build --prefix functions

    npx env-cmd -f .env.test firebase emulators:exec --only auth,firestore,storage,functions,tasks --project local-project-id "node --import tsx --test tests/admin-security.test.ts tests/lifecycle.test.ts tests/functions-metadata.test.ts tests/icon-index.test.ts"
fi
