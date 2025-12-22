import { getEdgeParams } from '../lib/recipe-lanes/graph-utils';

// Mock types
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
            this.edges = prev.edges;
        }
    }

    verifyState(expectedNodes: string[], expectedEdges: string[]) {
        const nodeIds = this.nodes.map(n => n.id).sort();
        const edgeIds = this.edges.map(e => e.id).sort();
        const expNodes = expectedNodes.sort();
        const expEdges = expectedEdges.sort(); 
        
        if (JSON.stringify(nodeIds) !== JSON.stringify(expNodes)) {
            throw new Error(`Nodes mismatch. Got ${JSON.stringify(nodeIds)}, expected ${JSON.stringify(expNodes)}`);
        }
        
        // Check edges by source-target pair
        const edgePairs = this.edges.map(e => `${e.source}->${e.target}`).sort();
        const expEdgePairs = expectedEdges.sort();
        
        if (JSON.stringify(edgePairs) !== JSON.stringify(expEdgePairs)) {
             throw new Error(`Edges mismatch. Got ${JSON.stringify(edgePairs)}, expected ${JSON.stringify(expEdgePairs)}`);
        }
    }
}

function runTests() {
    console.log("Running Complex Undo Tests...");
    
    // Case 1: Chain
    {
        console.log("Case 1: Chain 1->2->3");
        const mgr = new GraphManager(
            [{id:'1'}, {id:'2'}, {id:'3'}],
            [{id:'e1', source:'1', target:'2'}, {id:'e2', source:'2', target:'3'}]
        );
        
        mgr.deleteNode('2');
        mgr.verifyState(['1', '3'], ['1->3']); 
        
        mgr.undo();
        mgr.verifyState(['1', '2', '3'], ['1->2', '2->3']); 
        console.log("PASS");
    }

    // Case 2: Multi-Delete
    {
        console.log("Case 2: Multi-Delete Chain 1->2->3->4");
        const mgr = new GraphManager(
            [{id:'1'}, {id:'2'}, {id:'3'}, {id:'4'}],
            [{id:'1-2', source:'1', target:'2'}, {id:'2-3', source:'2', target:'3'}, {id:'3-4', source:'3', target:'4'}]
        );
        
        mgr.deleteNode('2');
        mgr.verifyState(['1', '3', '4'], ['1->3', '3->4']);
        
        mgr.deleteNode('3');
        mgr.verifyState(['1', '4'], ['1->4']);
        
        mgr.undo();
        mgr.verifyState(['1', '3', '4'], ['1->3', '3->4']);
        
        mgr.undo();
        mgr.verifyState(['1', '2', '3', '4'], ['1->2', '2->3', '3->4']);
        console.log("PASS");
    }

    // Case 3: Fan-In / Fan-Out
    {
        console.log("Case 3: Fan-In / Fan-Out");
        const mgr = new GraphManager(
            [{id:'1'}, {id:'2'}, {id:'3'}, {id:'4'}, {id:'5'}],
            [
                {id:'1-3', source:'1', target:'3'},
                {id:'2-3', source:'2', target:'3'},
                {id:'3-4', source:'3', target:'4'},
                {id:'3-5', source:'3', target:'5'}
            ]
        );
        
        mgr.deleteNode('3');
        mgr.verifyState(
            ['1', '2', '4', '5'],
            ['1->4', '1->5', '2->4', '2->5']
        );
        
        mgr.undo();
        mgr.verifyState(
            ['1', '2', '3', '4', '5'],
            ['1->3', '2->3', '3->4', '3->5']
        );
        console.log("PASS");
    }

    // Case 4: Diamond
    {
        console.log("Case 4: Diamond");
        const mgr = new GraphManager(
            [{id:'1'}, {id:'2'}, {id:'3'}, {id:'4'}],
            [
                {id:'1-2', source:'1', target:'2'},
                {id:'2-4', source:'2', target:'4'},
                {id:'1-3', source:'1', target:'3'},
                {id:'3-4', source:'3', target:'4'}
            ]
        );
        
        mgr.deleteNode('2');
        mgr.verifyState(
            ['1', '3', '4'],
            ['1->3', '1->4', '3->4']
        );
        
        mgr.undo();
        mgr.verifyState(
            ['1', '2', '3', '4'],
            ['1->2', '1->3', '2->4', '3->4']
        );
        console.log("PASS");
    }
}

try {
    runTests();
    console.log("All Complex Undo Tests Passed!");
} catch (e) {
    console.error("Test Failed:", e);
    process.exit(1);
}
