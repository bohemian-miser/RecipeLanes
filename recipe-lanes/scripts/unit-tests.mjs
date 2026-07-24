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
 * Unit-test entry point driven by scripts/unit-test-manifest.mjs.
 *
 *   node scripts/unit-tests.mjs pure              run the auto-discovered pure tier
 *   node scripts/unit-tests.mjs list-pure         print the pure tier file list
 *   node scripts/unit-tests.mjs list-integration  print the integration tier file list
 *
 * `pure` shells out to node's built-in test runner (with tsx for TS support),
 * inheriting the environment (so `env-cmd -f .env.test` still applies). The
 * `list-*` modes let the emulator-backed integration runner reuse the same
 * source of truth without duplicating the file list.
 */

import { spawnSync } from 'node:child_process';
import { pureTestPaths, integrationTestPaths } from './unit-test-manifest.mjs';

const mode = process.argv[2];

if (mode === 'list-pure') {
  process.stdout.write(pureTestPaths().join(' '));
  process.exit(0);
}

if (mode === 'list-integration') {
  process.stdout.write(integrationTestPaths().join(' '));
  process.exit(0);
}

if (mode === 'pure') {
  const files = pureTestPaths();
  if (files.length === 0) {
    console.error('unit-tests: no pure test files discovered under tests/.');
    process.exit(1);
  }
  const result = spawnSync('node', ['--import', 'tsx', '--test', ...files], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

console.error('Usage: node scripts/unit-tests.mjs <pure|list-pure|list-integration>');
process.exit(1);
