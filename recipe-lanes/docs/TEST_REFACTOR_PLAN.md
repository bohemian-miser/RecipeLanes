# Test Suite Overhaul Plan

## Objective
Reduce test execution time and improve maintainability by shifting logic verification from heavy E2E tests to fast, parallel unit tests using Node.js's built-in `node:test` runner and the `MemoryDataService`.

## 1. Fast Unit Testing Framework
- **Runner**: Use `node --import tsx --test` (Node 20+ built-in).
- **Assertions**: Use `node:assert`.
- **Parallelism**: Leverage Node's native ability to run test files in parallel.

## 2. Refactor Existing Unit Tests
Refactor all files in `recipe-lanes/tests/` to use `node:test` instead of custom try/catch blocks:
- [x] `graph-utils.test.ts`
- [ ] `undo.test.ts`
- [ ] `undo-complex.test.ts`
- [ ] `undo-scrambled-logic.test.ts`
- [ ] `social-features.test.ts`
- [ ] `stats.test.ts`
- [ ] `optimistic-flow.test.ts`

## 3. E2E to Unit/Integration Migration
Identify E2E tests that primarily verify data logic (e.g., bridging nodes after deletion) and move them to integration tests using `MemoryDataService`:
- **Target**: `issue-74-repro.spec.ts` (Bridging logic).
- **Target**: `issue-69-repro.spec.ts`, etc.
- **Goal**: Run these in < 1s without a browser or emulator.

## 4. E2E Consolidation
Merge the remaining critical UI/Browser-specific tests to reduce emulator startup/teardown overhead:
- Create `e2e/regressions.spec.ts` for simple bug reproductions.
- Keep `e2e/comprehensive.spec.ts` for the main happy path.
- Keep `e2e/icon-queue-stress.spec.ts` for async queue verification.

## 5. Script Optimization
Update `recipe-lanes/package.json` and `scripts/test-unit.sh`:
- `test:unit` should run `node --import tsx --test tests/*.test.ts`.
- `verify` should be streamlined to run unit tests first, then essential E2E.

## Execution
I will proceed file-by-file, starting with the `undo` logic refactor.
