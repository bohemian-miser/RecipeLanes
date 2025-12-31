import { defineConfig, devices } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: './e2e',
  timeout: 60 * 1000,
  expect: {
    timeout: 10 * 1000,
  },
  retries: 1,
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
    env: {
      MOCK_AI: 'true',
      DIST_DIR: '.next-test',
      NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true',
      NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-key',
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'local-project-id',
      GOOGLE_APPLICATION_CREDENTIALS: path.join(process.cwd(), 'mock-service-account.json'),
    },
  },
});