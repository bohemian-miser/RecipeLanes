#!/bin/bash

# gh-ci-analyzer/scripts/analyze_failure.sh
# Analyzes the latest CI failure using GitHub CLI (gh).

set -e

BRANCH=$(git rev-parse --abbrev-ref HEAD)
RUN_LIMIT=5
LOG_DIR="/tmp/gh-ci-analyzer"
mkdir -p "$LOG_DIR"

# 1. Summary of recent runs
echo "### Recent CI Runs (Branch: $BRANCH) ###"
gh run list --branch "$BRANCH" --limit "$RUN_LIMIT"

# 2. Get latest failure
FAILED_RUN=$(gh run list --branch "$BRANCH" --status failure --limit 1 --json databaseId,displayTitle,workflowName --template '{{range .}}{{.databaseId}} {{.workflowName}}: {{.displayTitle}}{{end}}')

if [ -z "$FAILED_RUN" ]; then
    echo "No failed runs found for branch $BRANCH."
    exit 0
fi

RUN_ID=$(echo "$FAILED_RUN" | awk '{print $1}')
RUN_TITLE=$(echo "$FAILED_RUN" | cut -d' ' -f2-)

echo -e "\n### Analyzing Latest Failure: $RUN_TITLE (ID: $RUN_ID) ###"

LOG_FILE="$LOG_DIR/run_$RUN_ID.log"
echo "Fetching logs to $LOG_FILE..."
gh run view "$RUN_ID" --log > "$LOG_FILE"

# 3. Extract errors
echo -e "\n--- Error Summary ---"

# Look for common failure patterns
# - Jest/Vitest: FAIL
# - Playwright: Error:
# - TSC: error TS
# - ESLint: error
# - Generic: FAILED, Error

grep -Ei "FAIL|Error:|error TS|\[eslint\]|FAILED|timed out" "$LOG_FILE" | grep -v "DEBUG" | tail -n 50

echo -e "\n----------------------"
echo "Full log available at: $LOG_FILE"
echo "To see the last 100 lines: tail -n 100 $LOG_FILE"
