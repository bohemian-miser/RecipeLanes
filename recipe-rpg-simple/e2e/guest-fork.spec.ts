import { test, expect } from '@playwright/test';

test('Guest Forking Workflow', async ({ page, context }) => {
  // 1. Login as Alice and create recipe
  await context.addCookies([{ name: 'session', value: 'mock-alice', url: 'http://localhost:8002/' }]);
  await page.goto('/lanes?new=true');
  await page.getByPlaceholder('Paste recipe here...').fill('Alice Recipe');
  await page.locator('button.bg-yellow-500').click();
  await expect(page).toHaveURL(/id=/);
  const aliceUrl = page.url();
  
  // 2. Logout (clear cookies)
  await context.clearCookies();
  
  // 3. Visit as Guest
  await page.goto(aliceUrl);
  await expect(page.getByPlaceholder('Paste recipe here...')).toHaveValue('Alice Recipe');
  
  // 4. Modify
  await page.getByPlaceholder('Paste recipe here...').fill('Alice Recipe Modified');
  await page.locator('button.bg-yellow-500').click();
  
  // 5. Verify Success (New ID)
  // Currently suspected to fail
  await expect(page).toHaveURL(new RegExp(`id=(?!${new URL(aliceUrl).searchParams.get('id')})`), { timeout: 10000 });
});
