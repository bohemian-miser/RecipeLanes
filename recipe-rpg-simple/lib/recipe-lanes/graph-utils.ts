import { Position, Node } from 'reactflow';

// Get the intersection point between the line (source-target) and the node border
// Modified to accept precise centers (Handle Positions)
function getNodeIntersection(
    node: Node, 
    otherNode: Node, 
    nodeCenter?: { x: number, y: number }, 
    otherNodeCenter?: { x: number, y: number }
) {
  let x1c, y1c;
  if (nodeCenter) {
      x1c = nodeCenter.x;
      y1c = nodeCenter.y;
  } else {
      const { x, y } = node.positionAbsolute || node.position;
      const w = node.width ?? 100;
      const h = node.height ?? 50;
      x1c = x + w / 2;
      y1c = y + h / 2;
  }

  let x2c, y2c;
  if (otherNodeCenter) {
      x2c = otherNodeCenter.x;
      y2c = otherNodeCenter.y;
  } else {
      const { x, y } = otherNode.positionAbsolute || otherNode.position;
      const w = otherNode.width ?? 100;
      const h = otherNode.height ?? 50;
      x2c = x + w / 2;
      y2c = y + h / 2;
  }

  // Vector
  const dx = x2c - x1c;
  const dy = y2c - y1c;
  
  if (dx === 0 && dy === 0) return { x: x1c, y: y1c };

  // Radius Logic
  // If we have specific handle center, assume we target the Icon (Radius ~32 + buffer)
  // Else use node dimensions.
  let radius;
  if (nodeCenter) {
      // It's likely a MinimalNode with centered handles
      radius = 32 + 8; // 64px icon / 2 + buffer
  } else {
      const w = node.width ?? 100;
      const h = node.height ?? 50;
      radius = (Math.min(w, h) / 2) + 10; 
  }

  // Intersection
  const distance = Math.sqrt(dx * dx + dy * dy);
  const nx = dx / distance;
  const ny = dy / distance;

  return {
      x: x1c + nx * radius,
      y: y1c + ny * radius
  };
}

export function getEdgeParams(
    source: Node, 
    target: Node,
    sourceHandlePos?: { x: number, y: number },
    targetHandlePos?: { x: number, y: number }
) {
  const sourceIntersection = getNodeIntersection(source, target, sourceHandlePos, targetHandlePos);
  const targetIntersection = getNodeIntersection(target, source, targetHandlePos, sourceHandlePos);

  return {
    sx: sourceIntersection.x,
    sy: sourceIntersection.y,
    tx: targetIntersection.x,
    ty: targetIntersection.y,
    sourcePos: Position.Top, 
    targetPos: Position.Bottom,
  };
}