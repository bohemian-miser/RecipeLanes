import { Position, Node } from 'reactflow';

// Helper to get center
function getCenter(node: Node, handlePos?: { x: number, y: number }) {
    // For MinimalNode, we know exact geometry relative to node position
    // Trusting manual calc avoids React Flow handle pos issues (e.g. if transforms aren't tracked)
    if (node.type === 'minimal') {
        const { x, y } = node.positionAbsolute || node.position;
        // Check for dimensions, default to standard MinimalNode size if missing
        const w = node.width ?? (node.data?.textPos === 'right' || node.data?.textPos === 'left' ? 160 : 100);
        const h = node.height ?? 100;
        const textPos = node.data?.textPos || 'bottom';
        
        // Icon is 64x64. Radius 32.
        // If bottom: Icon is at top. Center is (w/2, 32).
        if (textPos === 'bottom') return { x: x + w / 2, y: y + 32 };
        // If top: Icon is at bottom. Center is (w/2, h - 32).
        if (textPos === 'top') return { x: x + w / 2, y: y + h - 32 };
        // If right: Icon is left. Center is (32, h/2).
        if (textPos === 'right') return { x: x + 32, y: y + h / 2 };
        // If left: Icon is right. Center is (w - 32, h/2).
        if (textPos === 'left') return { x: x + w - 32, y: y + h / 2 };
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
    // Icon is 64x64. Half is 32. Corner distance = sqrt(32^2 + 32^2) ≈ 45.25.
    // We use 46 to be safe.
    const r1 = sourceHandlePos ? 46 : (Math.min(source.width??100, source.height??50)/2 + 5);
    const r2 = targetHandlePos ? 46 : (Math.min(target.width??100, target.height??50)/2 + 5);

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
