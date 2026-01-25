import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';
import * as admin from 'firebase-admin';
import './utils/admin-utils'; // Ensure admin is initialized

test.describe('Feedback Modal', () => {
  for (const device of deviceConfigs) {
    if (device.isMobile) continue;

    test(`${device.name}: Can open modal and submit feedback`, async ({ page }) => {
      const dir = screenshotDir('feedback-modal', device.name);
      cleanupScreenshots(dir);
      await page.setViewportSize(device.viewport);
      
      await page.goto('/lanes');
      
      // 1. Open Modal
      await page.getByTitle('Feedback & Contribute').click();
      await expect(page.getByText('Found a bug?')).toBeVisible();
      await screenshot(page, dir, 'modal-open');
      
      // 2. Fill Form
      await page.fill('#message', 'Test feedback message');
      await page.fill('#email', 'test@example.com');
      await screenshot(page, dir, 'form-filled');
      
      // 3. Submit
      await page.getByRole('button', { name: 'Send Feedback' }).click();
      
      // Wait for loading state
      await expect(page.getByText('Sending...')).toBeVisible();

      // 4. Verify Success or Error
      try {
        await expect(page.getByText('Thank You!')).toBeVisible({ timeout: 15000 });
      } catch (e) {
        // Debug failure
        const errorMsg = page.locator('.bg-red-900\\/10');
        if (await errorMsg.isVisible()) {
            const text = await errorMsg.textContent();
            throw new Error(`Feedback submission failed with UI error: ${text}`);
        }
        throw e;
      }
      await screenshot(page, dir, 'success-message');

      // 5. Verify Database (Admin SDK)
      const db = admin.firestore();
      const snapshot = await db.collection('feedback')
          .orderBy('created_at', 'desc')
          .limit(1)
          .get();
      
      if (snapshot.empty) throw new Error("No feedback found in DB");
      
      const data = snapshot.docs[0].data();
      if (data.message !== 'Test feedback message') throw new Error(`Message mismatch: ${data.message}`);
      if (data.email !== 'test@example.com') throw new Error(`Email mismatch: ${data.email}`);
      
      // 6. Verify Close
      await expect(page.getByText('Thank You!')).not.toBeVisible({ timeout: 5000 });
      await screenshot(page, dir, 'modal-closed');
    });
  }
});
