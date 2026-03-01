# Testing Guide

This guide covers how to write, run, and debug tests for RecipeLanes, focusing on the E2E (End-to-End) testing infrastructure.

## 1. Overview

The testing stack consists of:
-   **Playwright:** For E2E tests (located in `recipe-lanes/e2e/`).
-   **Next.js:** The application framework.
-   **Firebase Emulator Suite:** For testing backend interactions (Firestore, Auth, Functions) locally.
-   **TSX (TypeScript Execute):** For running unit tests.

## 2. Running Tests

### Unit Tests
Unit tests cover isolated logic like graph parsing, undo/redo, and data transformations.

```bash
cd recipe-lanes
npm run test:unit
```

### E2E Tests
E2E tests run the full application stack against the Firebase Emulators.

```bash
cd recipe-lanes
npm run test:e2e
```
*   This script (`scripts/test-e2e.sh`) builds the app, starts the Firebase Emulators, and runs Playwright.
*   **Important:** Do NOT run `blaze test` (Google internal) for these; use `npm run test:e2e`.

#### Running Specific E2E Tests
You can target a specific test file using Playwright arguments:

```bash
# Run only tests in sharing-comprehensive.spec.ts
npx playwright test e2e/sharing-comprehensive.spec.ts

# Run tests in UI mode (interactive debugger)
npx playwright test --ui
```

### Keeping Screenshots (Debugging)
By default, test runs clean up the screenshot directory. To persist screenshots across multiple runs for comparison:

```bash
NO_CLEANUP=true npm run test:e2e
```
Screenshots are saved to `recipe-lanes/e2e/test_screenshots/<test-name>/<device>/<uuid>/`.

## 3. Writing E2E Tests

### File Structure
Tests are located in `recipe-lanes/e2e/`. Common utilities are in `recipe-lanes/e2e/utils/`.

### Basic Template

```typescript
import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';

test.describe('My Feature', () => {
  for (const device of deviceConfigs) {
    if (device.isMobile) continue; // Optional: filtering

    test(`${device.name}: My Test Case`, async ({ page, login }) => {
      const dir = screenshotDir('my-feature', device.name);
      await page.setViewportSize(device.viewport);

      // 1. Setup / Login
      await page.goto('/lanes?new=true');
      await login('mock-user-alice'); // Uses mocked auth state

      // 2. Actions
      await page.getByPlaceholder('Paste recipe here...').fill('My Recipe');
      await page.locator('button:has(svg.lucide-arrow-right)').click();

      // 3. Assertions
      await expect(page.getByText('My Recipe')).toBeVisible();
      
      // 4. Screenshot
      await screenshot(page, dir, '01-recipe-created');

      cleanupScreenshots(dir);
    });
  }
});
```

### Key Utilities

*   **`login(userId)`**: A custom fixture that sets a special cookie (`mock-session`) which the app's `AuthProvider` detects to simulate a logged-in user without hitting real Firebase Auth.
*   **`screenshot(page, dir, name)`**: Takes a full-page screenshot and saves it to a structured directory.
*   **`expect(locator).toBeVisible()`**: Standard Playwright assertions.

### Testing "Smart Features" (AI/LLM)
The test environment sets `MOCK_AI=true`.
*   **`lib/ai-service.ts`** intercepts LLM calls and returns deterministic mock data based on the prompt content.
*   **`lib/data-service.ts`** skips uploading images to Firebase Storage when in mock mode, saving generated URLs directly to Firestore instead.

## 4. Debugging Tips

1.  **Screenshots:** Check `e2e/test_screenshots` after a failure.
2.  **Traces:** Playwright saves traces for failed tests. View them with:
    ```bash
    npx playwright show-trace test-results/<failed-test-folder>/trace.zip
    ```
3.  **Console Logs:** The `debugLogAction` in `app/actions.ts` allows the client to log directly to the server terminal, which appears in the Playwright output.
4.  **Timeouts:** If testing async logic (like "Auto-fork"), insert `await page.waitForTimeout(2000)` to ensure background processes (like `useEffect` hooks) have time to run before you assert or perform the next action.

## 5. Infrastructure Details

*   **Authentication:**
    *   **Prod:** Uses Firebase Auth + Session Cookies.
    *   **Test:** Uses a `mock-session` cookie. The `AuthProvider` component checks for this cookie and synthesizes a user object if present.
*   **Database:** Tests run against the Firestore Emulator (`localhost:8080`). Data is ephemeral and resets between runs if the emulator is restarted (or typically preserved *during* a single `test:e2e` run but isolated by unique IDs in tests).
