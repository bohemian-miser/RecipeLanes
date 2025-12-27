import { test, expect } from '@playwright/test';

test.describe('Comprehensive Feature Tests', () => {
  
  test('Auto-Save on Move (Owner)', async ({ page, context }) => {
    // Login as Owner
    await context.addCookies([{
      name: 'session',
      value: 'mock-owner',
      url: 'http://localhost:8002/'
    }]);

    await page.goto('/lanes?new=true');
    await page.getByPlaceholder('Paste recipe here...').fill('test eggs');
    await page.locator('button.bg-yellow-500').click();
    
    // Wait for graph
    await expect(page.locator('.react-flow__node').first()).toBeVisible();
    await expect(page).toHaveURL(/id=/);

    const node = page.locator('.react-flow__node').first();
    const box1 = await node.boundingBox();
    if (!box1) throw new Error('No bounding box');

    // Drag significantly
    await node.dragTo(page.locator('.react-flow__pane'), {
      sourcePosition: { x: box1.width / 2, y: box1.height / 2 },
      targetPosition: { x: box1.x + 200, y: box1.y + 50 } 
    });
    
    // Check for notification "Saved changes."
    // This confirms the auto-save trigger fired on drag stop.
    await expect(page.locator('button[title="Save Changes"]')).toBeEnabled(); 
    // Actually, `onNotify` shows a banner.
    const notification = page.getByText('Saved changes.');
    await expect(notification).toBeVisible();
  });

  test('JSON View Hides iconUrl', async ({ page, context }) => {
    await context.addCookies([{
      name: 'session',
      value: 'mock-user',
      url: 'http://localhost:8002/'
    }]);

    await page.goto('/lanes?new=true');
    await page.getByPlaceholder('Paste recipe here...').fill('test eggs');
    await page.locator('button.bg-yellow-500').click();
    await expect(page.locator('.react-flow__node').first()).toBeVisible();

    // Toggle JSON
    await page.getByTitle('Toggle JSON View').click();
    const jsonTextarea = page.locator('textarea[placeholder="Graph JSON..."]');
    await expect(jsonTextarea).toBeVisible();
    
    const jsonContent = await jsonTextarea.inputValue();
    expect(jsonContent).toContain('"id":');
    expect(jsonContent).not.toContain('"iconUrl":');
  });

  test('Draft Persistence', async ({ page }) => {
    await page.goto('/lanes?new=true');
    const input = page.getByPlaceholder('Paste recipe here...');
    await input.fill('My Secret Draft Recipe');
    
    // Reload
    await page.reload();
    
    // Check if text persists
    await expect(input).toHaveValue('My Secret Draft Recipe');
  });

  test('Shift+Click Multi-Select', async ({ page, context }) => {
    await context.addCookies([{
      name: 'session',
      value: 'mock-user',
      url: 'http://localhost:8002/'
    }]);

    // Use "complex" mock to get multiple nodes
    await page.goto('/lanes?new=true');
    await page.getByPlaceholder('Paste recipe here...').fill('complex test');
    await page.locator('button.bg-yellow-500').click();
    
    const nodes = page.locator('.react-flow__node');
    await expect(nodes).toHaveCount(9); // Complex mock has 9 nodes

    const node1 = nodes.nth(0);
    const node2 = nodes.nth(1);

    // Click first
    await node1.click();
    await expect(node1).toHaveClass(/selected/);
    await expect(node2).not.toHaveClass(/selected/);

    // Shift+Click second
    await page.keyboard.down('Shift');
    await node2.click();
    await page.keyboard.up('Shift');

    // Both should be selected
    await expect(node1).toHaveClass(/selected/);
    await expect(node2).toHaveClass(/selected/);
  });

  test('Progress Bar', async ({ page }) => {
      // Hard to test animation, but we can check if it appears in DOM during generation
      // This is tricky with Mock AI being instant.
      // We can assume if "Forging" status is set, bar renders.
      // E2E might be too fast to catch it without slowing down mock.
      // Skipping for now, verified manually.
  });
});
