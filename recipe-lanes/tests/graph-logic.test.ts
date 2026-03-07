import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateBridgeEdges, MinimalEdge } from '../lib/recipe-lanes/graph-logic';

describe('Graph Logic', () => {
    it('should bridge edges when a middle node is deleted', () => {
        // 1 -> 2 -> 3
        const edges: MinimalEdge[] = [
            { source: '1', target: '2' },
            { source: '2', target: '3' }
        ];

        const factory = (s: string, t: string) => ({ source: s, target: t });
        const result = calculateBridgeEdges('2', edges, factory);

        // Should result in 1 -> 3
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].source, '1');
        assert.strictEqual(result[0].target, '3');
    });

    it('should bridge multiple parents to a single child', () => {
        // 1 -> 3
        // 2 -> 3
        // 3 -> 4
        const edges: MinimalEdge[] = [
            { source: '1', target: '3' },
            { source: '2', target: '3' },
            { source: '3', target: '4' }
        ];

        const factory = (s: string, t: string) => ({ source: s, target: t });
        const result = calculateBridgeEdges('3', edges, factory);

        // Should result in 1 -> 4, 2 -> 4
        assert.strictEqual(result.length, 2);
        assert.ok(result.some(e => e.source === '1' && e.target === '4'));
        assert.ok(result.some(e => e.source === '2' && e.target === '4'));
    });

    it('should not create duplicate edges if bridge already exists', () => {
        // 1 -> 2 -> 3
        // 1 -> 3 (explicit)
        const edges: MinimalEdge[] = [
            { source: '1', target: '2' },
            { source: '2', target: '3' },
            { source: '1', target: '3' }
        ];

        const factory = (s: string, t: string) => ({ source: s, target: t });
        const result = calculateBridgeEdges('2', edges, factory);

        // Should result in ONLY ONE 1 -> 3
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].source, '1');
        assert.strictEqual(result[0].target, '3');
    });

    it('should handle leaf nodes (no bridging)', () => {
        // 1 -> 2
        const edges: MinimalEdge[] = [
            { source: '1', target: '2' }
        ];

        const factory = (s: string, t: string) => ({ source: s, target: t });
        const result = calculateBridgeEdges('2', edges, factory);

        assert.strictEqual(result.length, 0);
    });
});
