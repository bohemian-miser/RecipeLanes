import { Position, Node } from 'reactflow';

// Get the intersection point between the line (source-target) and the node border
function getNodeIntersection(intersectionNode: Node, targetNode: Node) {
  // https://math.stackexchange.com/questions/256100/how-can-i-find-the-points-at-which-two-circles-intersect
  // Actually simpler: intersection of line and circle/rect.

  // Dimensions
  const w = intersectionNode.width ?? 100;
  const h = intersectionNode.height ?? 50;

  // Center
  const { x: x1, y: y1 } = intersectionNode.positionAbsolute || intersectionNode.position;
  const { x: x2, y: y2 } = targetNode.positionAbsolute || targetNode.position;

  const x1c = x1 + w / 2;
  const y1c = y1 + h / 2;
  const x2c = x2 + (targetNode.width ?? 0) / 2;
  const y2c = y2 + (targetNode.height ?? 0) / 2;

  // Vector
  const dx = x2c - x1c;
  const dy = y2c - y1c;
  
  if (dx === 0 && dy === 0) return { x: x1c, y: y1c };

  // Assume Circle for "invisible circle around each icon"
  // Radius is half of width (or height if smaller/larger, usually min or average)
  // User said "invisible circle around each icon, no padding, it should touch top and bottom of the image"
  // MinimalNode icon is 64px. Node width is 100px.
  // Let's approximate radius based on node type or width.
  // Ideally we use a circle that fits the content.
  // Let's use `Math.min(w, h) / 2` as radius for a tight circle, or slightly larger.
  // Actually, standard `MinimalNode` is 100w x ~100h. Radius 50?
  // User said "invisible circle around each icon". Icon is 64x64. Radius 32.
  // But node includes text below.
  // If we want arrows to touch the *icon*, we should use the icon radius (32) + padding?
  // Or if we treat the whole node as the target?
  // "every arrow should go from and to this invisible circle"
  // I'll assume radius = width / 2 is safe-ish, or hardcode ~36px.
  
  // Add buffer as requested ("invisible concentric buffer")
  const buffer = 10;
  const radius = (Math.min(w, h) / 2) + buffer; 

  // Intersection with Circle at (x1c, y1c) with radius r
  // Point = Center + Radius * NormalizedVector
  const distance = Math.sqrt(dx * dx + dy * dy);
  const nx = dx / distance;
  const ny = dy / distance;

  return {
      x: x1c + nx * radius,
      y: y1c + ny * radius
  };
}

export function getEdgeParams(source: Node, target: Node) {
  const sourceIntersection = getNodeIntersection(source, target);
  const targetIntersection = getNodeIntersection(target, source);

  return {
    sx: sourceIntersection.x,
    sy: sourceIntersection.y,
    tx: targetIntersection.x,
    ty: targetIntersection.y,
    sourcePos: Position.Top, // irrelevant for straight lines usually
    targetPos: Position.Bottom,
  };
}
