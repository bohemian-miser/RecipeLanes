import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getEdgeParams, isFiniteHandlePos } from '../lib/recipe-lanes/graph-utils';
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

        // Regression for issue #30: after save/reload, React Flow can hand the
        // floating edge non-finite handle coordinates before it has measured a
        // node's handle bounds. typeof NaN === 'number', so a plain typeof guard
        // let those through and the intersection math produced NaN endpoints —
        // arrows "detached" from their nodes / pointing at garbage coordinates.
        it('returns finite endpoints when handle positions are NaN (hydration)', () => {
            const n1 = createNode('1', 0, 0);
            const n2 = createNode('2', 0, 200);
            const result = getEdgeParams(n1, n2, { x: NaN, y: NaN }, { x: NaN, y: NaN });
            for (const v of [result.sx, result.sy, result.tx, result.ty]) {
                assert.ok(Number.isFinite(v), `expected a finite coordinate, got ${v}`);
            }
        });

        it('treats non-finite handle positions the same as no handle position', () => {
            const n1 = createNode('1', 0, 0);
            const n2 = createNode('2', 0, 200);
            const noHandles = getEdgeParams(n1, n2);
            const badHandles = getEdgeParams(n1, n2, { x: NaN, y: 5 }, { x: Infinity, y: -Infinity });
            assert.ok(Math.abs(noHandles.sx - badHandles.sx) < 1e-9);
            assert.ok(Math.abs(noHandles.sy - badHandles.sy) < 1e-9);
            assert.ok(Math.abs(noHandles.tx - badHandles.tx) < 1e-9);
            assert.ok(Math.abs(noHandles.ty - badHandles.ty) < 1e-9);
        });

        it('still honors a valid (finite) handle position', () => {
            const n1 = createNode('1', 0, 0);
            const n2 = createNode('2', 0, 200);
            const result = getEdgeParams(n1, n2, { x: 50, y: 40 }, { x: 50, y: 240 });
            for (const v of [result.sx, result.sy, result.tx, result.ty]) {
                assert.ok(Number.isFinite(v));
            }
        });
    });

    describe('isFiniteHandlePos', () => {
        it('accepts finite coordinate pairs (including zero and negatives)', () => {
            assert.strictEqual(isFiniteHandlePos({ x: 0, y: 0 }), true);
            assert.strictEqual(isFiniteHandlePos({ x: -12.5, y: 300 }), true);
        });

        it('rejects nullish and non-finite coordinates', () => {
            assert.strictEqual(isFiniteHandlePos(undefined), false);
            assert.strictEqual(isFiniteHandlePos(null), false);
            assert.strictEqual(isFiniteHandlePos({ x: NaN, y: 0 }), false);
            assert.strictEqual(isFiniteHandlePos({ x: 0, y: NaN }), false);
            assert.strictEqual(isFiniteHandlePos({ x: Infinity, y: 0 }), false);
            assert.strictEqual(isFiniteHandlePos({ x: 0, y: -Infinity }), false);
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
