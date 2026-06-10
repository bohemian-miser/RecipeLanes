---
name: verify-app
description: Verify RecipeLanes changes locally using Firebase emulators and the tiered test suite.
---

# verify-app

Verify that a change works correctly in the local emulator environment.

## 1. Start emulators

Check if emulators are already running before starting new ones:

```bash
# Check if Firestore emulator is up
curl -s --connect-timeout 1 http://127.0.0.1:8080 > /dev/null && echo "already running"

# If not running, start them (from recipe-lanes/)
npm run emulators        # scripts/start-emulators.sh
# Wait for "All emulators ready" in output before proceeding
```

## 2. Start dev server

```bash
# From recipe-lanes/ — uses .env.test (sets MOCK_AI=true and emulator endpoints)
npm run dev:emulators    # env-cmd -f .env.test next dev -p 8001
```

App: http://localhost:8001 — Emulator UI: http://localhost:4000

## 3. Choose the right test tier

| Change type | Command |
|---|---|
| Pure logic / type changes | `npm run test:one -- tests/my.test.ts` |
| Data layer / Cloud Functions | `npm run test:unit` (uses running emulators) |
| UI / component changes | `npm run test:e2e` (requires emulators + dev server) |
| Pre-commit / full validation | `npm run verify` (build + all tests; slow on Pi — reserve for final check) |

Run scoped tests first on Raspberry Pi — avoid repeated full builds.

## 4. Pre-commit warm-up (Pi-specific)

The pre-commit hook runs `npm run verify`. Pre-warm to avoid timeouts:

```bash
# Ensure emulators are fresh (kill stale if needed)
fuser -k 9099/tcp 8080/tcp 9199/tcp 5001/tcp 9300/tcp 2>/dev/null || true
npm run emulators &

# Pre-warm dev server with correct env vars
rm -rf .next-test
set -a && source .env.test && set +a
GOOGLE_APPLICATION_CREDENTIALS=$(pwd)/mock-service-account.json DIST_DIR=.next-test npx next dev -p 8002 &

# Wait until server responds
until curl -s http://localhost:8002 > /dev/null; do sleep 2; done
echo "Server ready"
```

`playwright.config.ts` has `reuseExistingServer: true`, so Playwright reuses this warm server.

## 5. Cleanup

```bash
# Kill background emulators and dev server
fuser -k 9099/tcp 8080/tcp 9199/tcp 5001/tcp 9300/tcp 8001/tcp 8002/tcp 2>/dev/null || true
```

## Notes

- `MOCK_AI=true` is set by `.env.test` and `start-emulators.sh` — local/test only, never production.
- Known flaky tests on Pi (retry once if 1-2 fail): `Icon Backlog & Automated Recipe Flow`, `Core Graph: Pan, Delete, Undo & Sidebar`, `Gallery: Search & Vetting (Admin)`.
- See `recipe-lanes/TESTING.md` for full debugging tips (traces, screenshots, console logs).
