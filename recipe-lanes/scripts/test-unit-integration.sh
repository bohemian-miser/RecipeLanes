#!/bin/bash
set -e

# Use Java 21 to avoid Security Manager issues in Java 25+
if [ -d "/usr/lib/jvm/java-21-openjdk-amd64" ]; then
    export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
    export PATH=$JAVA_HOME/bin:$PATH
fi

INTEGRATION_TESTS="tests/admin-security.test.ts tests/data-helpers-transaction.test.ts tests/functions-metadata.test.ts tests/hybrid-integration.test.ts tests/icon-index.test.ts tests/icon-queue-config.test.ts tests/forge-gate-regression.test.ts tests/impression-rejection.test.ts tests/feedback-to-bug.test.ts"
# Note: these tests import firebase-admin and require Firestore/Auth emulators to be available.

echo "----------------------------------------------------------------"
echo "Running Emulator-dependent Integration Tests"
echo "----------------------------------------------------------------"

# Check if Emulators are already running (Firestore on 8080)
if curl -s --connect-timeout 1 http://127.0.0.1:8080 > /dev/null 2>&1; then
    echo "Emulators detected on port 8080. Running against EXISTING emulators."
    npx env-cmd -f .env.test node --import tsx --test --test-concurrency=1 $INTEGRATION_TESTS
else
    echo "No emulators detected. Starting NEW emulators for tests."
    # Build Functions (Required for 'functions' emulator)
    npm install --prefix functions --quiet
    # The functions vector-search loads Xenova/all-MiniLM-L6-v2 from a bundled,
    # gitignored model-cache with allowRemoteModels=false. Provision it before the
    # build's copy step — otherwise the copy silently no-ops (|| true) and the
    # emulator fails at runtime with `local_files_only=true ... not found locally`.
    # Skipped when already present (local dev) so it only pays the download in CI.
    if [ ! -d functions/src/vector-search/model-cache ]; then
        echo "Downloading functions embedding model (Xenova/all-MiniLM-L6-v2)..."
        npm run download-model --prefix functions
    fi
    npm run build --prefix functions

    npx env-cmd -f .env.test firebase emulators:exec --only auth,firestore,storage,functions,tasks --project local-project-id "node --import tsx --test --test-concurrency=1 $INTEGRATION_TESTS"
fi
