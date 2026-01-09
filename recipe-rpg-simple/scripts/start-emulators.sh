#!/bin/bash
set -e

# Use Java 21 to avoid Security Manager issues in Java 25+
if [ -d "/usr/lib/jvm/java-21-openjdk-amd64" ]; then
    export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
    export PATH=$JAVA_HOME/bin:$PATH
fi

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT" || exit 1

# Set Credentials for Functions/Genkit
export GOOGLE_APPLICATION_CREDENTIALS="$PROJECT_ROOT/mock-service-account.json"
export MOCK_AI=true
export NEXT_PUBLIC_FIREBASE_PROJECT_ID="local-project-id"
export NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="local-project-id.firebasestorage.app"

echo "Using Java version:"
java -version 

# Build Functions
echo "Building Functions..."
# Clean previous build to force fresh load
rm -rf "$PROJECT_ROOT/functions/lib"
npm install --prefix "$PROJECT_ROOT/functions" --quiet
npm run build --prefix "$PROJECT_ROOT/functions"

echo "Starting Emulators for project: local-project-id"
firebase emulators:start --only auth,firestore,storage,functions --project local-project-id
