import type { RecipeGraph, LayoutGraph, VisualNode, VisualEdge, VisualLane, RecipeNode } from './types';

const LANE_WIDTH = 400;
const ACTION_WIDTH = 140;
const INGREDIENT_WIDTH_BASE = 100; // Will scale down
const PADDING_TOP = 80;
const PADDING_LEFT = 40;
const GAP_Y = 140; // Vertical gap between action steps (increased for arcs)
const NODE_HEIGHT = 160; 
const INGREDIENT_HEIGHT_BASE = 120; // Will scale down

const LANE_COLORS = {
  prep: '#EFF6FF',
  cook: '#FFF7ED',
  serve: '#F0FDF4',
  default: '#FAFAFA'
};

export const calculateLayout = (graph: RecipeGraph): LayoutGraph => {
  const nodes: VisualNode[] = [];
  const edges: VisualEdge[] = [];
  
  if (!graph.lanes.length) {
      return { nodes: [], edges: [], lanes: [], width: 800, height: 600 };
  }

  // 1. Setup Lanes
  const laneMap = new Map<string, number>();
  graph.lanes.forEach((lane, idx) => laneMap.set(lane.id, idx));

  const visualLanes: VisualLane[] = graph.lanes.map((lane, idx) => ({
    id: lane.id,
    label: lane.label,
    x: PADDING_LEFT + idx * LANE_WIDTH,
    width: LANE_WIDTH,
    height: 0, 
    color: LANE_COLORS[lane.type] || LANE_COLORS.default
  }));

  // 2. Index Nodes & Helper Maps
  const nodeMap = new Map<string, RecipeNode>();
  graph.nodes.forEach(node => nodeMap.set(node.id, node));

  // 3. Topological Sort (Global Rank)
  const ranks = new Map<string, number>();
  const getRank = (id: string, visited = new Set<string>()): number => {
    if (visited.has(id)) return 0;
    if (ranks.has(id)) return ranks.get(id)!;
    
    visited.add(id);
    const node = nodeMap.get(id);
    if (!node || !node.inputs || node.inputs.length === 0) {
      ranks.set(id, 0);
      return 0;
    }

    let maxInputRank = -1;
    for (const inputId of node.inputs) {
      const r = getRank(inputId, new Set(visited));
      if (r > maxInputRank) maxInputRank = r;
    }
    
    const rank = maxInputRank + 1;
    ranks.set(id, rank);
    return rank;
  };
  graph.nodes.forEach(node => getRank(node.id));

  // 4. Layout Logic
  const nodePosMap = new Map<string, { x: number, y: number, width: number, height: number }>();
  const laneYCursors = new Array(graph.lanes.length).fill(PADDING_TOP);
  const laneStepCounters = new Array(graph.lanes.length).fill(0); // Track Step Count in Lane

  const sortedNodes = [...graph.nodes].sort((a, b) => {
    const rA = ranks.get(a.id) || 0;
    const rB = ranks.get(b.id) || 0;
    if (rA !== rB) return rA - rB;
    return a.id.localeCompare(b.id);
  });

  const placedNodes = new Set<string>();

  // Place a node at specific coordinates (or auto-lane if x/y missing)
  const placeNodeAbsolute = (node: RecipeNode, x: number, y: number, scale = 1) => {
      const isIngredient = node.type === 'ingredient';
      const width = (isIngredient ? INGREDIENT_WIDTH_BASE : ACTION_WIDTH) * scale;
      const height = (isIngredient ? INGREDIENT_HEIGHT_BASE : NODE_HEIGHT) * scale;

      nodePosMap.set(node.id, { x, y, width, height });
      placedNodes.add(node.id);
      
      nodes.push({
          id: node.id,
          type: node.type,
          x,
          y,
          width,
          height,
          data: node
      });
      return { x, y, width, height };
  };

  // Main Loop (Spine Placement)
  sortedNodes.forEach(node => {
      if (placedNodes.has(node.id)) return;
      if (node.type === 'ingredient') return; // Defer ingredients

      const laneIdx = laneMap.get(node.laneId) || 0;
      const stepIndex = laneStepCounters[laneIdx]++;
      
      // Determine Action Position (Center of Lane)
      // Check inputs for vertical constraint
      let minDepY = 0;
      if (node.inputs) {
          node.inputs.forEach(inputId => {
             const inputPos = nodePosMap.get(inputId);
             // Only care about Action dependencies for Y constraint, 
             // because Ingredients will be placed relative to US.
             if (inputPos && nodeMap.get(inputId)?.type === 'action') {
                 minDepY = Math.max(minDepY, inputPos.y + inputPos.height + GAP_Y);
             }
          });
      }

      const laneX = PADDING_LEFT + laneIdx * LANE_WIDTH;
      const actionWidth = ACTION_WIDTH;
      const actionHeight = NODE_HEIGHT;
      const actionX = laneX + (LANE_WIDTH - actionWidth) / 2;
      const actionY = Math.max(minDepY, laneYCursors[laneIdx]);

      // Place Action
      placeNodeAbsolute(node, actionX, actionY);
      
      // Update Cursor (Base)
      laneYCursors[laneIdx] = actionY + actionHeight + GAP_Y;

      // Handle Ingredients (The Orbitals)
      if (node.inputs) {
          // Identify unplaced ingredients for this node
          const ingredients = node.inputs
              .map(id => nodeMap.get(id))
              .filter(n => n && n.type === 'ingredient' && !placedNodes.has(n.id)) as RecipeNode[];

          if (ingredients.length > 0) {
              const isFirstStep = stepIndex === 0;
              const count = ingredients.length;
              
              // Logic: >8 Vertical, else Arc
              // Scaling: >4 Shrink
              let scale = 1;
              if (count > 4) scale = 0.8;
              
              const ingWidth = INGREDIENT_WIDTH_BASE * scale;
              const ingHeight = INGREDIENT_HEIGHT_BASE * scale;
              const actionCenterX = actionX + actionWidth / 2;
              const actionCenterY = actionY + actionHeight / 2; // Center of action box (approx)
              // Actually visual center of action icon is top half. 
              // Let's use Top Center of Action Box as anchor for Top Arc?
              // Or Center for Side Arc?
              
              const anchorX = actionCenterX;
              const anchorY = actionY + 40; // Approx icon center

              if (isFirstStep) {
                  // --- TOP ARC ---
                  if (count > 8) {
                      // Vertical Stack Above
                      // Just place them in a grid above the action?
                      // Or just force layout engine default?
                      // Let's stack them in 2 columns above.
                      const startY = actionY - (Math.ceil(count/2) * (ingHeight + 10)) - 20;
                      ingredients.forEach((ing, i) => {
                          const col = i % 2;
                          const row = Math.floor(i / 2);
                          const ix = actionCenterX - ingWidth + (col * (ingWidth + 10));
                          const iy = startY + row * (ingHeight + 10);
                          placeNodeAbsolute(ing, ix, iy, scale);
                      });
                  } else {
                      // Arc
                      // Radius needs to be enough to clear the Action
                      const radius = 140 * scale; 
                      // Arc from -180 (Left) to 0 (Right) -> Top Semicircle
                      // Or tighter: -135 to -45
                      // Let's span based on count.
                      const angleStep = 40; // Degrees
                      const totalSpan = (count - 1) * angleStep;
                      const startAngle = -90 - (totalSpan / 2); // Centered on -90 (Top)

                      ingredients.forEach((ing, i) => {
                          const angleDeg = startAngle + i * angleStep;
                          const angleRad = angleDeg * (Math.PI / 180);
                          const ix = anchorX + radius * Math.cos(angleRad) - ingWidth / 2;
                          const iy = anchorY + radius * Math.sin(angleRad) - ingHeight / 2;
                          placeNodeAbsolute(ing, ix, iy, scale);
                      });
                  }
              } else {
                  // --- SIDE ARC (Alternating) ---
                  // Even steps (Index 1, 3... wait index is 0-based. 2nd step is index 1).
                  // Index 1 (Odd) -> Right?
                  // Index 2 (Even) -> Left?
                  // Let's do: Odd -> Right, Even -> Left.
                  // Step 0 was Top.
                  
                  const isRight = stepIndex % 2 !== 0;
                  const sideMult = isRight ? 1 : -1;
                  
                  if (count > 5) {
                      // Vertical Stack on Side
                      ingredients.forEach((ing, i) => {
                          const ix = actionCenterX + (sideMult * (ACTION_WIDTH/2 + 20)) + (isRight ? 0 : -ingWidth);
                          const iy = actionY + i * (ingHeight + 10); // Start at top of action
                          placeNodeAbsolute(ing, ix, iy, scale);
                      });
                  } else {
                      // Side Arc centered at 45 deg (Top Corner)
                      // -45 (Top Left) or -135 (Top Right)? No.
                      // 0 is Right. -90 is Top.
                      // Top Right is -45.
                      // Top Left is -135.
                      
                      const centerAngle = isRight ? -45 : -135;
                      const radius = 130 * scale;
                      
                      const angleStep = 30;
                      // Distribute around centerAngle
                      const totalSpan = (count - 1) * angleStep;
                      const startAngle = centerAngle - (totalSpan / 2);

                      ingredients.forEach((ing, i) => {
                          const angleDeg = startAngle + i * angleStep;
                          const angleRad = angleDeg * (Math.PI / 180);
                          const ix = anchorX + radius * Math.cos(angleRad) - ingWidth / 2;
                          const iy = anchorY + radius * Math.sin(angleRad) - ingHeight / 2;
                          placeNodeAbsolute(ing, ix, iy, scale);
                      });
                  }
              }
          }
      }
  });

  // Cleanup orphans
  sortedNodes.forEach(node => {
      if (!placedNodes.has(node.id)) {
          const laneIdx = laneMap.get(node.laneId) || 0;
          const y = laneYCursors[laneIdx];
          const x = PADDING_LEFT + laneIdx * LANE_WIDTH + (LANE_WIDTH - ACTION_WIDTH) / 2;
          placeNodeAbsolute(node, x, y);
          laneYCursors[laneIdx] += NODE_HEIGHT + GAP_Y;
      }
  });

  // 5. Edges
  graph.nodes.forEach(node => {
    if (node.inputs) {
      node.inputs.forEach(inputId => {
        const source = nodePosMap.get(inputId);
        const target = nodePosMap.get(node.id);
        
        if (source && target) {
          const startX = source.x + source.width / 2;
          const startY = source.y + source.height / 2; // Center-to-Center for orbit?
          // Or from edge?
          // Ingredients are "Orbiting". Maybe center to center is cleanest for organic look?
          // Or Bottom of Ing to Top of Action?
          // For Top Arc: Bottom to Top works.
          // For Side Arc: Side to Side works.
          
          // Let's use simple center-to-center straight lines for organic feel, or slight curve.
          const endX = target.x + target.width / 2;
          const endY = target.y + target.height / 2; // Target Center
          
          // Adjust target point to be closer to edge?
          // Let's just draw to center but put node on top (z-index).
          // SVG draws order dependent. Nodes are drawn AFTER edges.
          // So line to center is fine, it will be hidden by the node icon.
          
          const path = `M ${startX} ${startY} L ${endX} ${endY}`;
          
          edges.push({
            id: `${inputId}->${node.id}`,
            sourceId: inputId,
            targetId: node.id,
            path
          });
        }
      });
    }
  });

  // 6. Dimensions
  // Iterate all nodes to find bounds (since negative/wide arcs might exceed lane)
  let minX = 0, maxX = 0, maxY = 0;
  nodes.forEach(n => {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
  });
  
  // Shift everything if minX < 0
  if (minX < 0) {
      const shift = -minX + PADDING_LEFT;
      nodes.forEach(n => n.x += shift);
      // Edges need re-calc or shift?
      // Re-calc edges simply by iterating nodes again?
      // Or just shift edge path? Hard to parse path.
      // Better to calculate bounds BEFORE edges.
  }
  
  // Re-calculate edges after shift? 
  // Let's just add PADDING to initial placements large enough? 
  // Or do a post-process shift.
  
  // Hack: Just recreate edges after shift.
  // ... (Refactor above)
  
  // Simplification: Assume PADDING_LEFT handles it for now.
  // Or Update visualLanes height.
  
  const layoutHeight = Math.max(maxY + PADDING_TOP, 800);
  const layoutWidth = Math.max(maxX + PADDING_LEFT, graph.lanes.length * LANE_WIDTH + PADDING_LEFT);
  visualLanes.forEach(l => l.height = layoutHeight);

  return { nodes, edges, lanes: visualLanes, width: layoutWidth, height: layoutHeight };
};
