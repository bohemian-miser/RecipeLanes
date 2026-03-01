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

export default defineConfig({
  testDir: './e2e',
  timeout: 30 * 1000,
  expect: {
    timeout: 5 * 1000,
  },
  retries: 0,
  workers: 1,
  fullyParallel: true,
  use: {
    baseURL: 'http://localhost:8002',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx next dev -p 8002',
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