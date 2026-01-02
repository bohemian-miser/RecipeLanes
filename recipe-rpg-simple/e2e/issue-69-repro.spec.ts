import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('issue 69: mobile pivot interaction', async ({ page }) => {
  // 1. Setup Graph with Egg -> Mix
  await page.goto('/lanes?new=true');
  await page.getByPlaceholder('Paste recipe here...').fill(`1 Egg
Mix`);
  await page.locator('button:has(svg.lucide-arrow-right)').click();
  
  const eggNode = page.locator('.react-flow__node').filter({ hasText: 'Egg' }).first();
  const mixNode = page.locator('.react-flow__node').filter({ hasText: 'Mix' }).first();
  
  await expect(eggNode).toBeVisible({ timeout: 15000 });
  
  // Get initial positions
  const getPos = async (loc: any) => {
      const box = await loc.boundingBox();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  
  const eggStart = await getPos(eggNode);
  
  // 2. Test Pivot (Tap & Hold + Drag)
  // Touch & Hold for 800ms (longer than 300ms threshold)
  const box = await eggNode.boundingBox();
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  
  // Wait for Long Press
  await page.waitForTimeout(800);
  
  // Verify "Pivot Mode" visual feedback (Blue outline)
  // The node has class `border-blue-500` or similar when pivot mode is active
  // MinimalNode.tsx: `border-2 border-dashed border-blue-500`
  await expect(eggNode.locator('.border-blue-500')).toBeVisible();

  // Drag
  await page.mouse.move(centerX + 100, centerY + 50, { steps: 10 });
  await page.mouse.up();
  
  await page.waitForTimeout(1000); // Wait for settlement
  
  const eggEnd = await getPos(eggNode);
  const mixEnd = await getPos(mixNode); // Mix should act as pivot if connected, but here Egg -> Mix?
  // Wait, parser connects sequential lines?
  // "1 Egg\nMix" -> "Egg" and "Mix".
  // "Mix" is action. "Egg" is ingredient.
  // Is there an edge?
  // The parser usually links ingredients to next action.
  // So Egg -> Mix.
  // If I pivot Egg, Egg rotates around Mix?
  // Logic: `const outgoing = edges.find(e => e.source === node.id); const child = ...`
  // Yes, Egg is source, Mix is target.
  // So Egg rotates around Mix.
  
  // Check movement
  const eggDist = Math.sqrt(Math.pow(eggEnd.x - eggStart.x, 2) + Math.pow(eggEnd.y - eggStart.y, 2));
  console.log('Egg Distance:', eggDist);
  expect(eggDist).toBeGreaterThan(20);
  
  // 3. Test Tap Selection (Branch Selection)
  // Tap Mix node
  const mixBox = await mixNode.boundingBox();
  const mixCX = mixBox.x + mixBox.width / 2;
  const mixCY = mixBox.y + mixBox.height / 2;
  
  await page.mouse.move(mixCX, mixCY);
  await page.mouse.down();
  await page.mouse.up();
  
  // It should be selected.
  // ReactFlow adds `selected` class to the node wrapper?
  await expect(mixNode).toHaveClass(/selected/);
  
  // Issue says: "tap and release - selects branch".
  // Currently: Click selects node. Click again selects branch.
  // Let's check if branch selection happens on first click?
  // Or if the requirement is "Tap selects branch" (IMMEDIATELY).
  
  // If requirement is "Tap: Select Branch", then first tap should select branch.
  // Currently it selects Node.
  // We will assert current behavior or desired behavior?
  // "On mobile it should be... tap and release - selects branch".
  // This implies CHANGE.
  
});
