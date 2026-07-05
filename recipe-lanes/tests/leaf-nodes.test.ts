import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getLeafNodeIds } from '../lib/recipe-lanes/leaf-nodes';

// Minimal node factory — only id/inputs matter for leaf detection.
const n = (id: string, inputs?: string[]) => ({ id, inputs });

const leaves = (nodes: ReturnType<typeof n>[]) =>
    [...getLeafNodeIds({ nodes } as any)].sort();

describe('getLeafNodeIds', () => {
    it('treats the terminal node of a chain as the only leaf', () => {
        // a -> b -> c  (c consumes b, b consumes a). Only c is a leaf.
        const nodes = [n('a'), n('b', ['a']), n('c', ['b'])];
        assert.deepStrictEqual(leaves(nodes), ['c']);
    });

    it('marks every node with no consumer as a leaf (multiple outputs)', () => {
        // a -> b, a -> c. Both b and c are leaves; a is consumed by both.
        const nodes = [n('a'), n('b', ['a']), n('c', ['a'])];
        assert.deepStrictEqual(leaves(nodes), ['b', 'c']);
    });

    it('a node feeding two consumers is not a leaf', () => {
        // shared: a -> c, b -> c, c -> d. Only d is a leaf.
        const nodes = [n('a'), n('b'), n('c', ['a', 'b']), n('d', ['c'])];
        assert.deepStrictEqual(leaves(nodes), ['d']);
    });

    it('an isolated node (no inputs, no consumers) is a leaf', () => {
        const nodes = [n('lonely'), n('a'), n('b', ['a'])];
        assert.deepStrictEqual(leaves(nodes), ['b', 'lonely']);
    });

    it('handles nodes with undefined inputs', () => {
        const nodes = [n('a', undefined), n('b', ['a'])];
        assert.deepStrictEqual(leaves(nodes), ['b']);
    });

    it('returns an empty set for an empty or missing graph', () => {
        assert.strictEqual(getLeafNodeIds({ nodes: [] } as any).size, 0);
        assert.strictEqual(getLeafNodeIds(null).size, 0);
        assert.strictEqual(getLeafNodeIds(undefined).size, 0);
    });

    it('every node is a leaf when there are no edges', () => {
        const nodes = [n('a'), n('b'), n('c')];
        assert.deepStrictEqual(leaves(nodes), ['a', 'b', 'c']);
    });
});
