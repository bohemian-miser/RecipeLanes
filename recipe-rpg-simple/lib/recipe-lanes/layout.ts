import type { RecipeGraph, LayoutGraph, VisualNode, VisualEdge, VisualLane, RecipeNode } from './types';

export type LayoutMode = 'swimlanes' | 'compact' | 'waterfall' | 'centered' | 'horizontal';

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
  },
  waterfall: {
    NODE_WIDTH: 140,
    NODE_HEIGHT_ING: 40,
    NODE_HEIGHT_ACT: 80,
    GAP_X: 20,
    GAP_Y: 40,
    PADDING: 20
  },
  horizontal: {
    LANE_HEIGHT: 150,
    NODE_HEIGHT: 100, // Fixed height for horizontal
    NODE_WIDTH_ING: 120,
    NODE_WIDTH_ACT: 180,
    GAP_X: 40,
    PADDING: 40
  }
};

const LANE_COLORS = {
  prep: '#EFF6FF', // Blue-50
  cook: '#FFF7ED', // Orange-50
  serve: '#F0FDF4', // Green-50
  default: '#FAFAFA'
};

export const calculateLayout = (graph: RecipeGraph, mode: LayoutMode = 'compact'): LayoutGraph => {
  switch (mode) {
    case 'waterfall':
      return calculateWaterfallLayout(graph, false);
    case 'centered':
      return calculateWaterfallLayout(graph, true);
    case 'horizontal':
      return calculateHorizontalLayout(graph);
    default:
      return calculateSwimlaneLayout(graph, mode === 'swimlanes' ? 'standard' : 'compact');
  }
};

// --- SWIMLANE / COMPACT ALGORITHM ---
const calculateSwimlaneLayout = (graph: RecipeGraph, mode: 'standard' | 'compact'): LayoutGraph => {
  const C = CONSTANTS[mode];
  const nodes: VisualNode[] = [];
  const edges: VisualEdge[] = [];
  
  if (!graph.lanes.length) return emptyGraph();

  const laneMap = new Map<string, number>();
  graph.lanes.forEach((lane, idx) => laneMap.set(lane.id, idx));

  const visualLanes: VisualLane[] = graph.lanes.map((lane, idx) => ({
    id: lane.id,
    label: lane.label,
    x: C.PADDING_LEFT + idx * C.LANE_WIDTH,
    y: 0,
    width: C.LANE_WIDTH,
    height: 0,
    color: LANE_COLORS[lane.type] || LANE_COLORS.default
  }));

  const { ranks, consumerMap } = analyzeGraph(graph);

  // Sort nodes
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
    
    let minDepY = 0;
    if (node.inputs) {
        node.inputs.forEach(inputId => {
            const inputPos = nodePosMap.get(inputId);
            if (inputPos) {
                minDepY = Math.max(minDepY, inputPos.y + inputPos.height + C.GAP_Y);
            }
        });
    }

    const currentLaneY = laneYCursors[laneIdx];
    const y = Math.max(minDepY, currentLaneY);
    const laneX = C.PADDING_LEFT + laneIdx * C.LANE_WIDTH;
    const x = laneX + (C.LANE_WIDTH - width) / 2;

    nodePosMap.set(node.id, { x, y, width, height });
    laneYCursors[laneIdx] = y + height + C.GAP_Y;

    nodes.push({ id: node.id, type: node.type, x, y, width, height, data: node });
  });

  generateEdges(graph, nodes, nodePosMap, edges, 'vertical');
  
  const layoutHeight = Math.max(...laneYCursors, 600) + C.PADDING_TOP;
  const layoutWidth = C.PADDING_LEFT + graph.lanes.length * C.LANE_WIDTH + C.PADDING_LEFT;
  visualLanes.forEach(l => l.height = layoutHeight);

  return { nodes, edges, lanes: visualLanes, width: layoutWidth, height: layoutHeight };
};

// --- WATERFALL / CENTERED ALGORITHM ---
const calculateWaterfallLayout = (graph: RecipeGraph, centered: boolean): LayoutGraph => {
  const C = CONSTANTS.waterfall;
  const nodes: VisualNode[] = [];
  const edges: VisualEdge[] = [];
  
  if (!graph.lanes.length) return emptyGraph();

  const { ranks } = analyzeGraph(graph);
  
  // Group by Rank
  const rankGroups = new Map<number, RecipeNode[]>();
  let maxRank = 0;
  graph.nodes.forEach(node => {
      const r = ranks.get(node.id) || 0;
      if (!rankGroups.has(r)) rankGroups.set(r, []);
      rankGroups.get(r)!.push(node);
      if (r > maxRank) maxRank = r;
  });

  const nodePosMap = new Map<string, { x: number, y: number, width: number, height: number }>();
  let currentY = C.PADDING;
  let layoutWidth = 800;

  // Track widths for centering
  const rowWidths: number[] = [];

  // First pass: Calculate Row Widths
  for (let r = 0; r <= maxRank; r++) {
      const rowNodes = rankGroups.get(r) || [];
      let w = C.PADDING;
      rowNodes.forEach(node => {
          w += C.NODE_WIDTH + C.GAP_X;
      });
      rowWidths[r] = w;
      layoutWidth = Math.max(layoutWidth, w);
  }

  // Second pass: Place
  for (let r = 0; r <= maxRank; r++) {
      const rowNodes = rankGroups.get(r) || [];
      // Sort by lane to cluster related items
      rowNodes.sort((a, b) => a.laneId.localeCompare(b.laneId));

      let maxHeightInRow = 0;
      let startX = C.PADDING;

      if (centered) {
          const rowW = rowWidths[r];
          startX = (layoutWidth - rowW) / 2 + C.PADDING; 
      }

      let currentX = startX;

      rowNodes.forEach(node => {
          const width = C.NODE_WIDTH;
          const height = node.type === 'ingredient' ? C.NODE_HEIGHT_ING : C.NODE_HEIGHT_ACT;
          
          const x = currentX;
          const y = currentY;

          nodePosMap.set(node.id, { x, y, width, height });
          nodes.push({ id: node.id, type: node.type, x, y, width, height, data: node });

          currentX += width + C.GAP_X;
          maxHeightInRow = Math.max(maxHeightInRow, height);
      });

      currentY += maxHeightInRow + C.GAP_Y;
  }

  generateEdges(graph, nodes, nodePosMap, edges, 'vertical');

  return {
      nodes,
      edges,
      lanes: [], 
      width: layoutWidth + C.PADDING,
      height: currentY + C.PADDING
  };
};

// --- HORIZONTAL ALGORITHM ---
const calculateHorizontalLayout = (graph: RecipeGraph): LayoutGraph => {
  const C = CONSTANTS.horizontal;
  const nodes: VisualNode[] = [];
  const edges: VisualEdge[] = [];
  
  if (!graph.lanes.length) return emptyGraph();

  // Lanes are Rows
  const laneMap = new Map<string, number>();
  graph.lanes.forEach((lane, idx) => laneMap.set(lane.id, idx));

  const visualLanes: VisualLane[] = graph.lanes.map((lane, idx) => ({
    id: lane.id,
    label: lane.label,
    x: 0,
    y: C.PADDING + idx * C.LANE_HEIGHT,
    width: 0, // Updated later
    height: C.LANE_HEIGHT,
    color: LANE_COLORS[lane.type] || LANE_COLORS.default
  }));

  const { ranks, consumerMap } = analyzeGraph(graph);

  // Sort nodes
  const sortedNodes = [...graph.nodes].sort((a, b) => {
    const rA = ranks.get(a.id) || 0;
    const rB = ranks.get(b.id) || 0;
    if (rA !== rB) return rA - rB;
    return a.id.localeCompare(b.id);
  });

  const nodePosMap = new Map<string, { x: number, y: number, width: number, height: number }>();
  const laneXCursors = new Array(graph.lanes.length).fill(C.PADDING);

  sortedNodes.forEach(node => {
    const laneIdx = laneMap.get(node.laneId) || 0;
    const width = node.type === 'ingredient' ? C.NODE_WIDTH_ING : C.NODE_WIDTH_ACT;
    const height = C.NODE_HEIGHT;
    
    // X Constraint: Must be to the right of all inputs
    let minDepX = 0;
    if (node.inputs) {
        node.inputs.forEach(inputId => {
            const inputPos = nodePosMap.get(inputId);
            if (inputPos) {
                minDepX = Math.max(minDepX, inputPos.x + inputPos.width + C.GAP_X);
            }
        });
    }

    // X Constraint: Must be to the right of current lane content
    const currentLaneX = laneXCursors[laneIdx];
    
    const x = Math.max(minDepX, currentLaneX);
    const laneY = C.PADDING + laneIdx * C.LANE_HEIGHT;
    const y = laneY + (C.LANE_HEIGHT - height) / 2;

    nodePosMap.set(node.id, { x, y, width, height });
    laneXCursors[laneIdx] = x + width + C.GAP_X;

    nodes.push({ id: node.id, type: node.type, x, y, width, height, data: node });
  });

  generateEdges(graph, nodes, nodePosMap, edges, 'horizontal');
  
  const layoutWidth = Math.max(...laneXCursors, 800) + C.PADDING;
  const layoutHeight = C.PADDING + graph.lanes.length * C.LANE_HEIGHT + C.PADDING;
  visualLanes.forEach(l => l.width = layoutWidth);

  return { nodes, edges, lanes: visualLanes, width: layoutWidth, height: layoutHeight };
};


// --- HELPERS ---

function analyzeGraph(graph: RecipeGraph) {
  const nodeMap = new Map<string, RecipeNode>();
  const consumerMap = new Map<string, string[]>();

  graph.nodes.forEach(node => {
      nodeMap.set(node.id, node);
      if (node.inputs) {
          node.inputs.forEach(inputId => {
              if (!consumerMap.has(inputId)) consumerMap.set(inputId, []);
              consumerMap.get(inputId)!.push(node.id);
          });
      }
  });

  const ranks = new Map<string, number>();
  
  const getActionRank = (id: string, visited = new Set<string>()): number => {
    if (visited.has(id)) return 0;
    if (ranks.has(id)) return ranks.get(id)!;
    visited.add(id);
    const node = nodeMap.get(id);
    if (node?.type === 'ingredient') return 0;

    let maxInputRank = -1;
    if (node?.inputs) {
        for (const inputId of node.inputs) {
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

  graph.nodes.filter(n => n.type === 'action').forEach(n => getActionRank(n.id));

  graph.nodes.filter(n => n.type === 'ingredient').forEach(ing => {
      const consumers = consumerMap.get(ing.id) || [];
      if (consumers.length === 0) {
          ranks.set(ing.id, 0);
      } else {
          let minConsumerRank = Infinity;
          let hasRankedConsumer = false;
          consumers.forEach(cId => {
              const r = ranks.get(cId);
              if (r !== undefined) {
                 if (r < minConsumerRank) minConsumerRank = r;
                 hasRankedConsumer = true;
              }
          });
          ranks.set(ing.id, hasRankedConsumer ? Math.max(0, minConsumerRank) : 0); 
      }
  });

  return { nodeMap, ranks, consumerMap };
}

function generateEdges(graph: RecipeGraph, nodes: VisualNode[], nodePosMap: Map<string, any>, edges: VisualEdge[], direction: 'vertical' | 'horizontal') {
    graph.nodes.forEach(node => {
        if (node.inputs) {
          node.inputs.forEach(inputId => {
            const source = nodePosMap.get(inputId);
            const target = nodePosMap.get(node.id);
            
            if (source && target) {
              let path = '';
              if (direction === 'vertical') {
                  const startX = source.x + source.width / 2;
                  const startY = source.y + source.height;
                  const endX = target.x + target.width / 2;
                  const endY = target.y;
                  const midY = (startY + endY) / 2;
                  path = `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
              } else {
                  // Horizontal
                  const startX = source.x + source.width;
                  const startY = source.y + source.height / 2;
                  const endX = target.x;
                  const endY = target.y + target.height / 2;
                  const midX = (startX + endX) / 2;
                  path = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
              }
              
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
}

function emptyGraph(): LayoutGraph {
    return { nodes: [], edges: [], lanes: [], width: 800, height: 600 };
}
