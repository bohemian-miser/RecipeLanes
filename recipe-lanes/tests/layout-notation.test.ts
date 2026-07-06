import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateNotationLayout } from '../lib/recipe-lanes/layout-notation';
import type { RecipeGraph } from '../lib/recipe-lanes/types';

// Fixture: 2 lanes, 4 actions, 3 leaves, one cross-lane edge.
//
//   lane1 (Pan):  leaf1 --chop--> action1 --\
//                 leaf2 -------------------> action2(heat) --\
//   lane2 (Pot):  leaf3 --boil--> action3 ------------------> action4(assemble, in lane1)
//
// action4 depends on action2 (same lane -> spine) and action3 (cross-lane -> cross).
function buildGraph(): RecipeGraph {
    return {
        lanes: [
            { id: 'lane1', label: 'Pan', type: 'cook' },
            { id: 'lane2', label: 'Pot', type: 'cook' },
        ],
        nodes: [
            { id: 'leaf1', laneId: 'lane1', type: 'ingredient', text: 'garlic', visualDescription: 'garlic' },
            { id: 'leaf2', laneId: 'lane1', type: 'ingredient', text: 'oil', visualDescription: 'oil' },
            { id: 'leaf3', laneId: 'lane2', type: 'ingredient', text: 'noodles', visualDescription: 'noodles' },
            { id: 'action1', laneId: 'lane1', type: 'action', text: 'Chop garlic', visualDescription: '', inputs: ['leaf1'] },
            { id: 'action2', laneId: 'lane1', type: 'action', text: 'Heat oil and add garlic', visualDescription: '', inputs: ['leaf2', 'action1'] },
            { id: 'action3', laneId: 'lane2', type: 'action', text: 'Boil noodles', visualDescription: '', inputs: ['leaf3'] },
            { id: 'action4', laneId: 'lane1', type: 'action', text: 'Assemble the dish', visualDescription: '', inputs: ['action2', 'action3'] },
        ],
    };
}

describe('calculateNotationLayout', () => {
    const graph = buildGraph();
    const layout = calculateNotationLayout(graph);
    const byId = new Map(layout.nodes.map(n => [n.id, n]));

    it('gives each lane row a distinct y', () => {
        const station1 = byId.get('notation-station-lane1')!;
        const station2 = byId.get('notation-station-lane2')!;
        assert.notStrictEqual(station1.y, station2.y);
    });

    it('orders same-lane actions topologically, left to right', () => {
        const a1 = byId.get('action1')!;
        const a2 = byId.get('action2')!;
        const a4 = byId.get('action4')!;
        assert.ok(a1.x < a2.x, 'action1 (depth 1) should be left of action2 (depth 2)');
        assert.ok(a2.x < a4.x, 'action2 (depth 2) should be left of action4 (depth 3)');
    });

    it('floats each leaf above its consumer, near its consumer x', () => {
        const leaf1 = byId.get('leaf1')!;
        const action1 = byId.get('action1')!;
        assert.ok(leaf1.y < action1.y, 'leaf1 should be above its consumer');
        assert.ok(Math.abs((leaf1.x + leaf1.width / 2) - (action1.x + action1.width / 2)) <= 40);

        const leaf2 = byId.get('leaf2')!;
        const action2 = byId.get('action2')!;
        assert.ok(leaf2.y < action2.y, 'leaf2 should be above its consumer');

        const leaf3 = byId.get('leaf3')!;
        const action3 = byId.get('action3')!;
        assert.ok(leaf3.y < action3.y, 'leaf3 should be above its consumer');
    });

    it('classifies edge kinds correctly', () => {
        const kindOf = (sourceId: string, targetId: string) =>
            layout.edges.find(e => e.sourceId === sourceId && e.targetId === targetId)?.kind;

        assert.strictEqual(kindOf('leaf1', 'action1'), 'drop');
        assert.strictEqual(kindOf('leaf2', 'action2'), 'drop');
        assert.strictEqual(kindOf('leaf3', 'action3'), 'drop');
        assert.strictEqual(kindOf('action1', 'action2'), 'spine'); // same lane
        assert.strictEqual(kindOf('action2', 'action4'), 'spine'); // same lane
        assert.strictEqual(kindOf('action3', 'action4'), 'cross'); // lane2 -> lane1
    });

    it('assigns roles correctly', () => {
        assert.strictEqual(byId.get('leaf1')!.role, 'leaf');
        assert.strictEqual(byId.get('leaf2')!.role, 'leaf');
        assert.strictEqual(byId.get('leaf3')!.role, 'leaf');
        assert.strictEqual(byId.get('action1')!.role, 'verb'); // "Chop" matches
        assert.strictEqual(byId.get('action2')!.role, 'verb'); // "Heat" matches
        assert.strictEqual(byId.get('action3')!.role, 'verb'); // "Boil" matches
        assert.strictEqual(byId.get('action4')!.role, 'state'); // "Assemble" matches nothing
        assert.strictEqual(byId.get('notation-station-lane1')!.role, 'station');
        assert.strictEqual(byId.get('notation-station-lane2')!.role, 'station');
    });

    it('produces finite, non-overlapping-in-principle bounds', () => {
        assert.ok(layout.width > 0);
        assert.ok(layout.height > 0);
        assert.ok(Number.isFinite(layout.width));
        assert.ok(Number.isFinite(layout.height));
    });

    it('handles an empty graph without throwing', () => {
        const empty = calculateNotationLayout({ lanes: [], nodes: [] });
        assert.strictEqual(empty.nodes.length, 0);
        assert.strictEqual(empty.edges.length, 0);
    });
});
