#!/bin/bash
set -e

# Use Java 21+ (required by firebase-tools)
if [ -d "/usr/lib/jvm/java-21-openjdk-amd64" ]; then
    export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
    export PATH=$JAVA_HOME/bin:$PATH
elif [ -d "/usr/lib/jvm/temurin-21-jdk-arm64" ]; then
    export JAVA_HOME=/usr/lib/jvm/temurin-21-jdk-arm64
    export PATH=$JAVA_HOME/bin:$PATH
fi

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT" || exit 1

# Set Credentials for Functions/Genkit
# PROJECT_ROOT/mock-service-account.json ?
export GOOGLE_APPLICATION_CREDENTIALS=$(pwd)/mock-service-account.json
export NEXT_PUBLIC_FIREBASE_PROJECT_ID="local-project-id"
export NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="local-project-id.firebasestorage.app"
export MOCK_AI=true

echo "Using Java version:"
java -version 

# Build Functions
echo "Building Functions..."
# Clean previous build to force fresh load
rm -rf functions/lib
npm install --prefix functions
npm run build --prefix functions

npx env-cmd -f .env.test firebase emulators:start --only auth,firestore,storage,functions,tasks  --project local-project-id
