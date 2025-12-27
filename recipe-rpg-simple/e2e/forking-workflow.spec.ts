import { test, expect } from '@playwright/test';

test('Alice Copy Workflow', async ({ page, context }) => {
  // 1. Login as Alice
  await context.addCookies([{
    name: 'session',
    value: 'mock-alice',
    url: 'http://localhost:8002/'
  }]);

  // 2. Create Recipe
  await page.goto('/lanes?new=true');
  console.log('Cookies (Alice):', await page.evaluate(() => document.cookie));

  await page.getByPlaceholder('Paste recipe here...').fill('Alice Soup\nBoil water.');
  // Wait for button and click
  await page.locator('button.bg-yellow-500').click();
  
  // Wait for ID
  await expect(page).toHaveURL(/id=/, { timeout: 15000 });
  const aliceUrl = page.url();
  const aliceId = new URL(aliceUrl).searchParams.get('id');
  console.log('Alice Recipe ID:', aliceId);

  // 3. Login as Bob
  await context.clearCookies();
  await context.addCookies([{
    name: 'session',
    value: 'mock-bob',
    url: 'http://localhost:8002/'
  }]);

  // 4. Bob visits Alice's recipe
  await page.goto(aliceUrl);
  console.log('Cookies (Bob):', await page.evaluate(() => document.cookie));
  // Wait for load
  await expect(page.getByPlaceholder('Paste recipe here...')).toHaveValue('Alice Soup\nBoil water.', { timeout: 15000 });

  // 5. Bob Modifies
  await page.getByPlaceholder('Paste recipe here...').fill('Alice Soup\nBoil water.\nAdd salt.');
  // Click arrow (visualize)
  await page.locator('button.bg-yellow-500').click();
  
  // 6. Verify Fork
  // URL should change to new ID (wait for it)
  await expect(page).toHaveURL(new RegExp(`id=(?!${aliceId})`), { timeout: 15000 });
  const bobId = new URL(page.url()).searchParams.get('id');
  console.log('Bob Copy ID:', bobId);
  expect(bobId).not.toBe(aliceId);
  
  // Title should change
  await expect(page.locator('h1').first()).toHaveText(/Copy of Mock Recipe/);

  // 7. Bob visits Alice's recipe again
  await page.goto(aliceUrl);
  
  // 8. Verify Banner
  const banner = page.locator('text=You have 1 existing copy');
  await expect(banner).toBeVisible();
  
  // Check buttons
  await expect(page.getByRole('link', { name: 'Open it' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Override it' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Make another copy' })).toBeVisible();
});
