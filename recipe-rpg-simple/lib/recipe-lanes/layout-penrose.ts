import type { RecipeGraph, LayoutGraph, VisualNode, VisualEdge } from './types';

export const calculatePenroseLayout = async (graph: RecipeGraph, spacing: number = 1): Promise<LayoutGraph> => {
    const { compile, optimize, showError } = await import('@penrose/core');

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
        sub += `Node ${nodeMap.get(n.id)}
`;
    });

    let edgeCount = 0;
    graph.nodes.forEach(n => {
        if (n.inputs) {
            n.inputs.forEach(inpId => {
                if (nodeMap.has(inpId)) {
                    const u = nodeMap.get(inpId);
                    const v = nodeMap.get(n.id);
                    const eid = `e_${edgeCount++}`;
                    sub += `Edge ${eid}
`;
                    sub += `Link(${eid}, ${u}, ${v})
`;
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
            -- onCanvas replacement
            ensure lessThan(n.x, 400.0)
            ensure greaterThan(n.x, -400.0)
            ensure lessThan(n.y, 400.0)
            ensure greaterThan(n.y, -400.0)
        }

        forall Node u; Node v {
            ensure disjoint(u.shape, v.shape, 20.0 * ${spacing})
        }

        forall Edge e; Node u; Node v
        where Link(e, u, v) {
            ensure lessThan(vdist(u.shape.center, v.shape.center), 200.0 * ${spacing})
            ensure greaterThan(u.shape.center[1], v.shape.center[1])
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
    
    // Check result
    if (optimized.isErr()) {
        console.error('Penrose Optimize Error:', optimized.error);
        throw new Error('Penrose Optimization Failed');
    }
    
    state = optimized.value;

    // 6. Extract Positions
    const nodes: VisualNode[] = [];
    const shapes = state.shapes;
    
    graph.nodes.forEach((n, i) => {
        const shape: any = shapes[i]; 
        
        if (shape && shape.shapeType === 'Circle') {
            const center = shape.center;
            if (!center) {
                console.warn(`[Penrose] Shape ${i} missing center`);
                return;
            }

            const x = center.contents[0];
            const y = center.contents[1];
            
            nodes.push({
                id: n.id,
                type: n.type,
                x: x, 
                y: -y, // Flip Y
                width: 100,
                height: 100,
                data: n
            });
        } else {
            // ...
        }
    });

    const edges: VisualEdge[] = [];
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