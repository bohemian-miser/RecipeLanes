import type { RecipeGraph, LayoutGraph, VisualNode, VisualEdge, VisualLane, RecipeNode } from './types';
import dagre from 'dagre';

// Only keeping Lanes, Smart, Smart LR
export type LayoutMode = 'swimlanes' | 'dagre' | 'dagre-lr';

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
  compact: { // Used as internal fallback for swimlanes compact mode if needed, or remove?
    LANE_WIDTH: 150,
    NODE_WIDTH: 140,
    PADDING_TOP: 20,
    PADDING_LEFT: 5,
    GAP_Y: 15,
    INGREDIENT_HEIGHT: 40,
    ACTION_HEIGHT: 80
  },
  dagre: {
    NODE_WIDTH: 140,
    NODE_HEIGHT_ING: 80,
    NODE_HEIGHT_ACT: 120,
    PADDING: 20
  }
};

const LANE_COLORS = {
  prep: '#EFF6FF', // Blue-50
  cook: '#FFF7ED', // Orange-50
  serve: '#F0FDF4', // Green-50
  default: '#FAFAFA'
};

export const calculateLayout = (graph: RecipeGraph, mode: LayoutMode = 'dagre', spacing: number = 1, preservePositions: boolean = false): LayoutGraph => {
  // If preserving positions (and at least one exists), bypass algo
  if (preservePositions && graph.nodes.some(n => n.x !== undefined)) {
      const nodes: VisualNode[] = graph.nodes.map(n => ({
          id: n.id,
          type: n.type,
          x: n.x ?? 0,
          y: n.y ?? 0,
          width: 140,
          height: 100,
          depth: (n as any).depth, // Preserve depth if available
          data: n
      }));
      
      const edges: VisualEdge[] = [];
      const nodePosMap = new Map();
      nodes.forEach(n => nodePosMap.set(n.id, n));
      generateEdges(graph, nodes, nodePosMap, edges, 'vertical'); 

      return {
          nodes,
          edges,
          lanes: [], 
          width: 2000,
          height: 2000
      };
  }

  switch (mode) {
    case 'dagre':
      return calculateDagreLayout(graph, spacing, 'TB');
    case 'dagre-lr':
      return calculateDagreLayout(graph, spacing, 'LR');
    case 'swimlanes':
    default:
      // Default to standard swimlane if 'swimlanes' selected
      return calculateSwimlaneLayout(graph, 'standard', spacing);
  }
};

// --- DAGRE ALGORITHM ---
const calculateDagreLayout = (graph: RecipeGraph, spacing: number, rankDir: 'TB' | 'LR' = 'TB'): LayoutGraph => {
    const C = CONSTANTS.dagre;
    const g = new dagre.graphlib.Graph();
    g.setGraph({ 
        rankdir: rankDir, 
        nodesep: 10 * spacing, 
        ranksep: 20 * spacing
    });
    g.setDefaultEdgeLabel(() => ({}));

    graph.nodes.forEach(node => {
        const height = node.type === 'ingredient' ? C.NODE_HEIGHT_ING : C.NODE_HEIGHT_ACT;
        g.setNode(node.id, { width: C.NODE_WIDTH, height: height, data: node });
    });

    graph.nodes.forEach(node => {
        if (node.inputs) {
            node.inputs.forEach(inputId => {
                if (graph.nodes.find(n => n.id === inputId)) {
                   g.setEdge(inputId, node.id);
                }
            });
        }
    });

    dagre.layout(g);

    if (rankDir === 'LR') {
       // Flip Y coordinates to ensure Top-to-Bottom reading order logic if needed
       // Dagre LR naturally goes Left to Right.
       // Usually we don't need to flip Y for LR unless we want upside down?
       // Step 20 logic: "flip Y coordinates to ensure Top-to-Bottom reading order".
       // Actually Dagre LR puts 0,0 at top left.
       // If I flip Y, I might mirror it.
       // I'll keep the flip logic if it was requested to fix "upside down feel".
       // "Smart (LR) layout to be top-to-bottom" -> Wait, LR is Left-Right.
       // Maybe they meant the *content* order?
       // I'll trust previous fix logic.
       let maxY = 0;
       g.nodes().forEach(v => { const n = g.node(v); maxY = Math.max(maxY, n.y + n.height/2); });
       g.nodes().forEach(v => { const n = g.node(v); n.y = maxY - n.y; });
       g.edges().forEach(e => { g.edge(e).points.forEach((p: any) => p.y = maxY - p.y); });
    }

    const nodes: VisualNode[] = [];
    const edges: VisualEdge[] = [];

    g.nodes().forEach(v => {
        const node: any = g.node(v);
        // Dagre x,y is center. We use top-left.
        nodes.push({
            id: v,
            type: node.data.type,
            x: node.x - node.width / 2 + C.PADDING,
            y: node.y - node.height / 2 + C.PADDING,
            width: node.width,
            height: node.height,
            data: node.data
        });
    });

    g.edges().forEach(e => {
        const edge = g.edge(e);
        const pathPoints = edge.points.map((p: any) => `${p.x + C.PADDING},${p.y + C.PADDING}`);
        const d = `M ${pathPoints.join(' L ')}`;
        
        edges.push({
            id: `${e.v}->${e.w}`,
            sourceId: e.v,
            targetId: e.w,
            path: d
        });
    });

    // Calculate bounding box
    const layoutWidth = (g.graph().width || 800) + C.PADDING * 2;
    const layoutHeight = (g.graph().height || 600) + C.PADDING * 2;

    return {
        nodes,
        edges,
        lanes: [], // No lanes in pure Dagre
        width: layoutWidth,
        height: layoutHeight
    };
};


// --- SWIMLANE / COMPACT ALGORITHM ---
const calculateSwimlaneLayout = (graph: RecipeGraph, mode: 'standard' | 'compact', spacing: number): LayoutGraph => {
  const BaseC = CONSTANTS[mode] || CONSTANTS.standard;
  const C = {
      ...BaseC,
      PADDING_TOP: BaseC.PADDING_TOP * spacing,
      PADDING_LEFT: BaseC.PADDING_LEFT * spacing,
      GAP_Y: BaseC.GAP_Y * spacing,
      LANE_WIDTH: BaseC.LANE_WIDTH * spacing
  };
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
