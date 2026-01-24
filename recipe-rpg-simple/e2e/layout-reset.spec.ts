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
      
      const layouts = [
          { name: 'Smart', value: 'dagre' },
          { name: 'Lanes', value: 'swimlanes' },
          { name: 'Smart LR', value: 'dagre-lr' }
      ];

      for (const layout of layouts) {
          await test.step(`Testing ${layout.name} layout reset`, async () => {
              // 1. Activate Layout
              const dropdown = page.locator('select[title="Layout Mode"]');
              await dropdown.selectOption(layout.value);
              await page.waitForTimeout(1000); // Wait for layout animation
              
              await screenshot(page, dir, `baseline-${layout.name.replace(' ', '-')}`);

              // 2. Get Baseline Position
              const boxOriginal = await eggNode.boundingBox();
              expect(boxOriginal).toBeTruthy();

              // 3. Move Node (Make Dirty)
              await move_node(page, '1 Egg', 200, 0, dir);
              const boxMoved = await eggNode.boundingBox();
              
              // Verify it actually moved
              expect(Math.abs(boxMoved!.x - boxOriginal!.x)).toBeGreaterThan(50); 
              
              await screenshot(page, dir, `moved-${layout.name.replace(' ', '-')}`);

              // 4. Click Reset Button
              // In the new UI, selecting the same option in dropdown doesn't trigger change.
              // We must click the explicit Reset button.
              await page.getByTitle('Reset Layout Positions').click();
              await page.waitForTimeout(1000); // Wait for animation
              
              // 5. Verify Reset
              const boxReset = await eggNode.boundingBox();
              // Should be back to original position (relaxed tolerance for new wider layout)
              expect(Math.abs(boxReset!.x - boxOriginal!.x)).toBeLessThan(100);
              
              await screenshot(page, dir, `reset-${layout.name.replace(' ', '-')}`);
          });
      }

      cleanupScreenshots(dir);
    });
  }
});