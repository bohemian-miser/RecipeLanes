import { getEdgeParams } from '../lib/recipe-lanes/graph-utils';

// ... (existing helper)

function testDeletionUndo() {
    console.log("Testing Node Deletion Undo Logic...");
    // Mock State Management
    let nodes = [
        { id: '1', type: 'ingredient' },
        { id: '2', type: 'ingredient' },
        { id: '3', type: 'action' }
    ];
    let edges = [
        { id: '1-3', source: '1', target: '3' },
        { id: '2-3', source: '2', target: '3' }
    ];
    
    // History Stack
    const history: any[] = [];
    const takeSnapshot = () => history.push({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) });

    // Action: Delete Node 3 (The Action)
    // Expected: 1 and 2 become disconnected?
    // Or if 3 had children, 1 and 2 connect to children.
    // In this case, 3 has NO children.
    // So 1 and 2 lose their outgoing edges.
    
    takeSnapshot();
    
    const nodeId = '3';
    const incoming = edges.filter(e => e.target === nodeId);
    const outgoing = edges.filter(e => e.source === nodeId);
    
    let newEdges = edges.filter(e => e.source !== nodeId && e.target !== nodeId);
    
    // Bridge logic
    incoming.forEach(inEdge => {
        outgoing.forEach(outEdge => {
            newEdges.push({ 
                id: `${inEdge.source}-${outEdge.target}`, 
                source: inEdge.source, 
                target: outEdge.target 
            });
        });
    });
    
    edges = newEdges;
    nodes = nodes.filter(n => n.id !== nodeId);
    
    // Check State After Delete
    if (nodes.length !== 2) throw new Error("Delete failed to remove node");
    if (edges.length !== 0) throw new Error("Delete failed to remove edges");
    
    // Undo
    const lastState = history.pop();
    nodes = lastState.nodes;
    edges = lastState.edges;
    
    // Check State After Undo
    if (nodes.length !== 3) throw new Error("Undo failed to restore node count");
    if (edges.length !== 2) throw new Error("Undo failed to restore edges count");
    if (!edges.find(e => e.id === '1-3')) throw new Error("Undo failed to restore edge 1-3");
    
    console.log("Deletion Undo PASS");
}

function testBridgeLogic() {
    console.log("Testing Bridge Logic (Parent -> Child)...");
    // 1 -> 2 -> 3
    let nodes = [{id:'1'}, {id:'2'}, {id:'3'}];
    let edges = [{id:'1-2', source:'1', target:'2'}, {id:'2-3', source:'2', target:'3'}];
    
    // Delete 2
    const nodeId = '2';
    const incoming = edges.filter(e => e.target === nodeId); // 1-2
    const outgoing = edges.filter(e => e.source === nodeId); // 2-3
    
    let newEdges = edges.filter(e => e.source !== nodeId && e.target !== nodeId);
    
    incoming.forEach(inEdge => {
        outgoing.forEach(outEdge => {
            newEdges.push({ 
                id: `${inEdge.source}-${outEdge.target}`, 
                source: inEdge.source, 
                target: outEdge.target 
            });
        });
    });
    
    // Expected: 1 -> 3
    if (newEdges.length !== 1) throw new Error("Bridge failed count");
    if (newEdges[0].source !== '1' || newEdges[0].target !== '3') throw new Error("Bridge failed connectivity");
    
    console.log("Bridge Logic PASS");
}

try {
    testDeletionUndo();
    testBridgeLogic();
    console.log("All Undo/Delete Tests Passed!");
} catch (e) {
    console.error(e);
    process.exit(1);
}
