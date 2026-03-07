import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateBridgeEdges, MinimalEdge } from '../lib/recipe-lanes/graph-logic';

class GraphManager {
    nodes: any[];
    edges: MinimalEdge[];
    history: { nodes: any[], edges: MinimalEdge[] }[] = [];

    constructor(nodes: any[], edges: MinimalEdge[]) {
        this.nodes = nodes;
        this.edges = edges;
    }

    takeSnapshot() {
        this.history.push({
            nodes: JSON.parse(JSON.stringify(this.nodes)),
            edges: JSON.parse(JSON.stringify(this.edges))
        });
    }

    deleteGraphNode(nodeId: string) {
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
}

describe('Scrambled Eggs Logic', () => {
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
        mgr.deleteGraphNode("whisk");
        
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
