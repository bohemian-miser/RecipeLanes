import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getLeafNodeIds } from '../lib/recipe-lanes/leaf-nodes';

// Minimal node factory — only id/inputs matter for leaf detection.
const n = (id: string, inputs?: string[]) => ({ id, inputs });

const leaves = (nodes: ReturnType<typeof n>[]) =>
    [...getLeafNodeIds({ nodes } as any)].sort();

// A LEAF is a node with no incoming edge (in-degree 0): its `inputs` is
// empty/absent. These are the entry-point nodes (raw ingredients).
describe('getLeafNodeIds', () => {
    it('treats the source node of a chain as the only leaf', () => {
        // a -> b -> c  (b.inputs=[a], c.inputs=[b]). Only a has no incoming edge.
        const nodes = [n('a'), n('b', ['a']), n('c', ['b'])];
        assert.deepStrictEqual(leaves(nodes), ['a']);
    });

    it('marks all no-input sources as leaves when they fan out', () => {
        // a -> c, b -> c, c -> d. a and b have no incoming edge.
        const nodes = [n('a'), n('b'), n('c', ['a', 'b']), n('d', ['c'])];
        assert.deepStrictEqual(leaves(nodes), ['a', 'b']);
    });

    it('a node with any incoming edge is not a leaf', () => {
        // a -> b, a -> c. Only a is a leaf; b and c each have an incoming edge.
        const nodes = [n('a'), n('b', ['a']), n('c', ['a'])];
        assert.deepStrictEqual(leaves(nodes), ['a']);
    });

    it('an isolated node (no inputs, no consumers) is a leaf', () => {
        const nodes = [n('lonely'), n('a'), n('b', ['a'])];
        assert.deepStrictEqual(leaves(nodes), ['a', 'lonely']);
    });

    it('treats undefined and empty inputs the same', () => {
        const nodes = [n('a', undefined), n('b', []), n('c', ['a'])];
        assert.deepStrictEqual(leaves(nodes), ['a', 'b']);
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
