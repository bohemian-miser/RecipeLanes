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
    await page.mouse.move(box!.x + box!.width / 2 + dx, box!.y + box!.height / 2 + dy, { steps: 10 });
    await page.mouse.up();
    
    await screenshot(page, dir, `after-move-${text}`);
    return node;
}

export async function delete_node(page: Page, text: string, dir: string) {
    const node = await click_on_node(page, text, dir);
    await node.hover();
    const deleteBtn = node.getByRole('button', { name: /Delete Step/i });
    await expect(deleteBtn).toBeVisible();
    await screenshot(page, dir, `before-delete-${text}`);
    await deleteBtn.click({ force: true });
    await expect(node).not.toBeVisible();
    await screenshot(page, dir, `after-delete-${text}`);
}

export async function click_undo(page: Page, dir: string) {
    const undoBtn = page.locator('button[title="Undo (Ctrl+Z)"]');
    await expect(undoBtn).toBeEnabled();
    await screenshot(page, dir, `before-undo`);
    await undoBtn.click();
    await page.waitForTimeout(500); // Wait for animation
    await screenshot(page, dir, `after-undo`);
}
