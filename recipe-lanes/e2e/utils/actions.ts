import { Page, expect, Locator } from '@playwright/test';
import { screenshot } from './screenshot';

export function get_node(page: Page, text: string): Locator {
    return page.locator('.react-flow__node').filter({ hasText: text }).first();
}

export async function click_on_node(page: Page, text: string, dir: string) {
    const node = get_node(page, text);
    await expect(node).toBeVisible({ timeout: 10000 });
    
    await screenshot(page, dir, `before-click-${text}`);
    await node.click();
    await screenshot(page, dir, `after-click-${text}`);
    return node;
}

export async function move_node(page: Page, text: string, dx: number, dy: number, dir: string) {
    const node = get_node(page, text);
    await expect(node).toBeVisible({ timeout: 10000 });
    const box = await node.boundingBox();
    expect(box).toBeTruthy();

    await screenshot(page, dir, `before-move-${text}`);
    
    await node.hover();
    await page.mouse.down();
    // Increase steps to ensure React Flow catches the drag
    await page.mouse.move(box!.x + box!.width / 2 + dx, box!.y + box!.height / 2 + dy, { steps: 20 });
    await page.mouse.up();
    // Wait for state update
    await page.waitForTimeout(500);
    
    await screenshot(page, dir, `after-move-${text}`);
    return node;
}

export async function delete_node(page: Page, text: string, dir: string) {
    const node = await click_on_node(page, text, dir);
    
    // Hover to reveal button
    await node.hover();
    const deleteBtn = node.getByRole('button', { name: /Delete Step/i });
    
    // Wait for button
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.waitFor({ state: 'visible' });
    await expect(deleteBtn).toBeEnabled();

    await screenshot(page, dir, `before-delete-${text}`);
    
    // Robust click with retries
    let deleted = false;
    for (let attempt = 0; attempt < 3 && !deleted; attempt++) {
        if (attempt > 0) {
            console.log(`Retry delete attempt ${attempt + 1} for ${text}`);
            await node.hover();
            await page.waitForTimeout(200);
        }
        
        await deleteBtn.click({ force: true });
        
        // Wait briefly for UI update
        try {
            await expect(node).not.toBeVisible({ timeout: 1000 });
            deleted = true;
        } catch (e) {
            // Ignore timeout, retry
        }
    }
    
    await expect(node).not.toBeVisible();
    await screenshot(page, dir, `after-delete-${text}`);
}

export async function create_recipe(page: Page, text: string, dir: string) {
    await page.getByPlaceholder('Paste recipe here...').fill(text);
    await screenshot(page, dir, 'recipe-entered');
    await page.locator('button:has(svg.lucide-arrow-right)').click();
    await screenshot(page, dir, 'create-clicked');
}

export async function wait_for_graph(page: Page, dir?: string) {
    const viewport = page.locator('.react-flow__viewport');
    await expect(viewport).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10000 });
    if (dir) {
        await screenshot(page, dir, 'graph-visible');
    }
}

export async function click_undo(page: Page, dir: string) {
    const undoBtn = page.locator('button[title="Undo (Ctrl+Z)"]');
    await expect(undoBtn).toBeEnabled();
    await screenshot(page, dir, `before-undo`);
    await undoBtn.click();
    await page.waitForTimeout(500); // Wait for animation
    await screenshot(page, dir, `after-undo`);
}
