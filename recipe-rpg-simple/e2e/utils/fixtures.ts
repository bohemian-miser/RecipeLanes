// // e2e/utils/fixtures.ts
// import { test as base } from '@playwright/test';
// import { getTestUserToken } from './admin-utils';

// // 1. Define options for better type safety
// type AuthOptions = {
//   claims?: object;
//   displayName?: string;
// };

// // 2. Define the interface for our fixture
// type AuthFixtures = {
//   login: (uid?: string, options?: AuthOptions) => Promise<void>;
// };

// // 3. Extend the base test
// export const test = base.extend<AuthFixtures>({
//   login: async ({ page }, use) => {
    
//     // The Helper Function
//     const loginFn = async (uid: string = 'test-user-default', options: AuthOptions = {}) => {
//       // Always try cookie-based mock login first (supported in dev/test)
//       await page.context().addCookies([{
//           name: 'session',
//           value: `mock-${uid}`,
//           domain: 'localhost',
//           path: '/'
//       }]);
//       await page.reload();
//     };

//     // Pass the function to the test
//     await use(loginFn);
//   },
// });

// // 4. Re-export expect so you don't need to import from @playwright/test in spec files
// export { expect } from '@playwright/test';


import { test as base } from '@playwright/test';
import { getTestUserToken } from './admin-utils';

type AuthFixtures = {
  login: (uid: string) => Promise<void>;
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
      await page.evaluate(async (tokenString) => {
        
        // Helper to check if our exposed variables are ready
        const isReady = () => (window as any)._firebaseAuth && (window as any)._signInWithCustomToken;

        // Wait loop: Playwright is sometimes faster than your app's hydration
        if (!isReady()) {
          await new Promise<void>((resolve) => {
             const interval = setInterval(() => {
                if (isReady()) {
                   clearInterval(interval);
                   resolve();
                }
             }, 50);
          });
        }

        // Grab the exposed instances
        const auth = (window as any)._firebaseAuth;
        const signInWithCustomToken = (window as any)._signInWithCustomToken;

        // Perform the login
        await signInWithCustomToken(auth, tokenString);
      }, token);
    };
    await use(loginFn);
  },
});

export { expect } from '@playwright/test';