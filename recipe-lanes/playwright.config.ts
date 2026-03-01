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