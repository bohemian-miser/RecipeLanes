/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Single source of truth for the unit-test tiers.
 *
 * The two tiers used to be enumerated by hand — the pure tier as a giant
 * space-separated file list inline in `package.json` ("test:unit:pure"), the
 * integration tier as a list in `scripts/test-unit-integration.sh`. Every PR
 * that added a test edited the same inline `test:unit:pure` line, so test
 * additions collided on that one line and produced constant merge conflicts.
 *
 * Instead, pure tests are now AUTO-DISCOVERED: any `tests/*.test.ts` file is a
 * pure unit test unless it is listed in INTEGRATION_TESTS below. Adding a pure
 * test therefore touches no shared list. Only the (rarely-changing) set of
 * emulator-dependent integration tests is enumerated — those import
 * firebase-admin and need the Firestore/Auth/Storage/Functions emulators, so
 * they cannot run in the fast, emulator-free pure tier.
 */

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Emulator-dependent tests. Keep this list sorted for stable, conflict-friendly
// diffs. A test belongs here (and NOT in the pure tier) iff it needs the
// Firebase emulators. Everything else is discovered automatically.
export const INTEGRATION_TESTS = [
  'admin-security.test.ts',
  'data-helpers-transaction.test.ts',
  'forge-gate-regression.test.ts',
  'functions-metadata.test.ts',
  'hybrid-integration.test.ts',
  'icon-index.test.ts',
  'icon-queue-config.test.ts',
  'impression-rejection.test.ts',
];

// tests/ lives one level up from scripts/. Resolve relative to THIS file so the
// discovery works regardless of the process's current working directory.
const TESTS_DIR = path.resolve(fileURLToPath(new URL('../tests', import.meta.url)));

/** All `*.test.ts` files directly under tests/ (non-recursive), sorted. */
function allTestFiles() {
  return readdirSync(TESTS_DIR)
    .filter((name) => name.endsWith('.test.ts'))
    .sort();
}

/** Repo-relative paths (e.g. `tests/foo.test.ts`) of the integration tier. */
export function integrationTestPaths() {
  return INTEGRATION_TESTS.slice().sort().map((name) => `tests/${name}`);
}

/** Repo-relative paths of the pure tier: every test file minus INTEGRATION_TESTS. */
export function pureTestPaths() {
  const integration = new Set(INTEGRATION_TESTS);
  return allTestFiles()
    .filter((name) => !integration.has(name))
    .map((name) => `tests/${name}`);
}
