/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { Page, expect, Locator } from '@playwright/test';

export function get_node(page: Page, text: string): Locator {
    // getByText with exact:false is case-insensitive and handles special characters safely
    return page.locator('.react-flow__node').filter({ has: page.getByText(text, { exact: false }) }).first();
}

export async function click_on_node(page: Page, text: string, _dir?: string) {
    const node = get_node(page, text);
    await expect(node).toBeVisible({ timeout: 10000 });
    await node.click();
    return node;
}

/**
 * Drag a node by (dx, dy). Waits on the node's own transform changing rather than
 * sleeping — React Flow commits the new position synchronously on mouse-up, so we
 * poll the inline transform until it reflects the move.
 */
export async function move_node(page: Page, text: string, dx: number, dy: number, _dir?: string) {
    const node = get_node(page, text);
    await expect(node).toBeVisible({ timeout: 10000 });
    const box = await node.boundingBox();
    expect(box).toBeTruthy();

    const transformBefore = await node.evaluate((el: Element) => (el as HTMLElement).style.transform);

    await node.hover();
    await page.mouse.down();
    // Increase steps to ensure React Flow catches the drag
    await page.mouse.move(box!.x + box!.width / 2 + dx, box!.y + box!.height / 2 + dy, { steps: 20 });
    await page.mouse.up();

    // Wait for React Flow to commit the new position (transform changes).
    await expect
        .poll(async () => node.evaluate((el: Element) => (el as HTMLElement).style.transform), {
            timeout: 5000,
        })
        .not.toBe(transformBefore);

    return node;
}

export async function delete_node(page: Page, text: string, _dir?: string) {
    const node = await click_on_node(page, text);

    // Hover to reveal button
    await node.hover();
    const deleteBtn = node.getByRole('button', { name: /Delete Step/i });

    await expect(deleteBtn).toBeVisible();
    await expect(deleteBtn).toBeEnabled();

    await deleteBtn.click({ force: true });

    // Web-first assertion auto-retries until the node is gone.
    await expect(node).not.toBeVisible({ timeout: 10000 });
}

export async function create_recipe(page: Page, text: string, _dir?: string) {
    await page.getByPlaceholder('Paste recipe here...').waitFor({ timeout: 30000 });
    await page.getByPlaceholder('Paste recipe here...').fill(text);
    await page.locator('button:has(svg.lucide-arrow-right)').click();

    // Wait for navigation
    await page.waitForURL(/id=/);
}

export async function wait_for_graph(page: Page, _dir?: string) {
    const viewport = page.locator('.react-flow__viewport');
    await expect(viewport).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10000 });
    // Deterministic settle signal: the diagram renders data-testid="rf-ready" once
    // the initial layout + fitView has settled (see react-flow-diagram.tsx).
    await expect(page.getByTestId('rf-ready')).toBeAttached({ timeout: 10000 });
}

/**
 * Pan the react-flow pane by left-dragging from a point that is verifiably the
 * pane itself (not a node, the Controls widget at bottom-left, or the top-right
 * Panel). Probes several candidate points and uses the first where the pane is
 * the topmost element at that location, then drags by (dx, dy).
 *
 * Returns the start point used so callers can assert/report if needed.
 */
export async function pan_pane(page: Page, dx: number, dy: number): Promise<{ x: number; y: number }> {
    const pane = page.locator('.react-flow__pane');
    const box = await pane.boundingBox();
    expect(box).toBeTruthy();
    const b = box!;

    const candidates = [
        { x: b.x + b.width * 0.5, y: b.y + 40 },          // top-centre, below top bar
        { x: b.x + b.width * 0.75, y: b.y + b.height * 0.5 }, // right-middle
        { x: b.x + b.width * 0.5, y: b.y + b.height - 40 },   // bottom-centre
        { x: b.x + 60, y: b.y + b.height * 0.5 },          // left-middle (above Controls)
        { x: b.x + b.width - 60, y: b.y + b.height - 60 }, // bottom-right (clear of Controls)
    ];

    let start: { x: number; y: number } | null = null;
    for (const c of candidates) {
        const isPane = await page.evaluate(({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            return !!el && (el.classList.contains('react-flow__pane') || !!el.closest('.react-flow__pane'));
        }, c);
        if (isPane) {
            start = c;
            break;
        }
    }
    expect(start, 'no candidate point resolved to the react-flow pane').toBeTruthy();

    await page.mouse.move(start!.x, start!.y);
    await page.mouse.down();
    await page.mouse.move(start!.x + dx, start!.y + dy, { steps: 10 });
    await page.mouse.up();
    return start!;
}

export async function click_undo(page: Page, _dir?: string) {
    const undoBtn = page.locator('button[title="Undo (Ctrl+Z)"]');
    await expect(undoBtn).toBeEnabled();
    await undoBtn.click();
}
