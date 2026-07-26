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

import { Position, Node } from 'reactflow';
import { getNodeIconMetadata, getNodeTheme } from './model-utils';
import {
    AnchorFrame,
    anchorBBox,
    anchorPoint,
    fallbackRadius,
    frameCenter,
    getClassicFrame,
    getModernFrame,
} from './edge-anchors';

/**
 * Metadata reference frame for a minimal node, or null when it can't be
 * derived. See edge-anchors.ts for the coordinate contract (notably: the
 * classic handle sits at the TOP-CENTER of the icon container).
 * `scale` is the leaf-node scale (#155); the leaf transform origin is pinned
 * to the handle point, so only frame sizes scale.
 */
function getFrame(node: Node, handlePos?: { x: number, y: number }, scale = 1): AnchorFrame | null {
    if (node.type !== 'minimal') return null;
    const theme = getNodeTheme(node.data);
    const isIngredient = node.data?.type === 'ingredient';

    if (theme === 'modern' || theme === 'modern_clean') {
        // Modern containers are fixed-width, so node.position is reliable;
        // its handles sit at the top/bottom edges and don't locate the icon.
        const pos = node.positionAbsolute || node.position;
        return getModernFrame(pos, isIngredient, scale);
    }
    // Classic: node width varies with text wrapping — the handle is the only
    // reliable reference.
    if (!handlePos) return null;
    return getClassicFrame(handlePos, isIngredient, scale);
}

// Helper to get center
function getCenter(node: Node, handlePos?: { x: number, y: number }, scale = 1) {
    const frame = getFrame(node, handlePos, scale);
    if (frame) {
        const meta = getNodeIconMetadata(node.data); // { center: {x,y}, bbox: ... } normalized 0-1
        if (meta && meta.center) return anchorPoint(frame, meta.center);
        // No metadata (#170): anchor at the frame's own center, NOT the handle
        // (the classic handle is at the container top — anchoring there made
        // arrows stop a half-icon high on emoji/pending nodes).
        return frameCenter(frame);
    }

    if (handlePos && typeof handlePos.x === 'number' && typeof handlePos.y === 'number') return handlePos;

    const { x, y } = node.positionAbsolute || node.position;
    const w = node.width ?? 100;
    const h = node.height ?? 100;
    return { x: x + w / 2, y: y + h / 2 };
}

function getNodeIntersection(center: {x:number, y:number}, otherCenter: {x:number, y:number}, radius: number) {
    const dx = otherCenter.x - center.x;
    const dy = otherCenter.y - center.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    return {
        x: center.x + (dx / dist) * radius,
        y: center.y + (dy / dist) * radius
    };
}

function getBBox(node: Node, handlePos?: {x: number, y: number}, scale = 1) {
    if (node.type !== 'minimal') return null;
    const meta = getNodeIconMetadata(node.data);
    if (!meta || !meta.bbox) return null;

    const frame = getFrame(node, handlePos, scale);
    if (!frame) return null;

    const theme = getNodeTheme(node.data);
    const isIngredient = node.data?.type === 'ingredient';

    // Visual padding: arrowhead standoff around the icon's tight bbox.
    const padding = (theme === 'modern' || theme === 'modern_clean')
        ? { x: 8, top: 2, bottom: 15 }
        : isIngredient
            ? { x: 2, top: 2, bottom: 2 }
            : { x: 5, top: 5, bottom: 5 };

    return anchorBBox(frame, meta.bbox, padding);
}

function getRectIntersection(center: {x:number, y:number}, other: {x:number, y:number}, rect: {x:number, y:number, w:number, h:number}) {
    const dx = other.x - center.x;
    const dy = other.y - center.y;
    
    let tMin = Infinity;
    const check = (t: number) => { if (t > 0 && t < tMin) tMin = t; };

    if (dx !== 0) {
        const t1 = (rect.x - center.x) / dx;
        const y1 = center.y + t1 * dy;
        if (y1 >= rect.y && y1 <= rect.y + rect.h) check(t1);
        
        const t2 = (rect.x + rect.w - center.x) / dx;
        const y2 = center.y + t2 * dy;
        if (y2 >= rect.y && y2 <= rect.y + rect.h) check(t2);
    }

    if (dy !== 0) {
        const t3 = (rect.y - center.y) / dy;
        const x3 = center.x + t3 * dx;
        if (x3 >= rect.x && x3 <= rect.x + rect.w) check(t3);
        
        const t4 = (rect.y + rect.h - center.y) / dy;
        const x4 = center.x + t4 * dx;
        if (x4 >= rect.x && x4 <= rect.x + rect.w) check(t4);
    }
    
    if (tMin !== Infinity && tMin <= 1) { // t<=1 means intersection is between center and other (or at other)
         return { x: center.x + tMin * dx, y: center.y + tMin * dy };
    }
    
    // Fallback if no intersection (e.g. center is outside) or logic fail
    return center;
}

function getRadius(node: Node, scale = 1) {
    if (node.type !== 'minimal') {
        return (Math.min(node.width??100, node.height??50)/2 + 5);
    }
    const theme = getNodeTheme(node.data);
    const isIngredient = node.data?.type === 'ingredient';
    return fallbackRadius(
        (theme === 'modern' || theme === 'modern_clean') ? 'modern' : 'classic',
        isIngredient,
        scale,
    );
}

export function getEdgeParams(
    source: Node,
    target: Node,
    sourceHandlePos?: { x: number, y: number },
    targetHandlePos?: { x: number, y: number },
    scales?: { source?: number; target?: number },
) {
    const sScale = scales?.source ?? 1;
    const tScale = scales?.target ?? 1;
    const c1 = getCenter(source, sourceHandlePos, sScale);
    const c2 = getCenter(target, targetHandlePos, tScale);

    let sInter, tInter;

    const bbox1 = getBBox(source, sourceHandlePos, sScale);
    if (bbox1) {
        sInter = getRectIntersection(c1, c2, bbox1);
    } else {
        const r1 = getRadius(source, sScale);
        sInter = getNodeIntersection(c1, c2, r1);
    }

    const bbox2 = getBBox(target, targetHandlePos, tScale);
    if (bbox2) {
        tInter = getRectIntersection(c2, c1, bbox2);
    } else {
        const r2 = getRadius(target, tScale);
        tInter = getNodeIntersection(c2, c1, r2);
    }

    const dx = c2.x - c1.x;
    const dy = c2.y - c1.y;
    
    // Dynamic Handle Position for Bezier Curves
    let sourcePos = Position.Bottom;
    let targetPos = Position.Top;

    // Simple Quadrant Check
    if (Math.abs(dx) > Math.abs(dy)) {
        // Horizontal Dominant
        if (dx > 0) {
            sourcePos = Position.Right;
            targetPos = Position.Left;
        } else {
            sourcePos = Position.Left;
            targetPos = Position.Right;
        }
    } else {
        // Vertical Dominant
        if (dy > 0) {
            sourcePos = Position.Bottom;
            targetPos = Position.Top;
        } else {
            sourcePos = Position.Top;
            targetPos = Position.Bottom;
        }
    }

    return {
        sx: sInter.x,
        sy: sInter.y,
        tx: tInter.x,
        ty: tInter.y,
        sourcePos,
        targetPos
    };
}