import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getEdgeParams } from '../lib/recipe-lanes/graph-utils';
import { calculateBridgeEdges, MinimalEdge } from '../lib/recipe-lanes/graph-logic';

// --- HELPERS ---
const createNode = (id: string, x: number, y: number, textPos = 'bottom', type = 'minimal'): any => ({
    id,
    type,
    position: { x, y },
    width: 100,
    height: 100,
    data: { textPos }
});

describe('Graph Utilities & Logic', () => {
    
    describe('getEdgeParams', () => {
        it('should calculate vertical edge parameters correctly', () => {
            const n1 = createNode('1', 0, 0);
            const n2 = createNode('2', 0, 200);
            const result = getEdgeParams(n1, n2);
            assert.ok(Math.abs(result.sx - 50) < 1);
            assert.ok(Math.abs(result.sy - 86) < 1);
        });
    });

    describe('calculateBridgeEdges', () => {
        it('should bridge edges when a middle node is deleted', () => {
            const edges: MinimalEdge[] = [
                { id: '1-2', source: '1', target: '2' },
                { id: '2-3', source: '2', target: '3' }
            ];
            const factory = (s: string, t: string) => ({ id: `${s}-${t}`, source: s, target: t });
            const result = calculateBridgeEdges('2', edges, factory);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].source, '1');
            assert.strictEqual(result[0].target, '3');
        });

        it('should not create duplicate edges', () => {
            const edges: MinimalEdge[] = [
                { id: '1-2', source: '1', target: '2' },
                { id: '2-3', source: '2', target: '3' },
                { id: '1-3', source: '1', target: '3' }
            ];
            const factory = (s: string, t: string) => ({ id: `${s}-${t}`, source: s, target: t });
            const result = calculateBridgeEdges('2', edges, factory);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].target, '3');
        });
    });

    describe('Complex Undo/State Scenarios', () => {
        it('should handle multi-delete and undo', () => {
            let nodes = [{id:'1'}, {id:'2'}, {id:'3'}];
            let edges = [{id:'e1', source:'1', target:'2'}, {id:'e2', source:'2', target:'3'}];
            const history = [JSON.parse(JSON.stringify({nodes, edges}))];
            
            // Delete
            const factory = (s: string, t: string) => ({ id: `${s}-${t}`, source: s, target: t });
            edges = calculateBridgeEdges('2', edges, factory);
            nodes = nodes.filter(n => n.id !== '2');
            
            assert.strictEqual(nodes.length, 2);
            assert.strictEqual(edges[0].source, '1');
            assert.strictEqual(edges[0].target, '3');

            // Undo
            const prev = history.pop()!;
            nodes = prev.nodes;
            edges = prev.edges;
            assert.strictEqual(nodes.length, 3);
            assert.strictEqual(edges.length, 2);
        });
    });
});
