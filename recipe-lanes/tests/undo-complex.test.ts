import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateBridgeEdges, MinimalEdge } from '../lib/recipe-lanes/graph-logic';

type Node = { id: string; type?: string };

class GraphManager {
    nodes: Node[];
    edges: MinimalEdge[];
    history: { nodes: Node[], edges: MinimalEdge[] }[] = [];

    constructor(nodes: Node[], edges: MinimalEdge[]) {
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
        const factory = (s: string, t: string) => ({ id: `${s}-${t}-bridge`, source: s, target: t });
        this.edges = calculateBridgeEdges(nodeId, this.edges, factory);
        this.nodes = this.nodes.filter(n => n.id !== nodeId);
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
        const expNodes = expectedNodes.sort();
        assert.deepStrictEqual(nodeIds, expNodes, 'Nodes mismatch');
        
        const edgePairs = this.edges.map(e => `${e.source}->${e.target}`).sort();
        const expEdgePairs = expectedEdges.sort();
        assert.deepStrictEqual(edgePairs, expEdgePairs, 'Edges mismatch');
    }
}

describe('Complex Undo Tests', () => {
    it('Case 1: Chain 1->2->3', () => {
        const mgr = new GraphManager(
            [{id:'1'}, {id:'2'}, {id:'3'}],
            [{id:'e1', source:'1', target:'2'}, {id:'e2', source:'2', target:'3'}]
        );
        
        mgr.deleteNode('2');
        mgr.verifyState(['1', '3'], ['1->3']); 
        
        mgr.undo();
        mgr.verifyState(['1', '2', '3'], ['1->2', '2->3']); 
    });

    it('Case 2: Multi-Delete Chain 1->2->3->4', () => {
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
    });

    it('Case 3: Fan-In / Fan-Out', () => {
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
    });

    it('Case 4: Diamond', () => {
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
    });

    it('should correctly bridge edges when whisk node is deleted', () => {
        const nodes = [
            { id: "egg" }, { id: "salt" }, { id: "butter" }, { id: "cheese" },
            { id: "crack" }, { id: "whisk" }, { id: "melt" }, { id: "cook" }, { id: "final" }
        ];
        
        const edges: MinimalEdge[] = [
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
        assert.strictEqual(mgr.edges.length, 8);

        // Delete "whisk"
        mgr.deleteNode("whisk");
        
        // Removed: crack->whisk, salt->whisk, whisk->cook (3)
        // Added: crack->cook, salt->cook (2)
        // Total: 8 - 3 + 2 = 7
        assert.strictEqual(mgr.edges.length, 7);
        
        const bridges = mgr.edges.filter(e => e.id?.includes("bridge"));
        assert.strictEqual(bridges.length, 2);

        // Undo
        mgr.undo();
        assert.strictEqual(mgr.edges.length, 8);
        assert.ok(mgr.edges.find(e => e.id === "e2"));
        assert.ok(mgr.edges.find(e => e.id === "e3"));
        assert.ok(mgr.edges.find(e => e.id === "e5"));
    });
});
