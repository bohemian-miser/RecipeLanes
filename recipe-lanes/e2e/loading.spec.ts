import { test, expect } from './utils/fixtures';
import { deviceConfigs } from './utils/devices';

test.describe('Loading Screen Behavior', () => {
  const desktop = deviceConfigs.find(d => d.name === 'desktop')!;
  
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(desktop.viewport);
  });

  test('Shows loading phases deterministically using network interception', async ({ page }) => {
    await page.goto('/lanes?new=true');
    page.on('console', msg => console.log('BROWSER:', msg.text()));

    // Enter a simple recipe
    await page.getByPlaceholder('Paste recipe here...').waitFor({ timeout: 30000 });
    await page.getByPlaceholder('Paste recipe here...').fill('1 apple\nEat it');
    
    // 1. Setup interceptors to pause the network requests
    let continueGraph: () => void;
    const graphPromise = new Promise<void>(resolve => continueGraph = resolve);
    
    let serverActionCount = 0;
    await page.route('**/lanes*', async route => {
      const req = route.request();
      if (req.method() === 'POST') {
         const nextAction = await req.headerValue('next-action');
         if (nextAction) {
           serverActionCount++;
           if (serverActionCount === 2) {
             console.log('Paused next-action:', nextAction);
             await graphPromise;
           }
         }
      }
      await route.continue();
    });

    let continueIcons: () => void;
    const iconsPromise = new Promise<void>(resolve => continueIcons = resolve);
    
    await page.route('**/batchSearchIcons', async route => {
      await iconsPromise;
      await route.continue();
    });

    // 2. Click create (triggers the graph generation server action)
    await page.locator('button:has(svg.lucide-arrow-right)').click();

    // 3. Assert "Making Recipe Graph" phase is shown (network is paused)
    const loadingScreen = page.getByTestId('loading-screen');
    await expect(loadingScreen).toBeVisible();
    await expect(loadingScreen).toContainText('Making Recipe Graph');

    // 4. Resume the server action request
    continueGraph!();

    // Wait for URL to change to the new recipe ID
    await page.waitForURL(/id=/);

    // 5. Assert "Finding Icons" phase is shown (Firebase call is paused)
    await expect(loadingScreen).toBeVisible();
    await expect(loadingScreen).toContainText('Finding Icons');

    // 6. Resume the icon search request
    continueIcons!();

    // 7. Assert loading screen disappears completely
    await expect(loadingScreen).not.toBeVisible({ timeout: 15000 });

    // Verify we see the actual graph nodes
    await expect(page.locator('.react-flow__node').first()).toBeVisible();
  });
});
