import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test('Login and Logout (Mock Mode)', async ({ page, context }) => {
    // 1. Start as Guest
    await page.goto('/lanes');
    
    // Check for Login button
    const loginBtn = page.getByRole('button', { name: 'Login' });
    await expect(loginBtn).toBeVisible();
    await expect(page.getByTitle('Logout')).not.toBeVisible();

    // 2. Click Login (should trigger mock login logic)
    await loginBtn.click();
    
    // Wait for reload/update
    // The mock login reloads the page, so we wait for the logout button to appear
    const logoutBtn = page.getByTitle('Logout');
    await expect(logoutBtn).toBeVisible({ timeout: 10000 });
    
    // Verify user name/id presence (mock user usually "User" or "mock-user-...")
    // The specific name depends on how we set it. In `signIn`, we set `mock-user-XXXX`.
    // In `checkMockCookie`, we display `displayName: uid`.
    // So we should see "user-XXXX" text.
    await expect(page.getByText(/user-\d+/)).toBeVisible();

    // 3. Click Logout
    await logoutBtn.click();

    // Wait for Login button to reappear
    await expect(loginBtn).toBeVisible({ timeout: 10000 });
    await expect(logoutBtn).not.toBeVisible();
  });
});
