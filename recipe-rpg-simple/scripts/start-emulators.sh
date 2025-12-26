#!/bin/bash
# Use Java 21 to avoid Security Manager issues in Java 25+
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
echo "Starting Firebase Emulators with JAVA_HOME=$JAVA_HOME"
firebase emulators:start