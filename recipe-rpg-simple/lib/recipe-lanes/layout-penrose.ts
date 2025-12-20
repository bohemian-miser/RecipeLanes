import { compile, optimize, showError, State, step } from '@penrose/core';
import type { RecipeGraph, LayoutGraph, VisualNode, VisualEdge } from './types';

export const calculatePenroseLayout = async (graph: RecipeGraph, spacing: number = 1): Promise<LayoutGraph> => {
    // 1. Sanitize IDs
    const nodeMap = new Map<string, string>(); // realId -> penroseId
    const reverseNodeMap = new Map<string, string>(); // penroseId -> realId
    
    graph.nodes.forEach((n, i) => {
        const pid = `n_${i}`;
        nodeMap.set(n.id, pid);
        reverseNodeMap.set(pid, n.id);
    });

    // 2. Generate SUB
    let sub = ``;
    graph.nodes.forEach(n => {
        sub += `Node ${nodeMap.get(n.id)}\n`;
    });

    let edgeCount = 0;
    graph.nodes.forEach(n => {
        if (n.inputs) {
            n.inputs.forEach(inpId => {
                if (nodeMap.has(inpId)) {
                    const u = nodeMap.get(inpId);
                    const v = nodeMap.get(n.id);
                    const eid = `e_${edgeCount++}`;
                    sub += `Edge ${eid}\n`;
                    sub += `Link(${eid}, ${u}, ${v})\n`;
                }
            });
        }
    });

    // 3. Define DSL and STY
    const dsl = `
        type Node
        type Edge
        predicate Link(Edge, Node, Node)
    `;

    const sty = `
        canvas {
            width = 1000
            height = 1000
        }

        forall Node n {
            n.x = ?
            n.y = ?
            n.shape = Circle {
                center: (n.x, n.y)
                r: 50.0
            }
            ensure onCanvas(n.shape)
        }

        forall Node u; Node v {
            ensure disjoint(u.shape, v.shape, 20.0 * ${spacing})
        }

        forall Edge e; Node u; Node v
        where Link(e, u, v) {
            // Edges (u -> v). u is input, v is output.
            // Force Directed Link
            ensure lessThan(vdist(u.shape.center, v.shape.center), 200.0 * ${spacing})
            
            // Orientation: Top-Down (u above v)
            // Penrose Y is typically Cartesian (Up). 
            // So u.y > v.y
            ensure greaterThan(u.shape.center[1], v.shape.center[1])
            
            // Visual Line (optional, we extract coords)
            /* e.shape = Line {
                start: u.shape.center
                end: v.shape.center
                strokeWidth: 2.0
            } */
        }
    `;

    // 4. Compile
    console.log('Penrose: Compiling...');
    const compiled = await compile({
        domain: dsl,
        substance: sub,
        style: sty,
        variation: 'recipe'
    });

    if (compiled.isErr()) {
        console.error('Penrose Compile Error:', compiled.error);
        throw new Error('Failed to compile Penrose layout');
    }

    let state = compiled.value;

    // 5. Optimize
    console.log('Penrose: Optimizing...');
    const optimized = optimize(state);
    
    if (optimized.isErr()) {
        console.error('Penrose Optimize Error:', optimized.error);
        throw new Error('Penrose Optimization Failed');
    }
    
    state = optimized.value;

    // 6. Extract Positions
    const nodes: VisualNode[] = [];
    
    // We need to map Penrose Shapes back to Nodes
    // State has `shapes`. But mapping shapes to substance IDs is via `state.computeShapes`?
    // Or we look at `state.shapes` properties?
    // Actually `state` has `shapes` which are list of Shape objects.
    // Shape objects have `name` property? No.
    // We can look at `state.labelCache`? No. 
    
    // We need to access values from the state directly via paths.
    // `n_0.x`, `n_0.y`.
    // Penrose State has inputs/outputs.
    
    // Better way: Penrose `shapes` list order usually matches, but risky.
    // Correct way is to query the state.
    // However, the `optimize` function returns a raw State object.
    // We can iterate over `substance` items?
    
    // Let's use the Shapes directly if we can tag them?
    // In Style: `n.shape.name = "n_0"`? Penrose shapes don't have arbitrary data.
    
    // We can rely on `state.shapes`.
    // But how to know which shape is which node?
    // Penrose generates shapes in order of Style blocks?
    // This is tricky.
    
    // Alternative: We can define `n.x` and `n.y` as scalar values and read them?
    // `state.varyingValues`?
    
    // Let's try to infer from the shapes list.
    // If we have `forall Node n`, it generates shapes for each node in order of substance declaration?
    // Yes, usually.
    // Substance order: n_0, n_1...
    // Shapes: shape 0, shape 1...
    
    // Let's assume order.
    // The shapes array contains ALL shapes.
    // We only defined `n.shape`. No `e.shape`.
    // So `state.shapes` should contain exactly `nodes.length` circles.
    
    const shapes = state.shapes;
    
    graph.nodes.forEach((n, i) => {
        const pid = nodeMap.get(n.id);
        // Find shape? We assume index i matches if substance order is preserved.
        // Penrose shapes are in a flat list.
        const shape: any = shapes[i]; 
        
        if (shape && shape.shapeType === 'Circle') {
            const center = shape.properties.center; // [x, y]
            // Penrose types are complex. `center` is an object with `contents`.
            // Let's inspect at runtime or use type guard.
            // Usually `center` -> `VectorV` -> `contents` -> `[number, number]`.
            
            const x = (center as any).contents[0];
            const y = (center as any).contents[1];
            
            // Map Penrose coords (Center 0,0, Y Up) to ReactFlow (Top-Left 0,0, Y Down)
            // Penrose 0,0 is center of canvas.
            // We flip Y.
            
            nodes.push({
                id: n.id,
                type: n.type,
                x: x, 
                y: -y, // Flip Y
                width: 100,
                height: 100,
                data: n
            });
        }
    });

    const edges: VisualEdge[] = [];
    // Edges are implicit from nodes. React Flow draws them.
    const edgeMap = new Map();
    // Re-use edge generation logic from layout.ts?
    // Or simpler:
    graph.nodes.forEach(n => {
        if (n.inputs) {
            n.inputs.forEach(inp => {
                edges.push({ id: `${inp}->${n.id}`, sourceId: inp, targetId: n.id, path: '' });
            });
        }
    });

    // Normalize coordinates
    let minX = Infinity, minY = Infinity;
    nodes.forEach(n => {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
    });
    
    nodes.forEach(n => {
        n.x = n.x - minX + 50;
        n.y = n.y - minY + 50;
    });

    return {
        nodes,
        edges,
        lanes: [],
        width: 1000,
        height: 1000
    };
};
