import { Position, Node } from 'reactflow';

// Helper to get center
function getCenter(node: Node, handlePos?: { x: number, y: number }) {
    // For MinimalNode, we know exact geometry relative to node position
    if (node.type === 'minimal') {
        const { x, y } = node.positionAbsolute || node.position;
        const theme = node.data?.iconTheme || 'classic';
        const meta = node.data?.iconMetadata; // { center: {x,y}, bbox: ... } normalized 0-1

        let imageX = x;
        let imageY = y;
        let imageSize = 0;

        if (theme === 'modern' || theme === 'modern_clean') {
            // Modern: 120x120 container. 96x96 icon centered.
            // Padding: (120-96)/2 = 12.
            imageX = x + 12;
            imageY = y + 12;
            imageSize = 96;
        } else {
            // Classic: Dynamic Size. Icon container is 80x80. Image is 72x72 centered inside.
            const textPos = node.data?.textPos || 'bottom';
            const w = node.width ?? (textPos === 'right' || textPos === 'left' ? 160 : 100);
            const h = node.height ?? 100;
            
            let containerX = 0;
            let containerY = 0;
            
            if (textPos === 'bottom') { // Icon at Top
                containerX = (w - 80) / 2;
                containerY = 0;
            } else if (textPos === 'top') { // Icon at Bottom
                containerX = (w - 80) / 2;
                containerY = h - 80;
            } else if (textPos === 'right') { // Icon at Left
                 containerX = 0;
                 containerY = (h - 80) / 2;
            } else if (textPos === 'left') { // Icon at Right
                 containerX = w - 80;
                 containerY = (h - 80) / 2;
            }
            
            // Image is 72x72 inside 80x80 (4px padding)
            imageX = x + containerX + 4;
            imageY = y + containerY + 4;
            imageSize = 72;
        }

        if (meta && meta.center) {
             return {
                 x: imageX + meta.center.x * imageSize,
                 y: imageY + meta.center.y * imageSize
             };
        }
        
        // Fallback to center of image area
        return {
            x: imageX + imageSize / 2,
            y: imageY + imageSize / 2
        };
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
