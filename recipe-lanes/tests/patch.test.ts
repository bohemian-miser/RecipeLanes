import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch } from '../lib/recipe-lanes/model-utils';
import type { RecipeGraph, RecipeNode, RecipePatch } from '../lib/recipe-lanes/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function node(id: string, overrides: Partial<RecipeNode> = {}): RecipeNode {
    return {
        id,
        laneId: 'lane-a',
        text: id,
        visualDescription: `${id}-visual`,
        type: 'ingredient',
        ...overrides,
    };
}

function graph(nodes: RecipeNode[], laneIds: string[] = ['lane-a']): RecipeGraph {
    return {
        title: 'Test Recipe',
        nodes,
        lanes: laneIds.map(id => ({ id, label: id, type: 'prep' })),
    };
}

function ids(g: RecipeGraph) {
    return g.nodes.map(n => n.id);
}

function find(g: RecipeGraph, id: string) {
    const n = g.nodes.find(n => n.id === id);
    if (!n) throw new Error(`Node ${id} not found`);
    return n;
}

function laneIds(g: RecipeGraph) {
    return g.lanes.map(l => l.id);
}

// ---------------------------------------------------------------------------
// Empty / no-op patches
// ---------------------------------------------------------------------------

describe('applyPatch — no-op', () => {
    it('empty patch returns same node count', () => {
        const g = graph([node('a'), node('b')]);
        const result = applyPatch(g, { message: 'nothing' });
        assert.deepEqual(ids(result), ['a', 'b']);
    });

    it('preserves title when updateTitle absent', () => {
        const g = graph([node('a')]);
        const result = applyPatch(g, { message: 'x' });
        assert.equal(result.title, 'Test Recipe');
    });

    it('preserves lanes when no lane ops', () => {
        const g = graph([node('a')], ['lane-a', 'lane-b']);
        const result = applyPatch(g, { message: 'x' });
        assert.deepEqual(laneIds(result), ['lane-a', 'lane-b']);
    });
});

// ---------------------------------------------------------------------------
// updateTitle
// ---------------------------------------------------------------------------

describe('applyPatch — updateTitle', () => {
    it('updates the recipe title', () => {
        const g = graph([node('a')]);
        const result = applyPatch(g, { message: 'x', updateTitle: 'New Title' });
        assert.equal(result.title, 'New Title');
    });

    it('explicit empty string clears title', () => {
        const g = graph([node('a')]);
        const result = applyPatch(g, { message: 'x', updateTitle: '' });
        assert.equal(result.title, '');
    });
});

// ---------------------------------------------------------------------------
// addNodes
// ---------------------------------------------------------------------------

describe('applyPatch — addNodes', () => {
    it('appends a single new node', () => {
        const g = graph([node('a')]);
        const result = applyPatch(g, {
            message: 'add b',
            addNodes: [{ id: 'b', laneId: 'lane-a', text: 'b', visualDescription: 'b-vis', type: 'ingredient' }],
        });
        assert.deepEqual(ids(result), ['a', 'b']);
    });

    it('marks new nodes as pending', () => {
        const g = graph([]);
        const result = applyPatch(g, {
            message: 'add',
            addNodes: [{ id: 'x', laneId: 'lane-a', text: 'x', visualDescription: 'x', type: 'action' }],
        });
        assert.equal(find(result, 'x').status, 'pending');
    });

    it('appends multiple new nodes', () => {
        const g = graph([node('a')]);
        const result = applyPatch(g, {
            message: 'add bc',
            addNodes: [
                { id: 'b', laneId: 'lane-a', text: 'b', visualDescription: 'b', type: 'ingredient' },
                { id: 'c', laneId: 'lane-a', text: 'c', visualDescription: 'c', type: 'action' },
            ],
        });
        assert.deepEqual(ids(result), ['a', 'b', 'c']);
    });

    it('new node with inputs referencing existing nodes', () => {
        const g = graph([node('a'), node('b')]);
        const result = applyPatch(g, {
            message: 'add c',
            addNodes: [{ id: 'c', laneId: 'lane-a', text: 'c', visualDescription: 'c', type: 'action', inputs: ['a', 'b'] }],
        });
        assert.deepEqual(find(result, 'c').inputs, ['a', 'b']);
    });

    it('new node has no position (layout algo handles it)', () => {
        const g = graph([node('a', { x: 100, y: 200 })]);
        const result = applyPatch(g, {
            message: 'add',
            addNodes: [{ id: 'b', laneId: 'lane-a', text: 'b', visualDescription: 'b', type: 'ingredient' }],
        });
        assert.equal(find(result, 'b').x, undefined);
        assert.equal(find(result, 'b').y, undefined);
    });
});

// ---------------------------------------------------------------------------
// removeNodeIds
// ---------------------------------------------------------------------------

describe('applyPatch — removeNodeIds', () => {
    it('removes a single node', () => {
        const g = graph([node('a'), node('b'), node('c')]);
        const result = applyPatch(g, { message: 'rm b', removeNodeIds: ['b'] });
        assert.deepEqual(ids(result), ['a', 'c']);
    });

    it('removes multiple nodes', () => {
        const g = graph([node('a'), node('b'), node('c')]);
        const result = applyPatch(g, { message: 'rm', removeNodeIds: ['a', 'c'] });
        assert.deepEqual(ids(result), ['b']);
    });

    it('ignores non-existent ids gracefully', () => {
        const g = graph([node('a'), node('b')]);
        const result = applyPatch(g, { message: 'rm', removeNodeIds: ['z'] });
        assert.deepEqual(ids(result), ['a', 'b']);
    });

    it('cleans dangling inputs on surviving nodes', () => {
        const g = graph([node('a'), node('b', { inputs: ['a'] }), node('c', { inputs: ['b'] })]);
        const result = applyPatch(g, { message: 'rm a', removeNodeIds: ['a'] });
        assert.deepEqual(find(result, 'b').inputs, []);
        assert.deepEqual(find(result, 'c').inputs, ['b']);
    });

    it('cleans inputs when multiple nodes removed', () => {
        const g = graph([
            node('a'),
            node('b'),
            node('c', { inputs: ['a', 'b'] }),
        ]);
        const result = applyPatch(g, { message: 'rm ab', removeNodeIds: ['a', 'b'] });
        assert.deepEqual(find(result, 'c').inputs, []);
    });

    it('surviving node keeps inputs that are not removed', () => {
        const g = graph([
            node('a'),
            node('b'),
            node('c', { inputs: ['a', 'b'] }),
        ]);
        const result = applyPatch(g, { message: 'rm a', removeNodeIds: ['a'] });
        assert.deepEqual(find(result, 'c').inputs, ['b']);
    });
});

// ---------------------------------------------------------------------------
// updateNodes
// ---------------------------------------------------------------------------

describe('applyPatch — updateNodes', () => {
    it('updates text on a node', () => {
        const g = graph([node('a', { text: 'old' })]);
        const result = applyPatch(g, { message: 'upd', updateNodes: [{ id: 'a', text: 'new' }] });
        assert.equal(find(result, 'a').text, 'new');
    });

    it('preserves fields not mentioned in update', () => {
        const g = graph([node('a', { text: 'old', quantity: 2, unit: 'cups' })]);
        const result = applyPatch(g, { message: 'upd', updateNodes: [{ id: 'a', text: 'new' }] });
        assert.equal(find(result, 'a').quantity, 2);
        assert.equal(find(result, 'a').unit, 'cups');
    });

    it('clears inputs by setting to empty array (disconnect)', () => {
        const g = graph([
            node('a'),
            node('b', { inputs: ['a'] }),
        ]);
        const result = applyPatch(g, { message: 'disconnect', updateNodes: [{ id: 'b', inputs: [] }] });
        assert.deepEqual(find(result, 'b').inputs, []);
    });

    it('replaces inputs with new set', () => {
        const g = graph([node('a'), node('b'), node('c', { inputs: ['a'] })]);
        const result = applyPatch(g, { message: 'rewire', updateNodes: [{ id: 'c', inputs: ['b'] }] });
        assert.deepEqual(find(result, 'c').inputs, ['b']);
    });

    it('moves node to different lane', () => {
        const g = graph([node('a', { laneId: 'lane-a' })], ['lane-a', 'lane-b']);
        const result = applyPatch(g, { message: 'move', updateNodes: [{ id: 'a', laneId: 'lane-b' }] });
        assert.equal(find(result, 'a').laneId, 'lane-b');
    });

    it('updates quantity and unit', () => {
        const g = graph([node('a', { quantity: 1, unit: 'cup' })]);
        const result = applyPatch(g, { message: 'upd', updateNodes: [{ id: 'a', quantity: 2, unit: 'tbsp' }] });
        assert.equal(find(result, 'a').quantity, 2);
        assert.equal(find(result, 'a').unit, 'tbsp');
    });

    it('updates temperature and duration on action node', () => {
        const g = graph([node('a', { type: 'action' })]);
        const result = applyPatch(g, {
            message: 'upd',
            updateNodes: [{ id: 'a', temperature: '180°C', duration: '30 min' }],
        });
        assert.equal(find(result, 'a').temperature, '180°C');
        assert.equal(find(result, 'a').duration, '30 min');
    });

    it('ignores update for non-existent node id', () => {
        const g = graph([node('a')]);
        const result = applyPatch(g, { message: 'upd', updateNodes: [{ id: 'z', text: 'ghost' }] });
        assert.deepEqual(ids(result), ['a']);
    });

    it('updates multiple nodes in one patch', () => {
        const g = graph([node('a', { text: 'old-a' }), node('b', { text: 'old-b' })]);
        const result = applyPatch(g, {
            message: 'upd',
            updateNodes: [{ id: 'a', text: 'new-a' }, { id: 'b', text: 'new-b' }],
        });
        assert.equal(find(result, 'a').text, 'new-a');
        assert.equal(find(result, 'b').text, 'new-b');
    });
});

// ---------------------------------------------------------------------------
// Lane operations
// ---------------------------------------------------------------------------

describe('applyPatch — lane ops', () => {
    it('adds a new lane', () => {
        const g = graph([node('a')], ['lane-a']);
        const result = applyPatch(g, {
            message: 'add lane',
            addLanes: [{ id: 'lane-b', label: 'Cook', type: 'cook' }],
        });
        assert.deepEqual(laneIds(result), ['lane-a', 'lane-b']);
    });

    it('removes a lane', () => {
        const g = graph([node('a')], ['lane-a', 'lane-b']);
        const result = applyPatch(g, { message: 'rm lane', removeLaneIds: ['lane-b'] });
        assert.deepEqual(laneIds(result), ['lane-a']);
    });

    it('adds and removes lanes in one patch', () => {
        const g = graph([node('a')], ['lane-a', 'lane-b']);
        const result = applyPatch(g, {
            message: 'swap lanes',
            addLanes: [{ id: 'lane-c', label: 'Serve', type: 'serve' }],
            removeLaneIds: ['lane-b'],
        });
        assert.deepEqual(laneIds(result), ['lane-a', 'lane-c']);
    });

    it('ignores removeLaneIds for non-existent lane', () => {
        const g = graph([node('a')], ['lane-a']);
        const result = applyPatch(g, { message: 'rm', removeLaneIds: ['ghost-lane'] });
        assert.deepEqual(laneIds(result), ['lane-a']);
    });
});

// ---------------------------------------------------------------------------
// Merge nodes (add combined + remove sources)
// ---------------------------------------------------------------------------

describe('applyPatch — merge nodes', () => {
    it('two-node merge: removes sources, adds merged result', () => {
        const g = graph([node('salt'), node('pepper'), node('chicken', { inputs: ['salt', 'pepper'] })]);
        const result = applyPatch(g, {
            message: 'merge',
            addNodes: [{ id: 'seasoning', laneId: 'lane-a', text: 'Salt & Pepper', visualDescription: 'seasoning', type: 'ingredient' }],
            removeNodeIds: ['salt', 'pepper'],
        });
        assert.deepEqual(ids(result), ['chicken', 'seasoning']);
    });

    it('surviving node inputs updated after merge', () => {
        const g = graph([node('salt'), node('pepper'), node('chicken', { inputs: ['salt', 'pepper'] })]);
        const result = applyPatch(g, {
            message: 'merge',
            addNodes: [{ id: 'seasoning', laneId: 'lane-a', text: 'Salt & Pepper', visualDescription: 'seasoning', type: 'ingredient' }],
            removeNodeIds: ['salt', 'pepper'],
        });
        // chicken's inputs referencing removed nodes should be cleaned
        assert.deepEqual(find(result, 'chicken').inputs, []);
    });

    it('merged node inputs referencing removed source nodes are cleaned', () => {
        // The merged node "seasoning" has inputs: ['salt', 'pepper'] but both are removed.
        // applyPatch must clean those dangling refs on the new node too.
        const g = graph([node('salt'), node('pepper')]);
        const result = applyPatch(g, {
            message: 'merge',
            addNodes: [{
                id: 'seasoning',
                laneId: 'lane-a',
                text: 'Salt & Pepper',
                visualDescription: 'seasoning',
                type: 'ingredient',
                inputs: ['salt', 'pepper'],
            }],
            removeNodeIds: ['salt', 'pepper'],
        });
        // seasoning should have its inputs cleaned since both source nodes are removed
        assert.deepEqual(find(result, 'seasoning').inputs, []);
    });

    it('merged node keeps inputs that reference surviving nodes', () => {
        const g = graph([node('base'), node('salt'), node('pepper')]);
        const result = applyPatch(g, {
            message: 'merge',
            addNodes: [{
                id: 'seasoning',
                laneId: 'lane-a',
                text: 'seasoning',
                visualDescription: 'seasoning',
                type: 'ingredient',
                inputs: ['base', 'salt', 'pepper'],
            }],
            removeNodeIds: ['salt', 'pepper'],
        });
        assert.deepEqual(find(result, 'seasoning').inputs, ['base']);
    });

    it('three-node merge', () => {
        const g = graph([node('a'), node('b'), node('c'), node('d', { inputs: ['a', 'b', 'c'] })]);
        const result = applyPatch(g, {
            message: 'merge abc',
            addNodes: [{ id: 'abc', laneId: 'lane-a', text: 'abc', visualDescription: 'abc', type: 'action', inputs: ['a', 'b', 'c'] }],
            removeNodeIds: ['a', 'b', 'c'],
        });
        assert.deepEqual(ids(result), ['d', 'abc']);
        assert.deepEqual(find(result, 'd').inputs, []);
        assert.deepEqual(find(result, 'abc').inputs, []);
    });
});

// ---------------------------------------------------------------------------
// Disconnect (inputs cleared on specific node)
// ---------------------------------------------------------------------------

describe('applyPatch — disconnect node', () => {
    it('disconnects a node that is downstream of others', () => {
        const g = graph([
            node('pasta'),
            node('boil', { inputs: ['pasta'] }),
            node('drain', { inputs: ['boil'] }),
            node('mix', { inputs: ['drain'] }),
            node('serve', { inputs: ['mix'] }),
            node('chicken', { inputs: ['serve'] }),
        ]);
        // Disconnect chicken from the pasta chain
        const result = applyPatch(g, {
            message: 'disconnect',
            updateNodes: [{ id: 'chicken', inputs: [] }],
        });
        assert.deepEqual(find(result, 'chicken').inputs, []);
        // rest of pasta chain untouched
        assert.deepEqual(find(result, 'serve').inputs, ['mix']);
    });

    it('disconnect + update other fields together', () => {
        const g = graph([node('a'), node('b', { inputs: ['a'], text: 'old' })]);
        const result = applyPatch(g, {
            message: 'upd',
            updateNodes: [{ id: 'b', inputs: [], text: 'new' }],
        });
        assert.deepEqual(find(result, 'b').inputs, []);
        assert.equal(find(result, 'b').text, 'new');
    });
});

// ---------------------------------------------------------------------------
// Combined patch operations
// ---------------------------------------------------------------------------

describe('applyPatch — combined ops', () => {
    it('add + remove + update in one patch', () => {
        const g = graph([node('a', { text: 'old' }), node('b'), node('c')]);
        const result = applyPatch(g, {
            message: 'combined',
            addNodes: [{ id: 'd', laneId: 'lane-a', text: 'd', visualDescription: 'd', type: 'ingredient' }],
            removeNodeIds: ['c'],
            updateNodes: [{ id: 'a', text: 'updated' }],
        });
        assert.deepEqual(ids(result), ['a', 'b', 'd']);
        assert.equal(find(result, 'a').text, 'updated');
    });

    it('add node + add lane together', () => {
        const g = graph([node('a')], ['lane-a']);
        const result = applyPatch(g, {
            message: 'add to new lane',
            addLanes: [{ id: 'lane-b', label: 'Cook', type: 'cook' }],
            addNodes: [{ id: 'b', laneId: 'lane-b', text: 'b', visualDescription: 'b', type: 'action' }],
        });
        assert.deepEqual(laneIds(result), ['lane-a', 'lane-b']);
        assert.deepEqual(ids(result), ['a', 'b']);
        assert.equal(find(result, 'b').laneId, 'lane-b');
    });

    it('remove node and remove its lane', () => {
        const g = graph([node('a', { laneId: 'lane-b' }), node('b')], ['lane-a', 'lane-b']);
        const result = applyPatch(g, {
            message: 'remove',
            removeNodeIds: ['a'],
            removeLaneIds: ['lane-b'],
        });
        assert.deepEqual(ids(result), ['b']);
        assert.deepEqual(laneIds(result), ['lane-a']);
    });

    it('adding a parallel section preserves existing graph intact', () => {
        const g = graph([
            node('chicken', { laneId: 'lane-a' }),
            node('bake', { laneId: 'lane-a', inputs: ['chicken'] }),
        ], ['lane-a']);
        const result = applyPatch(g, {
            message: 'add potatoes',
            addLanes: [{ id: 'lane-b', label: 'Sides', type: 'cook' }],
            addNodes: [
                { id: 'potatoes', laneId: 'lane-b', text: 'potatoes', visualDescription: 'potatoes', type: 'ingredient' },
                { id: 'roast', laneId: 'lane-b', text: 'roast', visualDescription: 'roast', type: 'action', inputs: ['potatoes'] },
            ],
        });
        // Original nodes untouched
        assert.deepEqual(find(result, 'chicken').inputs, undefined);
        assert.deepEqual(find(result, 'bake').inputs, ['chicken']);
        // New nodes present
        assert.deepEqual(find(result, 'roast').inputs, ['potatoes']);
        assert.equal(result.nodes.length, 4);
    });
});

// ---------------------------------------------------------------------------
// Icon shortlist preservation
// ---------------------------------------------------------------------------

describe('applyPatch — icon shortlist preservation', () => {
    it('preserves iconShortlist on surviving nodes', () => {
        const shortlist = [{ icon: { id: 'icon-1', path: 'p' } as any, source: 'generated' as const, matchType: 'generated' as const }];
        const g = graph([
            node('a', { iconShortlist: shortlist }),
            node('b'),
        ]);
        const result = applyPatch(g, {
            message: 'upd',
            updateNodes: [{ id: 'a', text: 'updated' }],
        });
        assert.deepEqual(find(result, 'a').iconShortlist, shortlist);
    });

    it('shortlist not copied to new nodes (they start pending)', () => {
        const shortlist = [{ icon: { id: 'icon-1', path: 'p' } as any, source: 'generated' as const, matchType: 'generated' as const }];
        const g = graph([node('a', { iconShortlist: shortlist })]);
        const result = applyPatch(g, {
            message: 'add',
            addNodes: [{ id: 'b', laneId: 'lane-a', text: 'b', visualDescription: 'b', type: 'ingredient' }],
        });
        assert.equal(find(result, 'b').iconShortlist, undefined);
        assert.equal(find(result, 'b').status, 'pending');
    });
});

// ---------------------------------------------------------------------------
// Full-graph scenario: recipe with parallel sections
// ---------------------------------------------------------------------------

describe('applyPatch — full recipe scenarios', () => {
    function chickenPastaGraph(): RecipeGraph {
        return {
            title: 'Chicken Parmy',
            lanes: [
                { id: 'prep', label: 'Prep', type: 'prep' },
                { id: 'cook', label: 'Cook', type: 'cook' },
                { id: 'pasta-lane', label: 'Pasta', type: 'cook' },
            ],
            nodes: [
                node('chicken',   { laneId: 'prep', type: 'ingredient' }),
                node('bread',     { laneId: 'prep', type: 'ingredient' }),
                node('bread_chicken', { laneId: 'prep', type: 'action', inputs: ['chicken', 'bread'] }),
                node('bake',      { laneId: 'cook', type: 'action', inputs: ['bread_chicken'] }),
                node('pasta',     { laneId: 'pasta-lane', type: 'ingredient' }),
                node('boil',      { laneId: 'pasta-lane', type: 'action', inputs: ['pasta'] }),
                node('drain',     { laneId: 'pasta-lane', type: 'action', inputs: ['boil'] }),
                node('serve',     { laneId: 'pasta-lane', type: 'action', inputs: ['drain', 'bake'] }),
            ],
        };
    }

    it('disconnect pasta from chicken: clear bake from serve inputs', () => {
        const g = chickenPastaGraph();
        const result = applyPatch(g, {
            message: 'disconnect',
            updateNodes: [{ id: 'serve', inputs: ['drain'] }],
        });
        assert.deepEqual(find(result, 'serve').inputs, ['drain']);
        assert.deepEqual(find(result, 'bake').inputs, ['bread_chicken']); // untouched
    });

    it('fully disconnect pasta section: serve has no inputs from chicken', () => {
        const g = chickenPastaGraph();
        const result = applyPatch(g, {
            message: 'disconnect fully',
            updateNodes: [{ id: 'serve', inputs: [] }],
        });
        assert.deepEqual(find(result, 'serve').inputs, []);
    });

    it('remove pasta section entirely', () => {
        const g = chickenPastaGraph();
        const result = applyPatch(g, {
            message: 'rm pasta',
            removeNodeIds: ['pasta', 'boil', 'drain', 'serve'],
            removeLaneIds: ['pasta-lane'],
        });
        assert.deepEqual(ids(result), ['chicken', 'bread', 'bread_chicken', 'bake']);
        assert.deepEqual(laneIds(result), ['prep', 'cook']);
    });

    it('add a glaze step between bake and serve', () => {
        const g = chickenPastaGraph();
        const result = applyPatch(g, {
            message: 'add glaze',
            addNodes: [{
                id: 'glaze',
                laneId: 'cook',
                text: 'Add glaze',
                visualDescription: 'glaze being applied',
                type: 'action',
                inputs: ['bake'],
            }],
            updateNodes: [{ id: 'serve', inputs: ['drain', 'glaze'] }],
        });
        assert.equal(result.nodes.length, 9);
        assert.deepEqual(find(result, 'glaze').inputs, ['bake']);
        assert.deepEqual(find(result, 'serve').inputs, ['drain', 'glaze']);
    });

    it('rename title + update serves', () => {
        const g = { ...chickenPastaGraph(), serves: 2 };
        const result = applyPatch(g, {
            message: 'upd',
            updateTitle: 'Chicken Parmy for 4',
        });
        assert.equal(result.title, 'Chicken Parmy for 4');
    });

    it('merge chicken and bread into "breaded chicken" ingredient', () => {
        const g = chickenPastaGraph();
        const result = applyPatch(g, {
            message: 'merge',
            addNodes: [{
                id: 'breaded_chicken',
                laneId: 'prep',
                text: 'Breaded Chicken',
                visualDescription: 'breaded chicken breast',
                type: 'ingredient',
                inputs: ['chicken', 'bread'],
            }],
            removeNodeIds: ['chicken', 'bread'],
        });
        // Sources removed
        assert.ok(!result.nodes.find(n => n.id === 'chicken'));
        assert.ok(!result.nodes.find(n => n.id === 'bread'));
        // bread_chicken's inputs now cleaned (both removed)
        assert.deepEqual(find(result, 'bread_chicken').inputs, []);
        // merged node's inputs pointing to removed sources also cleaned
        assert.deepEqual(find(result, 'breaded_chicken').inputs, []);
    });
});
