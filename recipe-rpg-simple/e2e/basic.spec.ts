import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('/lanes');
  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/Recipe Lanes|Icon Maker/);
});

test('loads gallery', async ({ page }) => {
  await page.goto('/gallery');
  await expect(page.getByRole('heading', { name: 'Community Gallery' })).toBeVisible();
});

test('can create recipe', async ({ page }) => {
  await page.goto('/lanes');
  // Wait for load
  await expect(page.getByPlaceholder('Paste recipe here...')).toBeVisible();
  
  // Fill input
  await page.getByPlaceholder('Paste recipe here...').fill('Boil water. Add pasta.');
  
  // Click Visualize (Arrow button)
  await page.locator('button').filter({ has: page.locator('svg') }).nth(0).click(); // This selector is brittle, need accessible name?
  // The button has <ArrowRight> inside.
  
  // Wait for graph
  // The input should collapse or show status.
  // We expect "Forging Icons" or similar status text or just wait for graph container to not be empty.
  // We can't easily assert graph content canvas.
});
