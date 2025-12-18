import type { RecipeGraph, LayoutGraph, VisualNode, VisualEdge, VisualLane, RecipeNode } from './types';

const LANE_WIDTH = 260;
const NODE_WIDTH = 220;
const PADDING_TOP = 60;
const PADDING_LEFT = 40;
const GAP_Y = 40;
const INGREDIENT_HEIGHT = 50;
const ACTION_HEIGHT = 100;

const LANE_COLORS = {
  prep: '#EFF6FF', // Blue-50
  cook: '#FFF7ED', // Orange-50
  serve: '#F0FDF4', // Green-50
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
    height: 0, // Updated later
    color: LANE_COLORS[lane.type] || LANE_COLORS.default
  }));

  // 2. Index Nodes
  const nodeMap = new Map<string, RecipeNode>();
  graph.nodes.forEach(node => nodeMap.set(node.id, node));

  // 3. Topological Sort / Ranking
  const ranks = new Map<string, number>();
  const getRank = (id: string, visited = new Set<string>()): number => {
    if (visited.has(id)) return 0; // Cycle detected
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

  // 4. Calculate Positions
  // Sort nodes by Rank (Dependencies first), then by Lane Order, then ID
  const sortedNodes = [...graph.nodes].sort((a, b) => {
    const rA = ranks.get(a.id) || 0;
    const rB = ranks.get(b.id) || 0;
    if (rA !== rB) return rA - rB;
    
    const lA = laneMap.get(a.laneId) || 0;
    const lB = laneMap.get(b.laneId) || 0;
    if (lA !== lB) return lA - lB;
    
    return a.id.localeCompare(b.id);
  });

  const nodePosMap = new Map<string, { x: number, y: number, width: number, height: number }>();
  const laneYCursors = new Array(graph.lanes.length).fill(PADDING_TOP);

  sortedNodes.forEach(node => {
    const laneIdx = laneMap.get(node.laneId) || 0;
    const width = NODE_WIDTH;
    const height = node.type === 'ingredient' ? INGREDIENT_HEIGHT : ACTION_HEIGHT;
    
    // Y Constraint 1: Must be below all inputs
    let minDepY = 0;
    if (node.inputs) {
        node.inputs.forEach(inputId => {
            const inputPos = nodePosMap.get(inputId);
            if (inputPos) {
                minDepY = Math.max(minDepY, inputPos.y + inputPos.height + GAP_Y);
            }
        });
    }

    // Y Constraint 2: Must be below current lane content
    const currentLaneY = laneYCursors[laneIdx];
    
    const y = Math.max(minDepY, currentLaneY);
    const x = PADDING_LEFT + laneIdx * LANE_WIDTH + (LANE_WIDTH - width) / 2;

    nodePosMap.set(node.id, { x, y, width, height });
    laneYCursors[laneIdx] = y + height + GAP_Y;

    nodes.push({
      id: node.id,
      type: node.type,
      x,
      y,
      width,
      height,
      data: node
    });
  });

  // 5. Calculate Edges
  graph.nodes.forEach(node => {
    if (node.inputs) {
      node.inputs.forEach(inputId => {
        const source = nodePosMap.get(inputId);
        const target = nodePosMap.get(node.id);
        
        if (source && target) {
          const startX = source.x + source.width / 2;
          const startY = source.y + source.height;
          const endX = target.x + target.width / 2;
          const endY = target.y;
          
          const midY = (startY + endY) / 2;
          // Simple Bezier
          const path = `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
          
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

  // 6. Final Layout Dimensions
  const layoutHeight = Math.max(...laneYCursors, 600) + PADDING_TOP;
  const layoutWidth = PADDING_LEFT + graph.lanes.length * LANE_WIDTH + PADDING_LEFT;
  
  visualLanes.forEach(l => l.height = layoutHeight);

  return {
    nodes,
    edges,
    lanes: visualLanes,
    width: layoutWidth,
    height: layoutHeight
  };
};
