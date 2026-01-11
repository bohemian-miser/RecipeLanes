import { Position, Node } from 'reactflow';
import { getNodeIconMetadata } from './model-utils';

// Helper to get center
function getCenter(node: Node, handlePos?: { x: number, y: number }) {
    // For MinimalNode, we know exact geometry relative to node position
    if (node.type === 'minimal') {
        const theme = node.data?.iconTheme || 'classic';
        const meta = getNodeIconMetadata(node.data); // { center: {x,y}, bbox: ... } normalized 0-1

        if (theme === 'modern' || theme === 'modern_clean') {
            // Modern: Fixed 120x120 container. 96x96 icon centered.
            // We use node position because handles are at edges (top/bottom), not center.
            // Width is fixed, so node.position is reliable.
            const { x, y } = node.positionAbsolute || node.position;
            const imageX = x + 12;
            const imageY = y + 12;
            const imageSize = 96;

            if (meta && meta.center) {
                return {
                    x: imageX + meta.center.x * imageSize,
                    y: imageY + meta.center.y * imageSize
                };
            } else {
                console.warn('NO METADATA center for modern icon node:', node.id);
            }
            return { x: imageX + imageSize / 2, y: imageY + imageSize / 2 };
        } 
        else {
            // Classic: Dynamic Size. Icon container is 80x80.
            // Handles are ALWAYS centered in the Icon Container (top-1/2 left-1/2).
            // We MUST use handlePos because node width is unreliable (text wrapping).
            if (handlePos) {
                console.log(`Using handlePos: ${handlePos.x}, ${handlePos.y} for classic icon node:`, node.id);
                 // Red Dot Visualization uses the full 80x80 container for metadata mapping.
                 // To align arrows with the red dot, we must use the same reference frame.
                 const imageSize = 80;
                const imageX = handlePos.x - imageSize/2; // Handle is center.
                const imageY = handlePos.y; 

                 if (meta && meta.center) {
                    return {
                        x: imageX + meta.center.x * imageSize,
                        y: imageY + meta.center.y * imageSize
                    };
                 }
                 return handlePos; // Default to handle (center)
            }
            
            // Fallback if no handlePos (rare/initial): Use heuristics but accept they might be off
            // ... (keep existing fallback logic if desired, or simplify) ...
            const { x, y } = node.positionAbsolute || node.position;
             // Best guess for bottom layout
            return { x: x + 50, y: y + 50 }; 
        }
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

function getBBox(node: Node, handlePos?: {x: number, y: number}) {
    if (node.type !== 'minimal') return null;
    const meta = getNodeIconMetadata(node.data);
    if (!meta || !meta.bbox) return null;
    
    const theme = node.data?.iconTheme || 'classic';
    let imageX = 0, imageY = 0, imageSize = 0;

    if (theme === 'modern' || theme === 'modern_clean') {
        const { x, y } = node.positionAbsolute || node.position;
        imageX = x + 12;
        imageY = y + 12;
        imageSize = 96;
    } else {
        if (!handlePos) return null; // Simplified fallback for Classic
        imageSize = 80;
        imageX = handlePos.x - 40;
        imageY = handlePos.y - 40;
    }
    
    // Apply asymmetric padding to bbox for aesthetics
    const paddingX = 8;
    const paddingTop = 2;
    const paddingBottom = 15;

    return {
        x: imageX + meta.bbox.x * imageSize - paddingX,
        y: imageY + meta.bbox.y * imageSize - paddingTop,
        w: meta.bbox.w * imageSize + (paddingX*2),
        h: meta.bbox.h * imageSize + (paddingTop + paddingBottom)
    };
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

function getRadius(node: Node, hasHandle: boolean) {
    if (node.type !== 'minimal') {
        return (Math.min(node.width??100, node.height??50)/2 + 5);
    }
    const theme = node.data?.iconTheme || 'classic';
    if (theme === 'modern' || theme === 'modern_clean') {
        return 58; // 96px / 2
    }
    return 36; // 72px / 2
}

export function getEdgeParams(
    source: Node, 
    target: Node,
    sourceHandlePos?: { x: number, y: number },
    targetHandlePos?: { x: number, y: number }
) {
    const c1 = getCenter(source, sourceHandlePos);
    const c2 = getCenter(target, targetHandlePos);

    let sInter, tInter;

    const bbox1 = getBBox(source, sourceHandlePos);
    if (bbox1) {
        sInter = getRectIntersection(c1, c2, bbox1);
    } else {
        const r1 = getRadius(source, !!sourceHandlePos);
        sInter = getNodeIntersection(c1, c2, r1);
    }

    const bbox2 = getBBox(target, targetHandlePos);
    if (bbox2) {
        tInter = getRectIntersection(c2, c1, bbox2);
    } else {
        const r2 = getRadius(target, !!targetHandlePos);
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
