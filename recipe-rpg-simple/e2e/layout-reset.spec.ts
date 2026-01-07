import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir, cleanupScreenshots } from './utils/screenshot';
import { deviceConfigs } from './utils/devices';
import { move_node, get_node, create_recipe, wait_for_graph } from './utils/actions';

test.describe('Layout Reset Behavior', () => {
  const desktopDevices = deviceConfigs.filter(d => d.name === 'desktop');

  for (const device of desktopDevices) {
    test(`${device.name}: Switching layout resets view even if dirty`, async ({ page }) => {
      const dir = screenshotDir('layout-reset', device.name);
      cleanupScreenshots(dir);
      await page.setViewportSize(device.viewport);
      
      // Start fresh
      await page.goto('/lanes?new=true');

      // 1. Create Recipe
      await create_recipe(page, '1 Egg\n1 Sugar\nMix them', dir);
      await wait_for_graph(page, dir);

      const eggNode = get_node(page, '1 Egg');
      
      const layouts = ['Smart', 'Lanes', 'Smart LR'];

      for (const layoutName of layouts) {
          await test.step(`Testing ${layoutName} layout reset`, async () => {
              // 1. Activate Layout (or ensure active)
              // Note: First iteration 'Smart' is already active, but clicking it is safe (resets if dirty, does nothing if clean)
              // Actually, if we just created the recipe, it's clean.
              // If we are switching from previous iteration, clicking switches and auto-resets.
              
              if (layoutName !== 'Smart') { // Smart is default, so skip first click if it's the very first action? 
                  // Actually, clicking it explicitly is fine, just ensures we are in that mode.
                  await page.getByTitle(layoutName, { exact: true }).click();
                  await page.waitForTimeout(1000); // Wait for layout animation
              } else {
                  // For the first 'Smart' pass, we are already there.
                  // But if we loop back to Smart later, we need to click.
                  // Since we iterate sequentially, let's just click.
                  // BUT: If we are already in Smart (start), clicking it might be redundant but harmless.
                  // However, let's strictly follow "Switch -> Move -> Reset".
                  
                  // For the very first pass (fresh load), we don't need to switch.
                  // But let's verify we are in 'Smart' by checking button state?
                  // Or just click to be sure.
                  const isSmartActive = await page.getByTitle('Smart', { exact: true }).getAttribute('class').then(c => c?.includes('bg-zinc-100'));
                  if (!isSmartActive) {
                      await page.getByTitle(layoutName, { exact: true }).click();
                      await page.waitForTimeout(1000);
                  }
              }
              
              await screenshot(page, dir, `baseline-${layoutName.replace(' ', '-')}`);

              // 2. Get Baseline Position
              const boxOriginal = await eggNode.boundingBox();
              expect(boxOriginal).toBeTruthy();

              // 3. Move Node (Make Dirty)
              await move_node(page, '1 Egg', 200, 0, dir);
              const boxMoved = await eggNode.boundingBox();
              
              // Verify it actually moved
              expect(Math.abs(boxMoved!.x - boxOriginal!.x)).toBeGreaterThan(50); 
              
              await screenshot(page, dir, `moved-${layoutName.replace(' ', '-')}`);

              // 4. Click Same Button (Reset)
              await page.getByTitle(layoutName, { exact: true }).click();
              await page.waitForTimeout(1000); // Wait for animation
              
              // 5. Verify Reset
              const boxReset = await eggNode.boundingBox();
              // Should be back to original position (relaxed tolerance for new wider layout)
              expect(Math.abs(boxReset!.x - boxOriginal!.x)).toBeLessThan(100);
              
              await screenshot(page, dir, `reset-${layoutName.replace(' ', '-')}`);
          });
      }

      cleanupScreenshots(dir);
    });
  }
});