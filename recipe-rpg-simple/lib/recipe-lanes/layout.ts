import type { RecipeGraph, LayoutGraph, VisualNode, VisualEdge, VisualLane, RecipeNode } from './types';

const LANE_WIDTH = 400;
const ACTION_WIDTH = 140;
const INGREDIENT_WIDTH_BASE = 100; 
const PADDING_TOP = 80;
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

// --- Original Swimlane Logic ---
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
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  
  nodes.forEach(n => {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x + n.width);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y + n.height);
  });
  
  // Ensure PADDING_TOP and PADDING_LEFT are respected
  // If minY is 10, and PADDING_TOP is 80, we shift by 70.
  // If minY is 100, we don't shift up? Or do we normalize to 0 then add padding?
  // Let's Normalize to (PADDING_LEFT, PADDING_TOP).
  
  const shiftX = PADDING_LEFT - minX;
  const shiftY = PADDING_TOP - minY;
  
  nodes.forEach(n => {
      n.x += shiftX;
      n.y += shiftY;
  });
  
  // Update Bounds for Canvas Size
  const layoutWidth = maxX - minX + PADDING_LEFT * 2;
  const layoutHeight = maxY - minY + PADDING_TOP * 2;
  visualLanes.forEach(l => l.height = layoutHeight);

  // 6. Generate Edges (After placement and shift)
  // Re-index visual nodes for lookup
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

// --- New Compact Logic ---
const calculateCompactLayout = (graph: RecipeGraph): LayoutGraph => {
  // Simple Layered Graph
  // Ignore Lanes (visually). Just group by Rank.
  // Center layers.
  
  // 1. Calculate Ranks (Same as above)
  const nodeMap = new Map<string, RecipeNode>();
  graph.nodes.forEach(node => nodeMap.set(node.id, node));
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
    let maxR = -1;
    for (const i of node.inputs) maxR = Math.max(maxR, getRank(i, new Set(visited)));
    ranks.set(id, maxR + 1);
    return maxR + 1;
  };
  graph.nodes.forEach(node => getRank(node.id));

  // 2. Group by Rank
  const layers: RecipeNode[][] = [];
  graph.nodes.forEach(node => {
      const r = ranks.get(node.id) || 0;
      if (!layers[r]) layers[r] = [];
      layers[r].push(node);
  });

  const nodes: VisualNode[] = [];
  const edges: VisualEdge[] = [];
  
  // We track positions in a map for edge generation later
  // But wait, if we shift, we should update this map or rebuild it.
  // Let's generate edges AFTER shift, just like Swimlane mode.
  
  let currentY = PADDING_TOP;
  const GAP_LAYER = 120;
  const GAP_ITEM = 40;
  
  let maxWidth = 0;

  layers.forEach((layerNodes, layerIndex) => {
      // Sort nodes in layer
      layerNodes.sort((a, b) => a.laneId.localeCompare(b.laneId));

      const layerHeight = Math.max(...layerNodes.map(n => n.type === 'ingredient' ? INGREDIENT_HEIGHT_BASE : NODE_HEIGHT));
      
      let currentX = PADDING_LEFT;
      
      const layerPositions: any[] = [];
      
      layerNodes.forEach(node => {
          const isIng = node.type === 'ingredient';
          const w = isIng ? INGREDIENT_WIDTH_BASE : ACTION_WIDTH;
          const h = isIng ? INGREDIENT_HEIGHT_BASE : NODE_HEIGHT;
          
          layerPositions.push({ node, width: w, height: h });
      });

      const totalLayerWidth = layerPositions.reduce((acc, curr) => acc + curr.width, 0) + (layerPositions.length - 1) * GAP_ITEM;
      maxWidth = Math.max(maxWidth, totalLayerWidth);
      
      layerPositions.forEach(pos => {
          const x = currentX;
          const y = currentY;
          
          nodes.push({
              id: pos.node.id,
              type: pos.node.type,
              x, 
              y, 
              width: pos.width, 
              height: pos.height, 
              data: pos.node
          });
          
          currentX += pos.width + GAP_ITEM;
      });
      
      currentY += layerHeight + GAP_LAYER;
  });
  
  // Shift/Bounds Check (Standardized)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  nodes.forEach(n => {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x + n.width);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y + n.height);
  });
  
  // Normalize
  const shiftX = PADDING_LEFT - minX;
  const shiftY = PADDING_TOP - minY;
  
  // Only shift if needed (or always to align to padding)
  if (minX !== Infinity) {
      nodes.forEach(n => {
          n.x += shiftX;
          n.y += shiftY;
      });
  }

  const layoutWidth = maxX - minX + PADDING_LEFT * 2;
  const layoutHeight = maxY - minY + PADDING_TOP * 2;

  // Edges (Regenerate from shifted nodes)
  const visualNodeMap = new Map<string, VisualNode>();
  nodes.forEach(n => visualNodeMap.set(n.id, n));

  graph.nodes.forEach(node => {
      if (node.inputs) {
          node.inputs.forEach(inputId => {
              const s = visualNodeMap.get(inputId);
              const t = visualNodeMap.get(node.id);
              if (s && t) {
                  const sx = s.x + s.width/2;
                  const sy = s.y + s.height; // Bottom
                  const tx = t.x + t.width/2;
                  const ty = t.y; // Top
                  const path = `M ${sx} ${sy} C ${sx} ${(sy+ty)/2}, ${tx} ${(sy+ty)/2}, ${tx} ${ty}`;
                  edges.push({ id: `${inputId}->${node.id}`, sourceId: inputId, targetId: node.id, path });
              }
          });
      }
  });

  return {
      nodes,
      edges,
      lanes: [], // No visual lanes in this mode
      width: Math.max(layoutWidth, 800),
      height: layoutHeight
  };
};