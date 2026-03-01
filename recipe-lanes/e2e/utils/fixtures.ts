// e2e/utils/fixtures.ts
import { test as base, expect } from '@playwright/test';
import { getTestUserToken, clearFirestore, clearStorage } from './admin-utils';

type AuthFixtures = {
  login: (uid?: string, options?: AuthOptions) => Promise<void>;
};

type AuthOptions = {
    claims?: object;
    displayName?: string;
};

export const test = base.extend<AuthFixtures>({
  login: async ({ page }, use) => {
    // The Helper Function
    const loginFn = async (uid: string = 'test-user-default', options: AuthOptions = {}) => {
      const { claims, displayName } = options;
      
      // A. Mint the token (Node.js context)
      // We pass the displayName so admin-utils can update the user record
      const { token } = await getTestUserToken(uid, claims, displayName);

      // B. Inject into Browser (Client context)
      // Retry loop to handle "Execution context destroyed" if page reloads during hydration
      for (let attempt = 0; attempt < 3; attempt++) {
          try {
              // Wait for readiness
              await page.waitForFunction(() => (window as any)._firebaseAuth && (window as any)._signInWithCustomToken, null, { timeout: 10000 });

              // Execute Login
              await page.evaluate(async (tokenString) => {
                const auth = (window as any)._firebaseAuth;
                const signInWithCustomToken = (window as any)._signInWithCustomToken;
                await signInWithCustomToken(auth, tokenString);
              }, token);
              
              return; // Success
          } catch (e: any) {
              console.log(`Login attempt ${attempt + 1} failed: ${e.message}`);
              if (attempt === 2) throw e;
              await page.waitForTimeout(1000); // Wait for page to settle
          }
      }
    };

    // Pass the function to the test
    await use(loginFn);
  },
});

// 4. Re-export expect so you don't need to import from @playwright/test in spec files
export { expect } from '@playwright/test';