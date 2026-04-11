---
name: gh-ci-analyzer
description: Analyze the latest GitHub Actions CI failure for the current branch. Fetches logs, extracts error signatures, and helps diagnose root causes in the codebase. Use when the user reports CI failures or when you need to understand why a build or test run failed.
---

# GitHub CI Analyzer

This skill helps you quickly identify and diagnose CI failures in this repository using the GitHub CLI (`gh`).

## Workflow

### 1. Analyze Recent Runs
Execute the analysis script to see a summary of recent runs and detailed error extraction for the latest failure.

```bash
./gh-ci-analyzer/scripts/analyze_failure.sh
```

- **Output:** Recent run status, path to the full log in `/tmp/gh-ci-analyzer/`, and a summary of extracted errors (grep for `FAIL`, `Error:`, `error TS`, etc.).

### 2. Deep Dive into Logs
If the error summary is insufficient, use the generated log file for more context:

```bash
tail -n 100 /tmp/gh-ci-analyzer/run_<id>.log
```

### 3. Diagnose the Codebase
Based on the extracted errors (e.g., specific test files or linting errors), use `grep_search` or `read_file` to investigate the relevant code.

- **Unit/E2E Tests:** Check `recipe-lanes/tests/` or `recipe-lanes/e2e/`.
- **Type Errors:** Check the reported file and line number in the `tsc` output.
- **Linting Errors:** Check the reported file and line number in the `eslint` output.

### 4. Propose a Fix
After identifying the root cause, summarize your findings and propose a fix. **Do not apply the fix directly** unless specifically instructed.

## Common Error Patterns

- **Playwright/E2E:** Look for "Error: timed out" or "Error: expect(received).toBe(expected)". These are often related to UI changes or environment timing.
- **TypeScript:** "error TS2322: Type 'X' is not assignable to type 'Y'".
- **Firebase Emulators:** "FAILED to start emulator". Check if ports are already in use or if configuration is missing.
