import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';

test.describe('Sharing & Forking Comprehensive', () => {
  for (const device of deviceConfigs) {
    if (device.isMobile) continue;

    test(`${device.name}: Auto-fork on edit`, async ({ page, login }) => {
      const dir = screenshotDir('sharing-auto-fork', device.name);
      await page.setViewportSize(device.viewport);

      // 1. Alice creates a recipe
      await page.goto('/lanes?new=true');
      await login('mock-alice-comprehensive');
      await page.getByPlaceholder('Paste recipe here...').fill('Alice Original Recipe');
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      await expect(page).toHaveURL(/id=/);
      const aliceUrl = page.url();
      const aliceId = new URL(aliceUrl).searchParams.get('id');
      console.log('Alice ID:', aliceId);
      await screenshot(page, dir, '01-alice-created');

      // 2. Bob logs in and visits
      await login('mock-bob-comprehensive');
      await page.goto(aliceUrl);
      await expect(page.getByPlaceholder('Paste recipe here...')).toHaveValue('Alice Original Recipe');
      await screenshot(page, dir, '02-bob-visits');

      // 3. Bob edits -> Should Auto-Fork
      // Trigger edit by typing
      await page.getByPlaceholder('Paste recipe here...').pressSequentially(' - Modified');
      
      // Expect immediate redirection (URL change)
      await expect(page).toHaveURL(new RegExp(`id=(?!${aliceId})`));
      const bobId = new URL(page.url()).searchParams.get('id');
      console.log('Bob Fork ID:', bobId);
      
      // Verify toast or visual indicator if possible, but URL change is the hard proof
      // await expect(page.locator('text=Saving a local copy...')).toBeVisible();
      
      await screenshot(page, dir, '03-bob-auto-forked');
      
      cleanupScreenshots(dir);
    });

    test(`${device.name}: Existing copy detection and handling`, async ({ page, login }) => {
      const dir = screenshotDir('sharing-existing-copy', device.name);
      await page.setViewportSize(device.viewport);

      // 1. Setup: Alice creates, Bob forks once.
      // We can manually seed this state or just run through the flow. Running flow is safer E2E.
      
      // Alice Create
      await page.goto('/lanes?new=true');
      await login('mock-alice-comprehensive-2');
      await page.getByPlaceholder('Paste recipe here...').fill('Alice Recipe 2');
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      await expect(page).toHaveURL(/id=/);
      const aliceUrl = page.url();
      const aliceId = new URL(aliceUrl).searchParams.get('id');

      // Bob Fork (Method: Edit text)
      await login('mock-bob-comprehensive-2');
      await page.goto(aliceUrl);
      await page.getByPlaceholder('Paste recipe here...').pressSequentially(' '); // Trigger fork
      await expect(page).toHaveURL(new RegExp(`id=(?!${aliceId})`));
      const bobFirstCopyId = new URL(page.url()).searchParams.get('id');
      console.log('Bob Copy 1:', bobFirstCopyId);

      // 2. Bob visits Alice's recipe AGAIN
      await page.goto(aliceUrl);
      await screenshot(page, dir, '01-bob-revisits');

      // 3. Expect Banner: "You have an existing copy"
      const banner = page.locator('text=You have an existing copy');
      await expect(banner).toBeVisible();

      // 4. Test "Go to Copy" link
      // We won't click it yet, we want to test "Save another" first? 
      // Actually clicking the link navigates away. Let's test "Save another copy" first?
      // No, let's stick to the banner logic.
      
      // Verify buttons present
      await expect(page.getByRole('link', { name: 'existing copy' })).toBeVisible();
      const saveNewBtn = page.getByRole('button', { name: 'Save another copy?' });
      await expect(saveNewBtn).toBeVisible();

      // 5. Action: Save Another Copy
      await saveNewBtn.click();
      
      // Expect new URL (Copy 2)
      await expect(page).toHaveURL(new RegExp(`id=(?!${aliceId})`));
      await expect(page).toHaveURL(new RegExp(`id=(?!${bobFirstCopyId})`));
      const bobSecondCopyId = new URL(page.url()).searchParams.get('id');
      console.log('Bob Copy 2:', bobSecondCopyId);
      
      await expect(page.locator('text=New version created')).toBeVisible();
      await screenshot(page, dir, '02-bob-made-second-copy');

      cleanupScreenshots(dir);
    });

    test(`${device.name}: Anonymous user fork`, async ({ page, login }) => {
      const dir = screenshotDir('sharing-anon', device.name);
      await page.setViewportSize(device.viewport);

      // 1. Alice creates (needs auth to create permanent one, or use anon flow)
      // Let's use Alice to create a stable "Shared" recipe
      await page.goto('/lanes?new=true');
      await login('mock-alice-comprehensive-3');
      await page.getByPlaceholder('Paste recipe here...').fill('Shared Recipe');
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      await expect(page).toHaveURL(/id=/); // Critical wait
      const sharedUrl = page.url();
      const sharedId = new URL(sharedUrl).searchParams.get('id');

      // 2. Logout (become Anon)
      // Use UI button to ensure both Client SDK and Server Cookie are cleared
      await page.getByRole('button', { name: 'Logout' }).click();
      
      // Verify logout
      await expect(page.getByText('Login')).toBeVisible();

      // 3. Visit Recipe
      await page.goto(sharedUrl);
      // Wait for load
      await expect(page.getByPlaceholder('Paste recipe here...')).toHaveValue('Shared Recipe');
      await screenshot(page, dir, '01-anon-view');

      // 4. Edit -> Should NOT Auto Fork (Anon)
      await page.getByPlaceholder('Paste recipe here...').pressSequentially(' Edited');
      
      // Expect URL to remain the same (no fork)
      await expect(page).toHaveURL(sharedUrl);
      
      // Expect "Log in to save" notification
      await expect(page.getByText('Log in to save your changes')).toBeVisible();
      
      await screenshot(page, dir, '02-anon-no-fork');

      cleanupScreenshots(dir);
    });
  }
});
