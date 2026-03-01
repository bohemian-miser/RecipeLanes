
type Node = { id: string; type?: string };
type Edge = { id: string; source: string; target: string };

class GraphManager {
    nodes: Node[];
    edges: Edge[];
    history: { nodes: Node[], edges: Edge[] }[] = [];

    constructor(nodes: Node[], edges: Edge[]) {
        this.nodes = nodes;
        this.edges = edges;
    }

    takeSnapshot() {
        this.history.push({
            nodes: JSON.parse(JSON.stringify(this.nodes)),
            edges: JSON.parse(JSON.stringify(this.edges))
        });
    }

    deleteNode(nodeId: string) {
        console.log(`[Logic] Deleting node: ${nodeId}`);
        this.takeSnapshot();
        
        const incoming = this.edges.filter(e => e.target === nodeId);
        const outgoing = this.edges.filter(e => e.source === nodeId);
        
        const newEdges = this.edges.filter(e => e.source !== nodeId && e.target !== nodeId);
        
        console.log(`[Logic] Removing ${incoming.length} incoming and ${outgoing.length} outgoing edges.`);

        incoming.forEach(inEdge => {
            outgoing.forEach(outEdge => {
                const id = `${inEdge.source}-${outEdge.target}-bridge`;
                console.log(`[Logic] Adding bridge edge: ${id}`);
                newEdges.push({ 
                    id, 
                    source: inEdge.source, 
                    target: outEdge.target 
                });
            });
        });
        
        this.nodes = this.nodes.filter(n => n.id !== nodeId);
        this.edges = newEdges;
    }

    undo() {
        console.log("[Logic] Undoing...");
        const prev = this.history.pop();
        if (prev) {
            this.nodes = prev.nodes;
            this.edges = prev.edges;
        }
    }

    getEdgeCount() {
        return this.edges.length;
    }
}

function runScrambledEggsTest() {
    console.log("Running Scrambled Eggs Logic Test...");

    // Scrambled Eggs Graph (Simplified IDs)
    const nodes = [
        { id: "egg" }, { id: "salt" }, { id: "butter" }, { id: "cheese" },
        { id: "crack" }, { id: "whisk" }, { id: "melt" }, { id: "cook" }, { id: "final" }
    ];
    
    // Edges (8 total)
    const edges = [
        { id: "e1", source: "egg", target: "crack" },
        { id: "e2", source: "crack", target: "whisk" },
        { id: "e3", source: "salt", target: "whisk" },
        { id: "e4", source: "butter", target: "melt" },
        { id: "e5", source: "whisk", target: "cook" },
        { id: "e6", source: "melt", target: "cook" },
        { id: "e7", source: "cook", target: "final" },
        { id: "e8", source: "cheese", target: "final" }
    ];

    const mgr = new GraphManager(nodes, edges);
    
    console.log(`Initial Edges: ${mgr.getEdgeCount()} (Expected 8)`);
    if (mgr.getEdgeCount() !== 8) throw new Error("Setup failed");

    // Delete "whisk" (Whisked eggs)
    // Inputs: crack, salt. Output: cook.
    // Edges removed: crack->whisk (e2), salt->whisk (e3), whisk->cook (e5). Total 3.
    // Bridges added: crack->cook, salt->cook. Total 2.
    // Net change: -1.
    // Result: 7 edges.
    
    mgr.deleteNode("whisk");
    
    console.log(`Edges after delete: ${mgr.getEdgeCount()} (Expected 7)`);
    if (mgr.getEdgeCount() !== 7) throw new Error("Delete logic failed");
    
    // Check bridges exist
    const bridges = mgr.edges.filter(e => e.id.includes("bridge"));
    console.log(`Bridges created: ${bridges.length} (Expected 2)`);
    if (bridges.length !== 2) throw new Error("Bridge creation failed");

    // Undo
    mgr.undo();
    
    console.log(`Edges after Undo: ${mgr.getEdgeCount()} (Expected 8)`);
    if (mgr.getEdgeCount() !== 8) throw new Error("Undo failed to restore edges");
    
    // Verify specific edges restored
    const hasE2 = mgr.edges.find(e => e.id === "e2");
    const hasE3 = mgr.edges.find(e => e.id === "e3");
    const hasE5 = mgr.edges.find(e => e.id === "e5");
    
    if (hasE2 && hasE3 && hasE5) {
        console.log("Original edges e2, e3, e5 restored.");
    } else {
        throw new Error("Specific edges not restored");
    }

    console.log("Scrambled Eggs Logic Test PASS");
}

runScrambledEggsTest();
