import type { RecipeGraph, LayoutGraph, VisualNode, VisualEdge, Step, Ingredient } from '../types';

// Constants for Top-Down Layout
const LANE_WIDTH = 260; // Column width
const NODE_WIDTH = 220;
const NODE_HEIGHT = 100;
const INGREDIENT_HEIGHT = 40;
const PADDING_TOP = 40;
const PADDING_LEFT = 40;
const GAP_Y = 40; // Vertical gap between steps

// Color Palette for Lanes
const LANE_COLORS: { [key: string]: string } = {
  bench: '#F3F4F6', // Cool Gray
  stove: '#FFF7ED', // Warm Orange
  oven: '#FEF2F2', // Soft Red
  fridge: '#EFF6FF', // Ice Blue
  default: '#FAFAFA',
};

export const calculateLayout = (graph: RecipeGraph): LayoutGraph => {
  const nodes: VisualNode[] = [];
  const edges: VisualEdge[] = [];
  
  if (!graph || !graph.lanes || !graph.steps) {
      return { nodes: [], edges: [], width: 800, height: 600, lanes: [] };
  }
  
  // 1. Assign Lane Indices
  const laneMap = new Map<string, number>();
  graph.lanes.forEach((lane, index) => laneMap.set(lane, index));

  // 2. Topological Sort (Ranks) - Used to order processing
  const ranks = new Map<string, number>();
  const idToStep = new Map<string, Step>();
  const idToIngredient = new Map<string, Ingredient>();

  graph.steps.forEach(s => idToStep.set(s.id, s));
  graph.ingredients.forEach(i => idToIngredient.set(i.id, i));

  // Recursive function to find rank
  const getRank = (id: string, visited = new Set<string>()): number => {
    if (visited.has(id)) return 0;
    if (ranks.has(id)) return ranks.get(id)!;
    
    visited.add(id);

    if (idToIngredient.has(id)) {
      ranks.set(id, 0);
      return 0;
    }

    const step = idToStep.get(id);
    if (!step) return 0;

    let maxDepRank = -1;
    if (!step.dependencies || step.dependencies.length === 0) {
      maxDepRank = -1;
    } else {
      step.dependencies.forEach(depId => {
        if (idToStep.has(depId) || idToIngredient.has(depId)) {
            const r = getRank(depId, new Set(visited));
            if (r > maxDepRank) maxDepRank = r;
        }
      });
    }

    const rank = maxDepRank + 1;
    ranks.set(id, rank);
    return rank;
  };

  graph.steps.forEach(step => getRank(step.id));

  // 3. Place Nodes (Top-Down Logic)
  // We process nodes by Rank (low to high) to ensure dependencies are placed first.
  const allIds = [...graph.ingredients.map(i => i.id), ...graph.steps.map(s => s.id)];
  
  // Sort by Rank, then by ID to be deterministic
  allIds.sort((a, b) => {
    const rA = ranks.get(a) || 0;
    const rB = ranks.get(b) || 0;
    if (rA !== rB) return rA - rB;
    return a.localeCompare(b);
  });

  const nodePositions = new Map<string, { x: number, y: number, width: number, height: number }>();
  const laneYCursors = new Array(graph.lanes.length).fill(PADDING_TOP);

  allIds.forEach(id => {
    const isStep = idToStep.has(id);
    const isIng = idToIngredient.has(id);
    
    let laneIdx = 0;
    let height = NODE_HEIGHT;
    let data: any = null;

    if (isStep) {
      const step = idToStep.get(id)!;
      laneIdx = laneMap.get(step.resource) || 0;
      data = step;
    } else if (isIng) {
      const ing = idToIngredient.get(id)!;
      height = INGREDIENT_HEIGHT;
      data = ing;
      // Find lane of first consumer
      let foundLane = false;
      // Heuristic: Place ingredient in the lane of its first user
      // Or just in the first lane if unused.
       for (const step of graph.steps) {
         if (step.dependencies && step.dependencies.includes(ing.id)) {
            laneIdx = laneMap.get(step.resource) || 0;
            foundLane = true;
            break;
         }
       }
       if (!foundLane) laneIdx = 0;
    } else {
        return; // Unknown ID
    }

    // Calculate Y
    // Constraint 1: Must be below all dependencies
    let minYFromDeps = 0;
    if (isStep) {
        const step = idToStep.get(id)!;
        step.dependencies?.forEach(depId => {
            const depPos = nodePositions.get(depId);
            if (depPos) {
                minYFromDeps = Math.max(minYFromDeps, depPos.y + depPos.height + GAP_Y);
            }
        });
    }

    // Constraint 2: Must be below current content in this lane
    const minYFromLane = laneYCursors[laneIdx];

    const y = Math.max(minYFromDeps, minYFromLane);
    
    // Center in lane
    const x = PADDING_LEFT + laneIdx * LANE_WIDTH + (LANE_WIDTH - NODE_WIDTH) / 2;

    // Store
    nodePositions.set(id, { x, y, width: NODE_WIDTH, height });
    laneYCursors[laneIdx] = y + height + GAP_Y;

    nodes.push({
      id,
      type: isStep ? 'step' : 'ingredient',
      x,
      y,
      width: NODE_WIDTH,
      height,
      laneIndex: laneIdx,
      data
    });
  });

  // 4. Generate Edges
  graph.steps.forEach(step => {
    if (step.dependencies) {
        step.dependencies.forEach(depId => {
        const source = nodePositions.get(depId);
        const target = nodePositions.get(step.id);

        if (source && target) {
            // Route Edge: Top-Down
            // Start: Bottom Center of source
            const startX = source.x + source.width / 2;
            const startY = source.y + source.height;
            
            // End: Top Center of target
            const endX = target.x + target.width / 2;
            const endY = target.y;

            // Elbow curve
            const midY = (startY + endY) / 2;
            
            const path = `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;

            edges.push({
            id: `${depId}-${step.id}`,
            sourceId: depId,
            targetId: step.id,
            path
            });
        }
        });
    }
  });

  // 5. Build Layout Graph
  const layoutHeight = Math.max(...laneYCursors, 600) + PADDING_TOP;
  const layoutWidth = PADDING_LEFT + graph.lanes.length * LANE_WIDTH + PADDING_LEFT;

  const visualLanes = graph.lanes.map((name, i) => ({
    name,
    y: 0, // Not used for drawing rects in the same way, but x is index * WIDTH
    height: layoutHeight, // Full height
    color: LANE_COLORS[name.toLowerCase()] || LANE_COLORS['default']
  }));

  return {
    nodes,
    edges,
    width: Math.max(layoutWidth, 800),
    height: layoutHeight,
    lanes: visualLanes
  };
};
