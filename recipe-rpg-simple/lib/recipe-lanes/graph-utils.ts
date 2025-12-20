import { Position, Node } from 'reactflow';

// Helper to get center
function getCenter(node: Node, handlePos?: { x: number, y: number }) {
    if (handlePos && typeof handlePos.x === 'number' && typeof handlePos.y === 'number') return handlePos;
    const { x, y } = node.positionAbsolute || node.position;
    const w = node.width ?? 100;
    const h = node.height ?? 50;
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
    // If handle provided (MinimalNode with centered handles), use Icon Radius (~32) + Buffer (~4).
    // Else use approximate node radius based on dimensions.
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
