You are absolutely right to be frustrated. Having an E2E-heavy test suite is a classic trap that slows down development, introduces flakiness, and makes CI/CD a nightmare. In the industry, we call this the "Ice Cream Cone" anti-pattern (the inverse of
  the Testing Pyramid), where you have tons of slow, brittle UI tests and very few fast, reliable unit tests.

  1. What depends on MemoryDataService?
  Based on the codebase search, almost nothing important depends on it anymore.
   * It is used in some old standalone manual scripts in the scripts/ folder (test-deletion-sync.ts, test-comprehensive.ts, test-extended-scenarios.ts).
   * It is imported but commented out or only mentioned in comments in your actual automated tests (tests/stats.test.ts, tests/optimistic-flow.test.ts, tests/social-features.test.ts).
   * It is used as a fallback in lib/data-service.ts if Firebase is somehow disabled.

  The Senior Engineer Verdict: Delete it. Maintaining a 500-line custom in-memory mock of Firestore is a massive technical debt liability. Since you already have a fantastic local Firebase Emulator setup (npm run dev:emulators), your integration tests
  should just talk to the real emulator. You don't need a fake database.

  2. How a Senior Engineer Sets Up Testing for This Stack

  To fix the slowness and frustration, we need to shift to a Standard Testing Pyramid:

  A. The Foundation: Unit Tests (Fast, 100s per second, Parallel)
   * What they test: Pure business logic, graph transformations, score calculations, string formatting.
   * How they run: Using a fast runner like Vitest (or Node's native test runner). No browsers, no database, no React rendering.
   * Example: Testing that applyIconToNode correctly updates a node's state given a mock node and a mock icon URL.
   * Current State: You have some of these in tests/ (e.g., graph-utils.test.ts), but we need to move more logic here.

  B. The Middle: Integration Tests (Medium speed, 10s per second)
   * What they test: Server actions, API routes, and Cloud Functions interacting with the database.
   * How they run: Node scripts that hit the Firebase Local Emulator. They execute backend code and verify that the Firestore documents were created/updated correctly. No UI is rendered.
   * Current State: You have a few of these (e.g., functions-metadata.test.ts), but much of this logic is currently buried inside your Playwright tests.

  C. The Tip: E2E Tests (Slow, 1 per 5 seconds, Sequential or Resource-Heavy)
   * What they test: The absolute critical "Happy Paths" that ensure the UI wires up correctly to the backend.
   * How they run: Playwright.
   * Current State: You have 36 Playwright tests. This is way too many for a project this size. You are using Playwright to test database logic (like stats-tracking.spec.ts or undo-persistence.spec.ts). Spinning up a whole Chromium browser just to click
     a button and check if a database counter incremented is why your suite is so slow.

  The Action Plan

  If you want to shift this architecture, here is the exact order of operations we should take:

  Phase 1: Burn the Dead Wood (Right Now)
   1. Delete MemoryDataService from lib/data-service.ts.
   2. Delete the obsolete manual scripts (scripts/test-deletion-sync.ts, etc.).
   3. Clean up lib/store.ts (which MemoryDataService relies on).

  Phase 2: Establish a Fast Test Runner
   1. Set up Vitest (it's drop-in compatible with Jest but much faster and native to TypeScript) for the tests/ directory.
   2. Ensure we can run unit tests in milliseconds without booting the Next.js server.

  Phase 3: Shift Left & Prune Playwright
   1. Take data-heavy Playwright tests (like stats tracking) and rewrite them as fast API/Integration tests hitting the Firebase Emulator directly via Vitest.
   2. Consolidate the remaining Playwright tests into 3-4 massive "User Journey" tests (e.g., guest-journey.spec.ts, authenticated-creator-journey.spec.ts) that just verify the UI doesn't crash.

