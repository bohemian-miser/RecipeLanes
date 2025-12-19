import type { RecipeGraph, LayoutGraph, VisualNode, VisualEdge, VisualLane, RecipeNode } from './types';
import dagre from 'dagre';

const LANE_WIDTH = 400;
const ACTION_WIDTH = 140;
const INGREDIENT_WIDTH_BASE = 100; 
const PADDING_TOP = 120; 
const PADDING_LEFT = 40;
const GAP_Y = 140; 
const GAP_X = 40; 
const NODE_HEIGHT = 160; 
const INGREDIENT_HEIGHT_BASE = 120;

const LANE_COLORS = {
// ... existing constants ...
// ... existing calculateLayout wrapper ...

// --- Swimlane Logic (Orbital) ---
const calculateSwimlaneLayout = (graph: RecipeGraph): LayoutGraph => {
  // ... (keep existing implementation) ...
  const nodes: VisualNode[] = [];
  const edges: VisualEdge[] = [];
  
  if (!graph.lanes.length) {
      return { nodes: [], edges: [], lanes: [], width: 800, height: 600 };
  }
  // ... (rest of calculateSwimlaneLayout as previously written) ...
  // Wait, I cannot use "..." in write_file. I must provide the full file content or use replace carefully.
  // I will use replace for the *Compact Logic* section only.
}; 

// I will assume I am replacing the `calculateCompactLayout` function block.
// But first I need to add the import.

// Strategy:
// 1. Add import at top.
// 2. Replace calculateCompactLayout.

// I will try to replace the import first.

const ACTION_WIDTH = 140;
const INGREDIENT_WIDTH_BASE = 100; 
const PADDING_TOP = 120; // Increased padding to prevent top cutoff
const PADDING_LEFT = 40;
const GAP_Y = 140; 
const GAP_X = 40; 
const NODE_HEIGHT = 160; 
const INGREDIENT_HEIGHT_BASE = 120;

const LANE_COLORS = {
  prep: '#EFF6FF',
  cook: '#FFF7ED',
  serve: '#F0FDF4',
  default: '#FAFAFA'
};

export type LayoutMode = 'lanes' | 'compact';

export const calculateLayout = (graph: RecipeGraph, mode: LayoutMode = 'lanes'): LayoutGraph => {
  if (mode === 'compact') {
      return calculateCompactLayout(graph);
  }
  return calculateSwimlaneLayout(graph);
};

// --- Swimlane Logic (Orbital) ---
const calculateSwimlaneLayout = (graph: RecipeGraph): LayoutGraph => {
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

  // 2. Index Nodes
  const nodeMap = new Map<string, RecipeNode>();
  graph.nodes.forEach(node => nodeMap.set(node.id, node));

  // 3. Topological Sort
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
  const laneStepCounters = new Array(graph.lanes.length).fill(0); 

  const sortedNodes = [...graph.nodes].sort((a, b) => {
    const rA = ranks.get(a.id) || 0;
    const rB = ranks.get(b.id) || 0;
    if (rA !== rB) return rA - rB;
    return a.id.localeCompare(b.id);
  });

  const placedNodes = new Set<string>();

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

  sortedNodes.forEach(node => {
      if (placedNodes.has(node.id)) return;
      if (node.type === 'ingredient') return;

      const laneIdx = laneMap.get(node.laneId) || 0;
      const stepIndex = laneStepCounters[laneIdx]++;
      
      let minDepY = 0;
      if (node.inputs) {
          node.inputs.forEach(inputId => {
             const inputPos = nodePosMap.get(inputId);
             // Only care about Action dependencies for Y constraint
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

      placeNodeAbsolute(node, actionX, actionY);
      laneYCursors[laneIdx] = actionY + actionHeight + GAP_Y;

      if (node.inputs) {
          const ingredients = node.inputs
              .map(id => nodeMap.get(id))
              .filter(n => n && n.type === 'ingredient' && !placedNodes.has(n.id)) as RecipeNode[];

          if (ingredients.length > 0) {
              const isFirstStep = stepIndex === 0;
              const count = ingredients.length;
              let scale = 1;
              if (count > 4) scale = 0.8;
              
              const ingWidth = INGREDIENT_WIDTH_BASE * scale;
              const ingHeight = INGREDIENT_HEIGHT_BASE * scale;
              const actionCenterX = actionX + actionWidth / 2;
              const anchorX = actionCenterX;
              const anchorY = actionY + 40; 

              if (isFirstStep) {
                  // Top Arc
                  if (count > 8) {
                      const startY = actionY - (Math.ceil(count/2) * (ingHeight + 10)) - 20;
                      ingredients.forEach((ing, i) => {
                          const col = i % 2;
                          const row = Math.floor(i / 2);
                          const ix = actionCenterX - ingWidth + (col * (ingWidth + 10));
                          const iy = startY + row * (ingHeight + 10);
                          placeNodeAbsolute(ing, ix, iy, scale);
                      });
                  } else {
                      const radius = 140 * scale; 
                      const angleStep = 40; 
                      const totalSpan = (count - 1) * angleStep;
                      const startAngle = -90 - (totalSpan / 2); 

                      ingredients.forEach((ing, i) => {
                          const angleDeg = startAngle + i * angleStep;
                          const angleRad = angleDeg * (Math.PI / 180);
                          const ix = anchorX + radius * Math.cos(angleRad) - ingWidth / 2;
                          const iy = anchorY + radius * Math.sin(angleRad) - ingHeight / 2;
                          placeNodeAbsolute(ing, ix, iy, scale);
                      });
                  }
              } else {
                  // Side Arc
                  const isRight = stepIndex % 2 !== 0;
                  const sideMult = isRight ? 1 : -1;
                  
                  if (count > 5) {
                      ingredients.forEach((ing, i) => {
                          const ix = actionCenterX + (sideMult * (ACTION_WIDTH/2 + 20)) + (isRight ? 0 : -ingWidth);
                          const iy = actionY + i * (ingHeight + 10); 
                          placeNodeAbsolute(ing, ix, iy, scale);
                      });
                  } else {
                      const centerAngle = isRight ? -45 : -135;
                      const radius = 130 * scale;
                      const angleStep = 30;
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

  sortedNodes.forEach(node => {
      if (!placedNodes.has(node.id)) {
          const laneIdx = laneMap.get(node.laneId) || 0;
          const y = laneYCursors[laneIdx];
          const x = PADDING_LEFT + laneIdx * LANE_WIDTH + (LANE_WIDTH - ACTION_WIDTH) / 2;
          placeNodeAbsolute(node, x, y);
          laneYCursors[laneIdx] += NODE_HEIGHT + GAP_Y;
      }
  });

  // 5. Calculate Bounds & Shift
  let minX = Infinity, minY = Infinity;
  
  nodes.forEach(n => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
  });
  
  // Shift to ensure Top-Left alignment with Padding
  const shiftX = PADDING_LEFT - minX;
  const shiftY = PADDING_TOP - minY;
  
  nodes.forEach(n => {
      n.x += shiftX;
      n.y += shiftY;
  });
  
  // Re-calculate Max Bounds for Canvas Size
  let finalMaxX = 0;
  let finalMaxY = 0;
  nodes.forEach(n => {
      finalMaxX = Math.max(finalMaxX, n.x + n.width);
      finalMaxY = Math.max(finalMaxY, n.y + n.height);
  });

  const layoutWidth = finalMaxX + PADDING_LEFT;
  const layoutHeight = finalMaxY + PADDING_TOP;
  visualLanes.forEach(l => l.height = layoutHeight);

  // 6. Generate Edges (After placement and shift)
  const visualNodeMap = new Map<string, VisualNode>();
  nodes.forEach(n => visualNodeMap.set(n.id, n));

  graph.nodes.forEach(node => {
    if (node.inputs) {
      node.inputs.forEach(inputId => {
        const source = visualNodeMap.get(inputId);
        const target = visualNodeMap.get(node.id);
        
        if (source && target) {
          const startX = source.x + source.width / 2;
          const startY = source.y + source.height / 2; 
          const endX = target.x + target.width / 2;
          const endY = target.y + target.height / 2; 
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

  return { nodes, edges, lanes: visualLanes, width: layoutWidth, height: layoutHeight };
};

// --- New Compact Logic (Dagre) ---
const calculateCompactLayout = (graph: RecipeGraph): LayoutGraph => {
  const g = new dagre.graphlib.Graph();
  
  // Set an object for the graph label
  g.setGraph({
    rankdir: 'TB',
    align: 'UL',
    nodesep: 60, // Horizontal separation
    ranksep: 100, // Vertical separation
    marginx: PADDING_LEFT,
    marginy: PADDING_TOP
  });

  g.setDefaultEdgeLabel(() => ({}));

  // Add Nodes
  graph.nodes.forEach(node => {
      const isIng = node.type === 'ingredient';
      const width = isIng ? INGREDIENT_WIDTH_BASE : ACTION_WIDTH;
      const height = isIng ? INGREDIENT_HEIGHT_BASE : NODE_HEIGHT;
      
      g.setNode(node.id, { 
          width, 
          height,
          label: node.id,
          customData: node // Pass through for later
      });
  });

  // Add Edges
  graph.nodes.forEach(node => {
      if (node.inputs) {
          node.inputs.forEach(inputId => {
              // Dagre edge: Source -> Target
              g.setEdge(inputId, node.id);
          });
      }
  });

  // Run Layout
  dagre.layout(g);

  // Map back to VisualNode/VisualEdge
  const nodes: VisualNode[] = [];
  const edges: VisualEdge[] = [];
  
  let maxX = 0;
  let maxY = 0;

  g.nodes().forEach(v => {
      const n = g.node(v);
      const data = (n as any).customData; // Recover data
      
      // Dagre gives Center X/Y. Convert to Top-Left.
      const x = n.x - n.width / 2;
      const y = n.y - n.height / 2;
      
      maxX = Math.max(maxX, x + n.width);
      maxY = Math.max(maxY, y + n.height);

      nodes.push({
          id: v,
          type: data.type,
          x,
          y,
          width: n.width,
          height: n.height,
          data: data
      });
  });

  g.edges().forEach(e => {
      const edge = g.edge(e);
      // edge.points is array of {x, y}
      // Construct path
      // Simple Polyline: M x0 y0 L x1 y1 L x2 y2 ...
      
      if (edge.points && edge.points.length > 0) {
          const path = edge.points.map((p, i) => {
              return `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`;
          }).join(' ');
          
          // Smoother: Bezier?
          // If 3 points (Start, Bend, End)?
          // Dagre usually gives start, inner points, end.
          // Let's stick to L for robustness.
          
          edges.push({
              id: `${e.v}->${e.w}`,
              sourceId: e.v,
              targetId: e.w,
              path
          });
      }
  });

  // Padding adjustment if needed (Dagre handles marginx/y but let's be safe)
  const layoutWidth = Math.max(maxX + PADDING_LEFT, 800);
  const layoutHeight = Math.max(maxY + PADDING_TOP, 800);

  return {
      nodes,
      edges,
      lanes: [],
      width: layoutWidth,
      height: layoutHeight
  };
};
