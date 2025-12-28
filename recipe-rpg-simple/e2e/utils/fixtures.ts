// e2e/utils/fixtures.ts
import { test as base } from '@playwright/test';
import { getTestUserToken } from './admin-utils';

// 1. Define options for better type safety
type AuthOptions = {
  claims?: object;
  displayName?: string;
};

// 2. Define the interface for our fixture
type AuthFixtures = {
  login: (uid?: string, options?: AuthOptions) => Promise<void>;
};

// 3. Extend the base test
export const test = base.extend<AuthFixtures>({
  login: async ({ page }, use) => {
    
    // The Helper Function
    const loginFn = async (uid: string = 'test-user-default', options: AuthOptions = {}) => {
      // Always try cookie-based mock login first (supported in dev/test)
      await page.context().addCookies([{
          name: 'session',
          value: `mock-${uid}`,
          domain: 'localhost',
          path: '/'
      }]);
      await page.reload();
    };

    // Pass the function to the test
    await use(loginFn);
  },
});

// 4. Re-export expect so you don't need to import from @playwright/test in spec files
export { expect } from '@playwright/test';