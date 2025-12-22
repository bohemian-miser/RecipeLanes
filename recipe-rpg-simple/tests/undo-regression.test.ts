
type Node = { id: string; type?: string };
type Edge = { id: string; source: string; target: string };

// Buggy GraphManager (No Edge Restoration)
class BuggyGraphManager {
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
        this.takeSnapshot();
        const incoming = this.edges.filter(e => e.target === nodeId);
        const outgoing = this.edges.filter(e => e.source === nodeId);
        
        let newEdges = this.edges.filter(e => e.source !== nodeId && e.target !== nodeId);
        
        incoming.forEach(inEdge => {
            outgoing.forEach(outEdge => {
                newEdges.push({ 
                    id: `${inEdge.source}-${outEdge.target}-bridge`, 
                    source: inEdge.source, 
                    target: outEdge.target 
                });
            });
        });
        
        this.nodes = this.nodes.filter(n => n.id !== nodeId);
        this.edges = newEdges;
    }

    undo() {
        const prev = this.history.pop();
        if (prev) {
            this.nodes = prev.nodes;
            // BUG: edges not restored!
            // this.edges = prev.edges; 
        }
    }

    verifyState(expectedNodes: string[], expectedEdges: string[]) {
        const nodeIds = this.nodes.map(n => n.id).sort();
        if (JSON.stringify(nodeIds) !== JSON.stringify(expectedNodes.sort())) {
            throw new Error(`Nodes mismatch. Got ${JSON.stringify(nodeIds)}, expected ${JSON.stringify(expectedNodes)}`);
        }
        
        const edgePairs = this.edges.map(e => `${e.source}->${e.target}`).sort();
        if (JSON.stringify(edgePairs) !== JSON.stringify(expectedEdges.sort())) {
             throw new Error(`Edges mismatch. Got ${JSON.stringify(edgePairs)}, expected ${JSON.stringify(expectedEdges)}`);
        }
    }
}

function runRegressionTest() {
    console.log("Running Regression Test (Expect Failure)...");
    
    // Chain 1->2->3
    const mgr = new BuggyGraphManager(
        [{id:'1'}, {id:'2'}, {id:'3'}],
        [{id:'e1', source:'1', target:'2'}, {id:'e2', source:'2', target:'3'}]
    );
    
    mgr.deleteNode('2');
    // State: 1->3
    
    mgr.undo();
    // Expected: 1->2, 2->3.
    // Actual (Buggy): 1->3 (Edges not restored, only nodes).
    // Nodes: 1, 2, 3. Edges: 1->3 (Bridge remains, original edges gone).
    
    try {
        mgr.verifyState(['1', '2', '3'], ['1->2', '2->3']);
        console.error("TEST PASSED UNEXPECTEDLY (Bug not reproduced)");
        process.exit(1);
    } catch (e) {
        console.log("TEST FAILED AS EXPECTED (Bug reproduced):", e.message);
    }
}

runRegressionTest();
