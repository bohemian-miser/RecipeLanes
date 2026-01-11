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

export function getEdgeParams(
    source: Node, 
    target: Node,
    sourceHandlePos?: { x: number, y: number },
    targetHandlePos?: { x: number, y: number }
) {
    const c1 = getCenter(source, sourceHandlePos);
    const c2 = getCenter(target, targetHandlePos);

    // Calculate Radius
    // User requested "stop short at the radius from the centre to a corner" of the icon.
    // Icon is 64x64. Radius is 32. We want to be close. 36 gives 4px padding.
    const r1 = sourceHandlePos ? 36 : (Math.min(source.width??100, source.height??50)/2 + 5);
    const r2 = targetHandlePos ? 36 : (Math.min(target.width??100, target.height??50)/2 + 5);

    const sInter = getNodeIntersection(c1, c2, r1);
    const tInter = getNodeIntersection(c2, c1, r2);

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
