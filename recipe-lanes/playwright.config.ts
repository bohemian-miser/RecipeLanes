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

import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

// Device matrix for the e2e suite (Issue #20 — re-enable mobile tests).
// Every spec runs under the `desktop` project; the device-aware smoke suite
// additionally runs under a real mobile-device project (Pixel 5 — Chromium,
// isMobile + touch), so mobile-specific navigation/layout is exercised with
// genuine device emulation rather than a resized desktop viewport. Projects
// are generated from this list with a standard for-loop, so adding a device is
// a one-line change. `specs` scopes which specs a device runs (the mobile
// device only runs the smoke suite to keep the serial CI run bounded).
const E2E_DEVICES = [
  { name: 'desktop', device: devices['Desktop Chrome'], specs: undefined as RegExp | undefined },
  { name: 'mobile', device: devices['Pixel 5'], specs: /smoke\.spec\.ts/ as RegExp | undefined },
];

const e2eProjects = [];
for (const { name, device, specs } of E2E_DEVICES) {
  e2eProjects.push({
    name,
    use: { ...device },
    ...(specs ? { testMatch: specs } : {}),
  });
}

export default defineConfig({
  testDir: './e2e',
  timeout: 30 * 1000,
  expect: {
    timeout: 5 * 1000,
  },
  retries: 0,
  // Tests share one dev server + one Firestore emulator and seed overlapping
  // auth/recipe state, so they must run serially. workers:1 + fullyParallel:false
  // is the coherent setting (the previous workers:1 / fullyParallel:true was
  // contradictory). De-flaking is done via event-based waits, not parallelism.
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:8002',
    trace: 'retain-on-failure',
  },
  projects: e2eProjects,
  webServer: {
    command: 'rm -rf .next-test && npx next dev -p 8002',
    url: 'http://localhost:8002',
    reuseExistingServer: true,
    timeout: 120 * 1000,
    stdout: 'pipe',
    // env: inherited from process.env (loaded by dotenv)
    env: {
        GOOGLE_APPLICATION_CREDENTIALS: path.join(process.cwd(), 'mock-service-account.json'),
        DIST_DIR: '.next-test',
    }
  },
});