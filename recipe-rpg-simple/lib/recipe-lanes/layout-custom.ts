import type { RecipeGraph, LayoutGraph, VisualNode, VisualEdge, VisualLane, RecipeNode } from './types';

// Constants
const NODE_SIZE = 60; // Micro/Minimal style
const MIN_RADIUS = 120;
const INGREDIENT_RADIUS = 100;

export const calculateUpwardLayout = (graph: RecipeGraph, spacing: number = 1): LayoutGraph => {
    // Constants
    const NODE_SIZE = 60; 
    const MIN_RADIUS = 120 * spacing;
    const INGREDIENT_RADIUS = 100 * spacing;
    
    const nodes: VisualNode[] = [];
    const edges: VisualEdge[] = [];
    
    // 1. Find Sink (Node with no consumers, or the one with id 'serve' or last in list)
    // Build adjacency
    const consumedBy = new Map<string, string[]>();
    const consumersOf = new Map<string, string[]>(); // node -> inputs
    
    graph.nodes.forEach(n => {
        consumersOf.set(n.id, n.inputs || []);
        if (n.inputs) {
            n.inputs.forEach(inp => {
                if (!consumedBy.has(inp)) consumedBy.set(inp, []);
                consumedBy.get(inp)!.push(n.id);
            });
        }
    });

    const sinks = graph.nodes.filter(n => !consumedBy.has(n.id) || consumedBy.get(n.id)!.length === 0);
    // If multiple sinks, pick the 'action' one or the last one.
    const rootNode = sinks.find(n => n.type === 'action') || sinks[sinks.length - 1];

    if (!rootNode) return { nodes: [], edges: [], lanes: [], width: 100, height: 100 };

    const visited = new Set<string>();
    const positions = new Map<string, { x: number, y: number, angle: number }>();

    // Initial placement: Root at bottom center
    const startX = 0;
    const startY = 0;
    
    // Recursive placement
    // angleCenter: direction "up" is -90 degrees (in screen coords, y goes down). 
    // Wait, standard math: 0 is Right, -90 is Up.
    // Let's use radians. Up = -PI/2.
    
    const placeRecursive = (nodeId: string, x: number, y: number, centerAngle: number, wedge: number, level: number) => {
        if (visited.has(nodeId)) return; // Handle DAGs by ignoring multi-parents for now (or treat as tree)
        // Ideally we handle shared nodes by placing them "between" parents, but recursion is tree-like.
        // We'll mark visited to prevent loops/re-placement.
        visited.add(nodeId);
        
        const node = graph.nodes.find(n => n.id === nodeId);
        if (!node) return;

        // Store position
        positions.set(nodeId, { x, y, angle: centerAngle });
        nodes.push({
            id: nodeId,
            type: node.type, // Use original type
            x: x - NODE_SIZE/2, // Centered
            y: y - NODE_SIZE/2,
            width: NODE_SIZE,
            height: NODE_SIZE,
            data: node
        });

        const inputs = node.inputs || [];
        if (inputs.length === 0) return;

        const ingredients = inputs.filter(id => graph.nodes.find(n => n.id === id)?.type === 'ingredient');
        const actions = inputs.filter(id => graph.nodes.find(n => n.id === id)?.type === 'action');

        // Placement Logic:
        // "Ingredients default to just going up... splay in an arc"
        // "Steps... splay around at 45 degrees... alternate"

        // 1. Place Ingredients
        if (ingredients.length > 0) {
            // Arc above the node.
            // Center angle is centerAngle.
            // Spread depends on count.
            const spread = Math.min(Math.PI, ingredients.length * (Math.PI / 6)); // max 180 deg, ~30 deg per item
            const startAng = centerAngle - spread / 2;
            const stepAng = spread / (ingredients.length + 1 || 1); // evenly space?
            // Actually, distribute evenly between start and end
            
            ingredients.forEach((ingId, idx) => {
                // Splay arc
                // If only 1, goes straight up (centerAngle)
                let ang = centerAngle;
                if (ingredients.length > 1) {
                     ang = startAng + stepAng * (idx + 1);
                }
                
                // Radius
                const r = INGREDIENT_RADIUS; // + Math.random() * 20 for bunching?
                
                const px = x + r * Math.cos(ang);
                const py = y + r * Math.sin(ang);
                
                placeRecursive(ingId, px, py, ang, 0, level + 1);
            });
        }

        // 2. Place Actions (Previous Steps)
        if (actions.length > 0) {
            // "Forks go left and up... alternate"
            // We split the available wedge for actions.
            // Actions are typically heavier/larger subtrees, so give them more space.
            const r = MIN_RADIUS * 1.8; // Further out
            
            // "Alternate each step" -> maybe zig-zag radius?
            
            // Calculate angles
            // If 1 action: 45 deg from vertical? Or just Up?
            // "if there is a previous step coming in, then splay around at 45 degrees from the vertical"
            // Vertical relative to current node is `centerAngle`.
            // So if 1 action: centerAngle - 45deg (Left-Up?) or +45?
            // User said "go left and up".
            
            actions.forEach((actId, idx) => {
                let ang = centerAngle;
                let thisR = r;

                if (actions.length === 1) {
                     // Single previous step -> 45 deg offset to allow ingredients to be "up"?
                     // Or just straight up if no ingredients.
                     if (ingredients.length > 0) {
                         ang = centerAngle - Math.PI / 4; // Left-Up
                     } else {
                         ang = centerAngle; // Straight up
                     }
                } else if (actions.length === 2) {
                    // "Left up and up left" -> maybe -30 and -60? Or -45 and +45?
                    // User said "2 in the middle... share space... angle inbetween"
                    ang = centerAngle + (idx === 0 ? -1 : 1) * (Math.PI / 4); // +/- 45
                } else {
                    // Evenly spread
                    const spread = Math.PI; 
                    const start = centerAngle - spread/2;
                    const step = spread / (actions.length + 1);
                    ang = start + step * (idx + 1);
                }

                // Alternate radius to "bunch"
                if (idx % 2 === 1) thisR *= 1.2;

                const px = x + thisR * Math.cos(ang);
                const py = y + thisR * Math.sin(ang);
                
                placeRecursive(actId, px, py, ang, wedge / actions.length, level + 1);
            });
        }
    };

    placeRecursive(rootNode.id, startX, startY, -Math.PI / 2, Math.PI, 0);

    // Generate Edges
    graph.nodes.forEach(node => {
        if (node.inputs) {
            node.inputs.forEach(inputId => {
                if (positions.has(inputId) && positions.has(node.id)) {
                    edges.push({
                        id: `${inputId}->${node.id}`,
                        sourceId: inputId,
                        targetId: node.id,
                        path: '' // React Flow handles curved edges
                    });
                }
            });
        }
    });

    // Normalize coordinates to top-left 0,0
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + n.width);
        maxY = Math.max(maxY, n.y + n.height);
    });

    const padding = 50;
    nodes.forEach(n => {
        n.x = n.x - minX + padding;
        n.y = n.y - minY + padding;
    });

    return {
        nodes,
        edges,
        lanes: [], // No lanes
        width: maxX - minX + padding * 2,
        height: maxY - minY + padding * 2
    };
};
