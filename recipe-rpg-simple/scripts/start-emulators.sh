#!/bin/bash
# Use Java 21 to avoid Security Manager issues in Java 25+
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
# This line is the critical fix:
export PATH=$JAVA_HOME/bin:$PATH 

# Set Credentials for Functions/Genkit
export GOOGLE_APPLICATION_CREDENTIALS=$(pwd)/service-account.json

echo "Using Java version:"
java -version 

# Build Functions
echo "Building Functions..."
npm install --prefix functions
npm run build --prefix functions

firebase emulators:start --only auth,firestore,storage,functions