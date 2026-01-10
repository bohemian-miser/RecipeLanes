#!/bin/bash
set -e

# Define test command
TEST_CMD="npx tsx tests/lifecycle.test.ts && npx tsx tests/graph-utils.test.ts && npx tsx tests/undo.test.ts && npx tsx tests/undo-complex.test.ts && npx tsx tests/undo-scrambled-logic.test.ts && npx tsx tests/social-features.test.ts && npx tsx tests/gallery-view.test.ts && npx tsx tests/optimistic-flow.test.ts"

# 1. Check if Emulators are running (Firestore on 8080)
# Use nc (netcat) to check port
if nc -z localhost 8080 2>/dev/null; then
    echo "🟢 Emulators detected on port 8080. Running tests against EXISTING emulators."
    
    # Run directly using .env.test configuration
    # Note: We rely on the existing emulator being configured correctly (local-project-id)
    npx env-cmd -f .env.test sh -c "$TEST_CMD"

else
    echo "🟡 No emulators detected. Starting NEW emulators for tests."
    
    # 2. Configure Java 21 (Fix for Security Manager error in Java 25)
    if [ -d "/usr/lib/jvm/java-21-openjdk-amd64" ]; then
        export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
        export PATH=$JAVA_HOME/bin:$PATH
    fi

    # 3. Build Functions (Required for 'functions' emulator)
    echo "Building Functions..."
    npm install --prefix functions --quiet
    npm run build --prefix functions

    # 4. Start Emulators and Run Tests
    # We include 'functions' because async logic (queue) depends on it
    npx env-cmd -f .env.test firebase emulators:exec --only auth,firestore,storage,functions --project local-project-id "$TEST_CMD"
fi
