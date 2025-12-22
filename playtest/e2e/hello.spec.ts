import { test, expect } from '@playwright/test';

test('shows hello after click', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#hello-text')).toBeHidden();
  await page.getByRole('button', { name: 'Click Me' }).click();
  await expect(page.locator('#hello-text')).toBeVisible();
  await expect(page.locator('#hello-text')).toHaveText('Hello');
});