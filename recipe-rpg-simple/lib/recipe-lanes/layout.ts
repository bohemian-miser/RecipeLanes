import type { RecipeGraph, LayoutGraph, VisualNode, VisualEdge, VisualLane, RecipeNode } from './types';

const LANE_WIDTH = 400; // Wider lanes
const ACTION_WIDTH = 140; // Focused on Icon width
const INGREDIENT_WIDTH = 100;
const PADDING_TOP = 80;
const PADDING_LEFT = 40;
const GAP_Y = 80; // More vertical breathing room
const GAP_X = 40; // Wider gap between Action and Ingredient
const NODE_HEIGHT = 160; // Taller for Icon + Text stack
const INGREDIENT_HEIGHT = 120;

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
    height: 0, 
    color: LANE_COLORS[lane.type] || LANE_COLORS.default
  }));

  // 2. Index Nodes & Helper Maps
  const nodeMap = new Map<string, RecipeNode>();
  const nodesByLane = new Map<string, RecipeNode[]>();
  
  graph.nodes.forEach(node => {
      nodeMap.set(node.id, node);
      if (!nodesByLane.has(node.laneId)) nodesByLane.set(node.laneId, []);
      nodesByLane.get(node.laneId)!.push(node);
  });

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

  // 4. Layout Logic per Lane
  const nodePosMap = new Map<string, { x: number, y: number, width: number, height: number }>();
  const laneYCursors = new Array(graph.lanes.length).fill(PADDING_TOP);

  // We process lanes in order. 
  // But strictly, we should process nodes in Rank order across ALL lanes to respect dependencies.
  // HOWEVER, the request is to "Split each lane... ingredients with their step".
  // This implies a structured layout within the lane:
  // [Action 1] <--- [Ingredient A]
  //    |
  //    v
  // [Action 2] <--- [Ingredient B]
  
  // So, for each lane, we want to identify the "Spine" (Actions) and "Side Inputs" (Ingredients).
  
  // Let's sort all nodes by Rank first.
  const sortedNodes = [...graph.nodes].sort((a, b) => {
    const rA = ranks.get(a.id) || 0;
    const rB = ranks.get(b.id) || 0;
    if (rA !== rB) return rA - rB;
    return a.id.localeCompare(b.id);
  });

  // We need to place nodes.
  // If a node is an "Ingredient" (type='ingredient'), we try to defer its placement 
  // until its consumer (Action) is placed, so we can align it.
  
  const placedNodes = new Set<string>();

  // Helper to place a node
  const placeNode = (node: RecipeNode, laneIdx: number, preferredY?: number, ignoreCursor?: boolean) => {
      if (placedNodes.has(node.id)) return nodePosMap.get(node.id)!;

      const isIngredient = node.type === 'ingredient';
      const width = isIngredient ? INGREDIENT_WIDTH : ACTION_WIDTH;
      const height = isIngredient ? INGREDIENT_HEIGHT : NODE_HEIGHT;
      
      let relativeX = 20; 
      if (isIngredient) {
          relativeX = 20 + ACTION_WIDTH + GAP_X; 
      }

      const laneX = PADDING_LEFT + laneIdx * LANE_WIDTH;
      const x = laneX + relativeX;

      let minDepY = 0;
      if (node.inputs) {
          node.inputs.forEach(inputId => {
             const inputPos = nodePosMap.get(inputId);
             if (inputPos) {
                 minDepY = Math.max(minDepY, inputPos.y + inputPos.height + GAP_Y);
             }
          });
      }

      // Determine Y
      let y = minDepY;
      if (!ignoreCursor) {
          y = Math.max(y, laneYCursors[laneIdx]);
      }
      
      if (preferredY !== undefined) {
          y = Math.max(y, preferredY);
      }

      nodePosMap.set(node.id, { x, y, width, height });
      
      // Update Cursor
      // If we placed an ingredient "alongside", it consumes vertical space.
      // We should ensure the cursor reflects the bottom of this element if it exceeds current cursor.
      const bottomY = y + height + GAP_Y;
      laneYCursors[laneIdx] = Math.max(laneYCursors[laneIdx], bottomY);
      
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

  // Main Loop
  sortedNodes.forEach(node => {
      if (placedNodes.has(node.id)) return;

      const laneIdx = laneMap.get(node.laneId) || 0;
      
      if (node.type === 'ingredient') {
          return;
      }

      const actionPos = placeNode(node, laneIdx);
      
      if (node.inputs) {
          // Align ingredients with the Action's top (or center?)
          // Action is tall (160), Ingredient is 120.
          // Center align: ActionY + (ActionH - IngH)/2
          const centerOffsetY = (actionPos.height - INGREDIENT_HEIGHT) / 2;
          let ingredientStackY = actionPos.y + centerOffsetY;
          
          node.inputs.forEach(inputId => {
              const inputNode = nodeMap.get(inputId);
              if (inputNode && inputNode.type === 'ingredient' && !placedNodes.has(inputId)) {
                  const targetLaneIdx = laneMap.get(inputNode.laneId) || 0;
                  
                  if (targetLaneIdx === laneIdx) {
                      const ingPos = placeNode(inputNode, laneIdx, ingredientStackY, true); // Ignore cursor to allow parallel placement
                      ingredientStackY += ingPos.height + 10; 
                  } else {
                      placeNode(inputNode, targetLaneIdx);
                  }
              }
          });
      }
  });

  // Cleanup: Place any remaining ingredients (orphans)
  sortedNodes.forEach(node => {
      if (!placedNodes.has(node.id)) {
          const laneIdx = laneMap.get(node.laneId) || 0;
          placeNode(node, laneIdx);
      }
  });

  // 5. Calculate Edges
  graph.nodes.forEach(node => {
    if (node.inputs) {
      node.inputs.forEach(inputId => {
        const source = nodePosMap.get(inputId);
        const target = nodePosMap.get(node.id);
        
        if (source && target) {
          // If in same lane:
          // Action -> Action: Top-down arrow.
          // Ingredient -> Action: Side-to-Side arrow?
          const isSameLane = Math.abs(source.x - target.x) < LANE_WIDTH;
          const isIngredientSource = source.width === INGREDIENT_WIDTH; // Heuristic
          
          let startX, startY, endX, endY;

          if (isSameLane && isIngredientSource) {
              // Right-to-Left (Ingredient to Action) or Left-to-Right?
              // Action is at 20 (Left), Ingredient at 220 (Right).
              // So Ingredient -> Action is Right to Left.
              startX = source.x; // Left edge of ingredient
              startY = source.y + source.height / 2;
              endX = target.x + target.width; // Right edge of action
              endY = target.y + target.height / 2;
              
              // Straight horizontal line if aligned?
              // Or simple curve.
          } else {
              // Standard Top-Down
              startX = source.x + source.width / 2;
              startY = source.y + source.height;
              endX = target.x + target.width / 2;
              endY = target.y;
          }
          
          const midY = (startY + endY) / 2;
          const midX = (startX + endX) / 2;
          
          let path = '';
          if (isSameLane && isIngredientSource) {
             // S-curve horizontal
             path = `M ${startX} ${startY} C ${startX - 50} ${startY}, ${endX + 50} ${endY}, ${endX} ${endY}`;
          } else {
             // Vertical elbow
             path = `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
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