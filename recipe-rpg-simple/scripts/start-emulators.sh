#!/bin/bash
# Use Java 21 to avoid Security Manager issues in Java 25+
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
# This line is the critical fix:
export PATH=$JAVA_HOME/bin:$PATH 

# Set Credentials for Functions/Genkit
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

firebase emulators:start --only auth,firestore,storage,functions --project local-project-id