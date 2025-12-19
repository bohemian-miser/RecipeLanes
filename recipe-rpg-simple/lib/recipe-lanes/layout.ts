import type { RecipeGraph, LayoutGraph, VisualNode, VisualEdge, VisualLane, RecipeNode } from './types';

export type LayoutMode = 'standard' | 'compact';

const CONSTANTS = {
  standard: {
    LANE_WIDTH: 220,
    NODE_WIDTH: 200,
    PADDING_TOP: 40,
    PADDING_LEFT: 30,
    GAP_Y: 30,
    INGREDIENT_HEIGHT: 50,
    ACTION_HEIGHT: 100
  },
  compact: {
    LANE_WIDTH: 150,
    NODE_WIDTH: 140,
    PADDING_TOP: 20,
    PADDING_LEFT: 5,
    GAP_Y: 15,
    INGREDIENT_HEIGHT: 40,
    ACTION_HEIGHT: 80
  }
};

const LANE_COLORS = {
  prep: '#EFF6FF', // Blue-50
  cook: '#FFF7ED', // Orange-50
  serve: '#F0FDF4', // Green-50
  default: '#FAFAFA'
};

export const calculateLayout = (graph: RecipeGraph, mode: LayoutMode = 'standard'): LayoutGraph => {
  const C = CONSTANTS[mode];
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
    x: C.PADDING_LEFT + idx * C.LANE_WIDTH,
    width: C.LANE_WIDTH,
    height: 0, // Updated later
    color: LANE_COLORS[lane.type] || LANE_COLORS.default
  }));

  // 2. Index Nodes & Build Dependency Graph
  const nodeMap = new Map<string, RecipeNode>();
  const consumerMap = new Map<string, string[]>(); // id -> consumerIds

  graph.nodes.forEach(node => {
      nodeMap.set(node.id, node);
      if (node.inputs) {
          node.inputs.forEach(inputId => {
              if (!consumerMap.has(inputId)) consumerMap.set(inputId, []);
              consumerMap.get(inputId)!.push(node.id);
          });
      }
  });

  // 3. Topological Sort / Ranking
  const ranks = new Map<string, number>();
  
  // Recursive rank for ACTIONS only first (standard dependencies)
  const getActionRank = (id: string, visited = new Set<string>()): number => {
    if (visited.has(id)) return 0;
    if (ranks.has(id)) return ranks.get(id)!;
    
    visited.add(id);
    const node = nodeMap.get(id);
    // If ingredient, we defer ranking (return 0 placeholder for now)
    if (node?.type === 'ingredient') return 0;

    let maxInputRank = -1;
    if (node?.inputs) {
        for (const inputId of node.inputs) {
            // Only consider dependency on other Actions for base rank
            const inputNode = nodeMap.get(inputId);
            if (inputNode?.type === 'action') {
                const r = getActionRank(inputId, new Set(visited));
                if (r > maxInputRank) maxInputRank = r;
            }
        }
    }
    
    const rank = maxInputRank + 1;
    ranks.set(id, rank);
    return rank;
  };

  // Rank Actions
  graph.nodes.filter(n => n.type === 'action').forEach(n => getActionRank(n.id));

  // Rank Ingredients (Just-In-Time)
  graph.nodes.filter(n => n.type === 'ingredient').forEach(ing => {
      const consumers = consumerMap.get(ing.id) || [];
      if (consumers.length === 0) {
          ranks.set(ing.id, 0); // Unused
      } else {
          // Find earliest consumer rank
          let minConsumerRank = Infinity;
          let hasRankedConsumer = false;
          consumers.forEach(cId => {
              const r = ranks.get(cId);
              if (r !== undefined) {
                 if (r < minConsumerRank) minConsumerRank = r;
                 hasRankedConsumer = true;
              }
          });
          
          ranks.set(ing.id, hasRankedConsumer ? minConsumerRank : 0); 
      }
  });

  // 4. Calculate Positions
  const sortedNodes = [...graph.nodes].sort((a, b) => {
    const rA = ranks.get(a.id) || 0;
    const rB = ranks.get(b.id) || 0;
    if (rA !== rB) return rA - rB;
    if (a.type !== b.type) return a.type === 'ingredient' ? -1 : 1;
    const lA = laneMap.get(a.laneId) || 0;
    const lB = laneMap.get(b.laneId) || 0;
    if (lA !== lB) return lA - lB;
    return a.id.localeCompare(b.id);
  });

  const nodePosMap = new Map<string, { x: number, y: number, width: number, height: number }>();
  const laneYCursors = new Array(graph.lanes.length).fill(C.PADDING_TOP);

  sortedNodes.forEach(node => {
    const laneIdx = laneMap.get(node.laneId) || 0;
    const width = C.NODE_WIDTH;
    const height = node.type === 'ingredient' ? C.INGREDIENT_HEIGHT : C.ACTION_HEIGHT;
    
    // Y Constraint 1: Must be below all inputs
    let minDepY = 0;
    if (node.inputs) {
        node.inputs.forEach(inputId => {
            const inputPos = nodePosMap.get(inputId);
            if (inputPos) {
                minDepY = Math.max(minDepY, inputPos.y + inputPos.height + C.GAP_Y);
            }
        });
    }

    // Y Constraint 2: Must be below current lane content
    const currentLaneY = laneYCursors[laneIdx];
    
    const y = Math.max(minDepY, currentLaneY);
    // Center in lane
    const laneX = C.PADDING_LEFT + laneIdx * C.LANE_WIDTH;
    const x = laneX + (C.LANE_WIDTH - width) / 2;

    nodePosMap.set(node.id, { x, y, width, height });
    laneYCursors[laneIdx] = y + height + C.GAP_Y;

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
  const layoutHeight = Math.max(...laneYCursors, 600) + C.PADDING_TOP;
  const layoutWidth = C.PADDING_LEFT + graph.lanes.length * C.LANE_WIDTH + C.PADDING_LEFT;
  
  visualLanes.forEach(l => l.height = layoutHeight);

  return {
    nodes,
    edges,
    lanes: visualLanes,
    width: layoutWidth,
    height: layoutHeight
  };
};
