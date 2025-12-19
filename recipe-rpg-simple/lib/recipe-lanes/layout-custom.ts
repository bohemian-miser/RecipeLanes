import type { RecipeGraph, LayoutGraph, VisualNode, VisualEdge, VisualLane, RecipeNode } from './types';

// Constants
const NODE_SIZE = 60; // Micro/Minimal style
const MIN_RADIUS = 120;
const INGREDIENT_RADIUS = 100;

export const calculateUpwardLayout = (graph: RecipeGraph, spacing: number = 1): LayoutGraph => {
    // Constants
    const NODE_SIZE = 60; 
    const MIN_RADIUS = 80 * spacing; // Tighter
    const INGREDIENT_RADIUS = 100 * spacing;
    
    const nodes: VisualNode[] = [];
    const edges: VisualEdge[] = [];
    
    // ... (rest of Sink finding logic is same, keep it)
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
    const rootNode = sinks.find(n => n.type === 'action') || sinks[sinks.length - 1];

    if (!rootNode) return { nodes: [], edges: [], lanes: [], width: 100, height: 100 };

    const visited = new Set<string>();
    const positions = new Map<string, { x: number, y: number }>();

    // Recursion
    const placeRecursive = (nodeId: string, x: number, y: number, centerAngle: number, availableWedge: number) => {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);
        
        const node = graph.nodes.find(n => n.id === nodeId);
        if (!node) return;

        positions.set(nodeId, { x, y });
        nodes.push({
            id: nodeId,
            type: node.type, // Use correct type
            x: x - NODE_SIZE/2,
            y: y - NODE_SIZE/2,
            width: NODE_SIZE,
            height: NODE_SIZE,
            data: node
        });

        const inputs = node.inputs || [];
        if (inputs.length === 0) return;

        const ingredients = inputs.filter(id => graph.nodes.find(n => n.id === id)?.type === 'ingredient');
        const actions = inputs.filter(id => graph.nodes.find(n => n.id === id)?.type === 'action');

        // 1. Ingredients: Fan out in immediate proximity
        if (ingredients.length > 0) {
            // Place ingredients in a local arc "above" the node relative to its incoming angle?
            // Or just strictly UP relative to screen.
            // Let's bias them towards the "outside" of the tree.
            
            // Simple approach: Arc centered on `centerAngle`
            const spread = Math.min(Math.PI * 0.8, ingredients.length * (Math.PI / 8));
            const startAng = centerAngle - spread / 2;
            const stepAng = spread / (ingredients.length + 1 || 1);
            
            ingredients.forEach((ingId, idx) => {
                const ang = startAng + stepAng * (idx + 1);
                // Ensure angle is somewhat Up (-PI to 0)
                // Clamp Y to be above parent
                const r = INGREDIENT_RADIUS;
                const px = x + r * Math.cos(ang);
                const py = Math.min(y - 20, y + r * Math.sin(ang)); // Force Y up at least 20px
                
                placeRecursive(ingId, px, py, ang, 0);
            });
        }

        // 2. Actions: Divide the wedge
        if (actions.length > 0) {
            const r = MIN_RADIUS * 1.5;
            
            // Constrain wedge to avoid downward
            // Max wedge is PI (180).
            const safeWedge = Math.min(availableWedge, Math.PI * 0.9);
            const startAng = centerAngle - safeWedge / 2;
            const stepAng = safeWedge / (actions.length + 1);

            actions.forEach((actId, idx) => {
                const ang = startAng + stepAng * (idx + 1);
                
                // Radius increases with depth to splay out? Or constant?
                // Constant is cleaner for "Layers".
                
                const px = x + r * Math.cos(ang);
                const py = Math.min(y - MIN_RADIUS, y + r * Math.sin(ang)); // Strict Up constraint

                // Pass reduced wedge for children to avoid overlap
                placeRecursive(actId, px, py, ang, safeWedge / 2);
            });
        }
    };

    placeRecursive(rootNode.id, 0, 0, -Math.PI / 2, Math.PI); // Start pointing UP
// ... (rest is same)

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
