import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';

test.describe('Graph Icon Transition', () => {
  for (const device of deviceConfigs) {
    if (device.isMobile) continue;

    test(`${device.name}: Transition from Emojis to Icons`, async ({ page }) => {
      const dir = screenshotDir('graph-icon-transition', device.name);
      await page.setViewportSize(device.viewport);
      
      // Guest flow is fine for generation
      await page.goto('/lanes?new=true');
      
      // 1. Create Recipe
      await page.getByPlaceholder('Paste recipe here...').fill('test eggs');
      await page.locator('button:has(svg.lucide-arrow-right)').click();
      
      // 2. Wait for Graph to Appear
      const viewport = page.locator('.react-flow__viewport');
      await expect(viewport).toBeVisible({ timeout: 15000 });
      
      // 3. Verify Initial State (Emojis)
      // Nodes render <span>🥕</span> or <span>🍳</span> when iconUrl is missing.
      // We look for the class used in MinimalNode/CardNode for the placeholder
      const emojiNodes = page.locator('.react-flow__node span.text-4xl, .react-flow__node span:has-text("🥕"), .react-flow__node span:has-text("🍳")');
      
      // Wait for at least one emoji to ensure we caught the initial state
      // Note: If generation is TOO fast (Mock AI), we might miss this state!
      // But typically React renders initial state then updates.
      try {
          await expect(emojiNodes.first()).toBeVisible({ timeout: 2000 });
          await screenshot(page, dir, '01-emojis-visible');
          console.log('Verified Emojis present initially.');
      } catch (e) {
          console.warn('Emojis not caught in time (too fast?), checking icons directly.');
      }

      // 4. Wait for Icons to Populate
      // This happens via client-side loop `populateIcons`.
      const iconImages = page.locator('.react-flow__node img');
      
      // Wait for all icons to replace emojis
      // We expect the number of icons to eventually match the number of nodes (approx)
      // Or simply wait until emojis are gone.
      await expect(async () => {
          const emojiCount = await emojiNodes.count();
          const iconCount = await iconImages.count();
          console.log(`Polling Transition: Emojis=${emojiCount}, Icons=${iconCount}`);
          
          expect(iconCount).toBeGreaterThan(0);
          if (emojiCount > 0) throw new Error(`Still have ${emojiCount} emojis...`);
      }).toPass({ timeout: 60000 });

      await screenshot(page, dir, '02-icons-populated');
      console.log('Verified All Icons populated.');
      
      cleanupScreenshots(dir);
    });
  }
});
