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

/**
 * Edge-anchor geometry — the single source of truth for mapping icon metadata
 * (center/bbox, normalized 0-1) into flow coordinates.
 *
 * ## The coordinate contract (measured in the real DOM, 2026-07-06)
 *
 * ReactFlow reports handle positions from its own stylesheet, and RF's
 * `.react-flow__handle-top { top: -4px; left: 50% }` WINS over the Tailwind
 * `top-1/2 left-1/2` classes on the classic node's handles. So despite the
 * markup's intent, the classic handle sits at the **top-center of the icon
 * container**, not its center. All classic math below is anchored to that
 * measured fact. If the handle CSS is ever changed, re-run the DOM probe and
 * update HANDLE_AT below.
 *
 * ## Metadata reference frame
 *
 * Metadata percentages map over the **icon container** (56px ingredient /
 * 80px action for classic) — the same frame as the red-dot debug overlay in
 * minimal-node-classic.tsx, which was visually validated against painted
 * centers.
 *
 * ## Leaf scaling (#155)
 *
 * Leaf nodes shrink via a CSS transform whose origin is pinned to the handle
 * point (see getLeafScaleOrigin). That keeps RF's measured handle position
 * valid at every scale — CSS transforms don't fire ResizeObserver, so RF
 * would otherwise report stale handle bounds while the icon visually moved.
 * Anchor math therefore only needs to scale frame *sizes*, never the handle
 * point itself.
 */

export interface AnchorFrame {
    /** Top-left of the metadata reference frame, flow coordinates. */
    x: number;
    y: number;
    /** Side length of the (square) frame, already leaf-scaled. */
    size: number;
}

export interface NormalizedPoint { x: number; y: number }
export interface NormalizedBBox { x: number; y: number; w: number; h: number }

/** Icon container sides for the classic theme. */
export const CLASSIC_CONTAINER = { ingredient: 56, action: 80 } as const;
/** Modern theme container / inner-image sides. */
export const MODERN_CONTAINER = { ingredient: 80, action: 120 } as const;
export const MODERN_IMAGE = { ingredient: 64, action: 96 } as const;

/**
 * Classic frame from the RF-reported handle position.
 * Handle = top-center of the icon container (see module header).
 */
export function getClassicFrame(
    handlePos: NormalizedPoint,
    isIngredient: boolean,
    scale = 1,
): AnchorFrame {
    const size = (isIngredient ? CLASSIC_CONTAINER.ingredient : CLASSIC_CONTAINER.action) * scale;
    return { x: handlePos.x - size / 2, y: handlePos.y, size };
}

/**
 * Modern frame from the node's top-left position (modern nodes have a fixed
 * container width, so node.position is reliable; handles sit at the top/bottom
 * edges and are not useful as a frame reference).
 * The frame is the inner image (64px in an 80px container for ingredients,
 * 96px in 120px for actions). Scaling is about the container's top-center.
 */
export function getModernFrame(
    nodePos: NormalizedPoint,
    isIngredient: boolean,
    scale = 1,
): AnchorFrame {
    const container = isIngredient ? MODERN_CONTAINER.ingredient : MODERN_CONTAINER.action;
    const image = (isIngredient ? MODERN_IMAGE.ingredient : MODERN_IMAGE.action) * scale;
    const pad = (container - (isIngredient ? MODERN_IMAGE.ingredient : MODERN_IMAGE.action)) / 2;
    return {
        x: nodePos.x + container / 2 - image / 2,
        y: nodePos.y + pad * scale,
        size: image,
    };
}

/** Maps a normalized metadata point into flow coordinates within a frame. */
export function anchorPoint(frame: AnchorFrame, p: NormalizedPoint): NormalizedPoint {
    return { x: frame.x + p.x * frame.size, y: frame.y + p.y * frame.size };
}

/** The frame's own center — fallback when icon metadata is missing (#170). */
export function frameCenter(frame: AnchorFrame): NormalizedPoint {
    return { x: frame.x + frame.size / 2, y: frame.y + frame.size / 2 };
}

/**
 * Maps a normalized bbox into flow coordinates, expanded by visual padding.
 * Padding is in unscaled px (it models the arrowhead standoff, not the icon).
 */
export function anchorBBox(
    frame: AnchorFrame,
    bbox: NormalizedBBox,
    padding: { x: number; top: number; bottom: number },
): { x: number; y: number; w: number; h: number } {
    return {
        x: frame.x + bbox.x * frame.size - padding.x,
        y: frame.y + bbox.y * frame.size - padding.top,
        w: bbox.w * frame.size + padding.x * 2,
        h: bbox.h * frame.size + padding.top + padding.bottom,
    };
}

/**
 * Fallback circle radius (no bbox metadata): half the visible image, scaled.
 * Classic images render at 48px (ingredient) / 72px (action).
 */
export function fallbackRadius(theme: 'classic' | 'modern', isIngredient: boolean, scale = 1): number {
    if (theme === 'modern') return (MODERN_IMAGE[isIngredient ? 'ingredient' : 'action'] / 2 + 10) * scale;
    return (isIngredient ? 24 : 36) * scale;
}

/**
 * CSS transform-origin that pins the classic node's handle point (top-center
 * of the icon container) while leaf-scaling, per textPos flex layout:
 *  - bottom (default): icon container is the wrapper's first row → origin at
 *    the wrapper's top-center.
 *  - top: container sits at the wrapper's bottom → origin bottom-center minus
 *    the container height.
 *  - right/left: container is at the horizontal start/end, vertically
 *    centered → origin at the container's top-center on that side.
 */
export function getLeafScaleOrigin(
    textPos: 'bottom' | 'top' | 'left' | 'right',
    containerSize: number,
): string {
    const half = containerSize / 2;
    switch (textPos) {
        case 'top': return `50% calc(100% - ${containerSize}px)`;
        case 'right': return `${half}px calc(50% - ${half}px)`;
        case 'left': return `calc(100% - ${half}px) calc(50% - ${half}px)`;
        default: return '50% 0px';
    }
}
