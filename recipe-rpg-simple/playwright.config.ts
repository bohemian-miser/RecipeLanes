import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60 * 1000,
  retries: 2,
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
  /*
  webServer: {
    command: 'npx next dev -p 8002',
    url: 'http://localhost:8002',
    reuseExistingServer: true,
    timeout: 60 * 1000,
    env: {
      MOCK_AI: 'true',
      NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
    },
  },
  */
});
