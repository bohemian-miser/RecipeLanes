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

// e2e/utils/fixtures.ts
import { test as base, expect } from '@playwright/test';
import { getTestUserToken, clearFirestore, clearStorage } from './admin-utils';
import { CONSENT_STORAGE_KEY, TERMS_VERSION } from '../../lib/consent';

type AuthFixtures = {
  login: (uid?: string, options?: AuthOptions) => Promise<void>;
};

type AuthOptions = {
    claims?: object;
    displayName?: string;
};

export const test = base.extend<AuthFixtures>({
  // Auto-seed acceptance of the legal terms (Issue 147) before any navigation,
  // so the one-time consent banner is pre-dismissed and never overlaps the
  // bottom-of-viewport controls the specs interact with. addInitScript runs on
  // every document before the app's first paint.
  page: async ({ page }, use) => {
    await page.addInitScript(([key, version]) => {
      try {
        window.localStorage.setItem(key, version);
      } catch {
        // Ignore storage failures in restricted contexts.
      }
    }, [CONSENT_STORAGE_KEY, TERMS_VERSION] as const);
    await use(page);
  },

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
              // Backoff before retrying a failed sign-in (execution context destroyed
              // during hydration). Not a happy-path settle — a real retry delay.
              await new Promise((resolve) => setTimeout(resolve, 1000));
          }
      }
    };

    // Pass the function to the test
    await use(loginFn);
  },
});

// 4. Re-export expect so you don't need to import from @playwright/test in spec files
export { expect } from '@playwright/test';