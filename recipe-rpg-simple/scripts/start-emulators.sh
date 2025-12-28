#!/bin/bash
# Use Java 21 to avoid Security Manager issues in Java 25+
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
# This line is the critical fix:
export PATH=$JAVA_HOME/bin:$PATH 

echo "Using Java version:"
java -version 

firebase emulators:start