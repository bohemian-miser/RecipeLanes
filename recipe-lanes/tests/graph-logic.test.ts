import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateBridgeEdges, MinimalEdge, getLeafNodeIds, isLeafNode } from '../lib/recipe-lanes/graph-logic';

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

describe('Leaf detection (out-degree 0)', () => {
    // Edge direction is inputId -> node.id, so a node whose id appears in no
    // other node's `inputs` has out-degree 0 and is a leaf.
    // ingredients (a, b) -> mix (c) -> plate (d).  d is the sole leaf.
    const chain = [
        { id: 'a' },
        { id: 'b' },
        { id: 'c', inputs: ['a', 'b'] },
        { id: 'd', inputs: ['c'] },
    ];

    it('getLeafNodeIds returns only terminal nodes', () => {
        const leaves = getLeafNodeIds(chain);
        assert.deepStrictEqual([...leaves].sort(), ['d']);
    });

    it('getLeafNodeIds finds multiple independent terminals', () => {
        // c and d are both consumed by nothing -> both leaves.
        const graph = [
            { id: 'a' },
            { id: 'c', inputs: ['a'] },
            { id: 'd', inputs: ['a'] },
        ];
        assert.deepStrictEqual([...getLeafNodeIds(graph)].sort(), ['c', 'd']);
    });

    it('getLeafNodeIds treats an isolated node as a leaf', () => {
        const leaves = getLeafNodeIds([{ id: 'lonely' }]);
        assert.deepStrictEqual([...leaves], ['lonely']);
    });

    it('isLeafNode agrees with getLeafNodeIds', () => {
        assert.strictEqual(isLeafNode(chain, 'd'), true);
        assert.strictEqual(isLeafNode(chain, 'a'), false); // consumed by c
        assert.strictEqual(isLeafNode(chain, 'c'), false); // consumed by d
    });

    it('isLeafNode returns false when nodes is undefined', () => {
        assert.strictEqual(isLeafNode(undefined, 'x'), false);
    });
});
