#!/bin/bash
set -e

# Use Java 21 to avoid Security Manager issues in Java 25+
if [ -d "/usr/lib/jvm/java-21-openjdk-amd64" ]; then
    export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
    export PATH=$JAVA_HOME/bin:$PATH
fi

INTEGRATION_TESTS="tests/admin-security.test.ts tests/data-helpers.test.ts tests/functions-metadata.test.ts tests/hybrid-integration.test.ts tests/icon-index.test.ts tests/impression-rejection.test.ts tests/lifecycle.test.ts"
# Note: these tests import firebase-admin and require Firestore/Auth emulators to be available.

echo "----------------------------------------------------------------"
echo "Running Emulator-dependent Integration Tests"
echo "----------------------------------------------------------------"

# Check if Emulators are already running (Firestore on 8080)
if curl -s --connect-timeout 1 http://127.0.0.1:8080 > /dev/null 2>&1; then
    echo "Emulators detected on port 8080. Running against EXISTING emulators."
    npx env-cmd -f .env.test node --import tsx --test $INTEGRATION_TESTS
else
    echo "No emulators detected. Starting NEW emulators for tests."
    # Build Functions (Required for 'functions' emulator)
    npm install --prefix functions --quiet
    npm run build --prefix functions

    npx env-cmd -f .env.test firebase emulators:exec --only auth,firestore,storage,functions,tasks --project local-project-id "node --import tsx --test $INTEGRATION_TESTS"
fi
