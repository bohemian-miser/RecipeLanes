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
  const placeNode = (node: RecipeNode, laneIdx: number, preferredY?: number) => {
      if (placedNodes.has(node.id)) return nodePosMap.get(node.id)!;

      const isIngredient = node.type === 'ingredient';
      const width = isIngredient ? INGREDIENT_WIDTH : ACTION_WIDTH;
      const height = isIngredient ? INGREDIENT_HEIGHT : NODE_HEIGHT;
      
      // Determine Column X
      // Action -> Left (Start of lane + Padding)
      // Ingredient -> Right (Left + ActionWidth + Gap)
      // Wait, user said "bottom ingredient flowing into that step".
      // Usually ingredients are on the side or top.
      // Let's put Actions on the LEFT and Ingredients on the RIGHT of the lane.
      
      let relativeX = 20; // Default Left padding
      if (isIngredient) {
          relativeX = 20 + ACTION_WIDTH + GAP_X; 
      }

      const laneX = PADDING_LEFT + laneIdx * LANE_WIDTH;
      const x = laneX + relativeX;

      // Determine Y
      // If preferredY is given (alignment), try to use it, but respect constraints.
      // Constraints: Must be below inputs (that are NOT the aligned one) and below lane cursor.
      
      let minDepY = 0;
      if (node.inputs) {
          node.inputs.forEach(inputId => {
             // If input is already placed, respect it.
             // But if input is the one pulling us (e.g. we are the ingredient), we ignore it?
             // No, ingredients flow INTO actions. Action is placed AFTER ingredient.
             // Wait, if we want to align Ingredient NEXT TO Action, we need to place Action, determine Y, then place Ingredient at that Y?
             // OR place Ingredient, then Action aligns?
             // Since Dependencies determine Rank: Ingredient Rank < Action Rank.
             // Ingredient is usually placed first.
             // This is the problem. Standard topological sort places Ingredient at top.
             
             // NEW STRATEGY:
             // When processing an Action Node, we check its inputs.
             // If an input is an Ingredient (and hasn't been visually fixed yet?), we move it?
             // No, better: Skip placing Ingredients in the main loop.
             // Only place Actions.
             // When placing an Action, find its unplaced Ingredient inputs and place them NEXT to it.
             
             const inputPos = nodePosMap.get(inputId);
             if (inputPos) {
                 minDepY = Math.max(minDepY, inputPos.y + inputPos.height + GAP_Y);
             }
          });
      }

      // If we are "Side Placing" an ingredient (preferredY provided), we ignore dependency Y from downstream (impossible)
      // But we must respect Lane Cursor.
      
      let y = Math.max(minDepY, laneYCursors[laneIdx]);
      
      if (preferredY !== undefined) {
          y = Math.max(y, preferredY);
      }

      nodePosMap.set(node.id, { x, y, width, height });
      
      // Update Lane Cursor?
      // If Action, advance cursor significantly.
      // If Ingredient (Side), maybe don't advance the main cursor? 
      // Or track separate cursors for Left/Right columns?
      // Let's track one cursor for simplicity, but if Ingredient is side-by-side, it shares Y space.
      
      // If we place Ingredient at Y=100, Action at Y=100.
      // Next available Y should be 100 + Max(H_Ing, H_Act) + GAP.
      
      // However, placeNode is called sequentially.
      // If we place Action, then Ingredient.
      // We need to know "This Y row is occupied".
      
      // Let's simplify:
      // We update laneYCursors[laneIdx] ONLY when placing Actions (Spine).
      // Ingredients just sit there.
      // BUT if we have multiple ingredients, they stack.
      
      if (!isIngredient) {
          laneYCursors[laneIdx] = y + height + GAP_Y;
      }
      
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
      // If already placed (e.g. as a dependency of a previous node? No, we place consumers later), skip.
      if (placedNodes.has(node.id)) return;

      const laneIdx = laneMap.get(node.laneId) || 0;
      
      // Strategy:
      // 1. If it's an Ingredient, SKIP IT for now. We will place it when we encounter its consumer.
      //    (Unless it has no consumer? Then place at end).
      if (node.type === 'ingredient') {
          // Check if it's consumed by something in the same lane?
          // Actually, let's just wait.
          return;
      }

      // 2. It's an Action. Place it.
      // First, ensure all NON-Ingredient inputs are placed (they should be, due to Sort).
      // And ensure Ingredient inputs from OTHER lanes are placed (should be).
      // We only deferred Ingredients in THIS lane (or generic ingredients).

      // Calculate position for Action
      const actionPos = placeNode(node, laneIdx);
      
      // 3. Look for unplaced Ingredient inputs (that belong to this lane or are floating?)
      // User said: "Split each lane... have one side be ingredients".
      // This implies ingredients in this lane.
      
      if (node.inputs) {
          let ingredientStackY = actionPos.y;
          
          node.inputs.forEach(inputId => {
              const inputNode = nodeMap.get(inputId);
              if (inputNode && inputNode.type === 'ingredient' && !placedNodes.has(inputId)) {
                  // It's an unplaced ingredient. Place it NEXT to this action.
                  // Which lane? The ingredient's lane.
                  // If ingredient lane == action lane, perfect.
                  // If not, we probably shouldn't move it visually to this lane?
                  // User said "The ingredients need to be added with their step".
                  // This strongly implies visual proximity.
                  // Let's force place it in the ACTION'S lane (visually) for the "Input" visual,
                  // OR assume the parser put it in the correct lane.
                  // Our parser puts "2 Onions" in Lane 2 (Pan). Correct.
                  
                  const targetLaneIdx = laneMap.get(inputNode.laneId) || 0;
                  
                  // If target lane is same as action lane, align perfectly.
                  if (targetLaneIdx === laneIdx) {
                      const ingPos = placeNode(inputNode, laneIdx, ingredientStackY);
                      ingredientStackY += ingPos.height + 10; // Stack multiple ingredients
                  } else {
                      // It's in another lane (e.g. Lane 1 prep flowing into Lane 2).
                      // Place it standardly in its own lane.
                      placeNode(inputNode, targetLaneIdx);
                  }
              }
          });
          
          // Adjust Lane Cursor if ingredients stack taller than action
          const totalIngHeight = ingredientStackY - actionPos.y;
          if (totalIngHeight > actionPos.height) {
               laneYCursors[laneIdx] = actionPos.y + totalIngHeight + GAP_Y;
          }
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