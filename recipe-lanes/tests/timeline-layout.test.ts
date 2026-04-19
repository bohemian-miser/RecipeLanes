import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseDurationMins,
  topoSort,
  buildTimelineLayout,
  TL,
} from '../lib/recipe-lanes/timeline-layout';
import type { RecipeGraph, RecipeNode } from '../lib/recipe-lanes/types';

// ── helpers ──────────────────────────────────────────────────────────────────

function ing(partial: Partial<RecipeNode> & { id: string }): RecipeNode {
  return { laneId: 'lane-1', text: partial.id, visualDescription: partial.id, type: 'ingredient', x: 0, y: 0, inputs: [], ...partial } as RecipeNode;
}

function act(partial: Partial<RecipeNode> & { id: string }): RecipeNode {
  return { laneId: 'lane-1', text: partial.id, visualDescription: partial.id, type: 'action',     x: 0, y: 0, inputs: [], ...partial } as RecipeNode;
}

function makeGraph(nodes: RecipeNode[], laneTypes: ('prep'|'cook'|'serve')[] = ['prep','cook']): RecipeGraph {
  return {
    lanes: laneTypes.map((t, i) => ({ id: `lane-${i + 1}`, label: t, type: t })),
    nodes,
  };
}

// ── parseDurationMins ─────────────────────────────────────────────────────────

describe('parseDurationMins', () => {
  it('extracts number from "10 min"', () => {
    assert.strictEqual(parseDurationMins(act({ id: 'a', duration: '10 min' })), 10);
  });
  it('extracts decimal from "2.5 minutes"', () => {
    assert.strictEqual(parseDurationMins(act({ id: 'a', duration: '2.5 minutes' })), 2.5);
  });
  it('extracts first number from "10-15 min"', () => {
    assert.strictEqual(parseDurationMins(act({ id: 'a', duration: '10-15 min' })), 10);
  });
  it('defaults to 1 for ingredient with no duration', () => {
    assert.strictEqual(parseDurationMins(ing({ id: 'a' })), 1);
  });
  it('defaults to 5 for action with no duration', () => {
    assert.strictEqual(parseDurationMins(act({ id: 'a' })), 5);
  });
  it('clamps very small durations to 0.5', () => {
    assert.strictEqual(parseDurationMins(act({ id: 'a', duration: '0' })), 0.5);
  });
});

// ── topoSort ──────────────────────────────────────────────────────────────────

describe('topoSort', () => {
  it('sorts a simple chain A → B → C', () => {
    const nodes = [act({ id: 'C', inputs: ['B'] }), act({ id: 'A' }), act({ id: 'B', inputs: ['A'] })];
    const sorted = topoSort(nodes);
    assert.ok(sorted.indexOf('A') < sorted.indexOf('B'));
    assert.ok(sorted.indexOf('B') < sorted.indexOf('C'));
  });

  it('handles nodes with no inputs', () => {
    const sorted = topoSort([act({ id: 'X' }), act({ id: 'Y' })]);
    assert.strictEqual(sorted.length, 2);
  });

  it('handles diamond: A → B, A → C, B → D, C → D', () => {
    const nodes = [act({ id: 'A' }), act({ id: 'B', inputs: ['A'] }), act({ id: 'C', inputs: ['A'] }), act({ id: 'D', inputs: ['B','C'] })];
    const sorted = topoSort(nodes);
    assert.ok(sorted.indexOf('A') < sorted.indexOf('B'));
    assert.ok(sorted.indexOf('A') < sorted.indexOf('C'));
    assert.ok(sorted.indexOf('B') < sorted.indexOf('D'));
    assert.ok(sorted.indexOf('C') < sorted.indexOf('D'));
  });

  it('does not throw on a cycle — includes all nodes', () => {
    const sorted = topoSort([act({ id: 'A', inputs: ['B'] }), act({ id: 'B', inputs: ['A'] })]);
    assert.strictEqual(sorted.length, 2);
  });
});

// ── buildTimelineLayout ───────────────────────────────────────────────────────

describe('buildTimelineLayout', () => {
  it('returns empty layout for empty graph', () => {
    const layout = buildTimelineLayout(makeGraph([]));
    assert.strictEqual(layout.nodes.length, 0);
    assert.strictEqual(layout.edges.length, 0);
    assert.strictEqual(layout.totalMinutes, 0);
  });

  it('assigns start time 0 to a root node', () => {
    const layout = buildTimelineLayout(makeGraph([act({ id: 'A' })]));
    assert.strictEqual(layout.nodes[0].startMin, 0);
  });

  it('assigns start time = predecessor end for an action chain', () => {
    const nodes  = [act({ id: 'A', duration: '10 min' }), act({ id: 'B', duration: '5 min', inputs: ['A'] })];
    const layout = buildTimelineLayout(makeGraph(nodes));
    const a = layout.nodes.find(n => n.id === 'A')!;
    const b = layout.nodes.find(n => n.id === 'B')!;
    assert.strictEqual(a.startMin, 0);
    assert.strictEqual(b.startMin, 10);
  });

  it('parallel action nodes land on different tracks', () => {
    // Two actions in the same lane, both starting at 0 — must not collide
    const nodes  = [act({ id: 'B', duration: '10 min' }), act({ id: 'C', duration: '10 min' })];
    const layout = buildTimelineLayout(makeGraph(nodes));
    const [tB, tC] = [layout.nodes.find(n => n.id === 'B')!.trackIndex, layout.nodes.find(n => n.id === 'C')!.trackIndex];
    assert.notStrictEqual(tB, tC);
  });

  it('non-overlapping actions share a track', () => {
    // A(0-5) → bridge(5-10) → C(10-15): A and C should share track 0
    const nodes = [
      act({ id: 'A', duration: '5 min' }),
      act({ id: 'bridge', duration: '5 min', inputs: ['A'] }),
      act({ id: 'C', duration: '5 min', inputs: ['bridge'] }),
    ];
    const layout = buildTimelineLayout(makeGraph(nodes));
    const a = layout.nodes.find(n => n.id === 'A')!;
    const c = layout.nodes.find(n => n.id === 'C')!;
    assert.strictEqual(a.trackIndex, c.trackIndex, 'A and C should reuse the same track');
  });

  it('creates an edge for every input connection', () => {
    const nodes  = [ing({ id: 'A' }), act({ id: 'B', inputs: ['A'] }), act({ id: 'C', inputs: ['A','B'] })];
    const layout = buildTimelineLayout(makeGraph(nodes));
    assert.strictEqual(layout.edges.length, 3);
  });

  it('spur edges connect ingredient to action', () => {
    const nodes  = [ing({ id: 'i1' }), act({ id: 'a1', inputs: ['i1'] })];
    const layout = buildTimelineLayout(makeGraph(nodes));
    const spur   = layout.edges.find(e => e.kind === 'spur');
    assert.ok(spur, 'should have a spur edge');
    assert.strictEqual(spur!.sourceId, 'i1');
    assert.strictEqual(spur!.targetId, 'a1');
  });

  it('chain edges connect action to action', () => {
    const nodes  = [act({ id: 'a1' }), act({ id: 'a2', inputs: ['a1'] })];
    const layout = buildTimelineLayout(makeGraph(nodes));
    const chain  = layout.edges.find(e => e.kind === 'chain');
    assert.ok(chain, 'should have a chain edge');
  });

  it('ingredient node cx aligns with its consumer action', () => {
    const nodes = [ing({ id: 'i1' }), act({ id: 'a1', duration: '10 min', inputs: ['i1'] })];
    const layout = buildTimelineLayout(makeGraph(nodes));
    const i1 = layout.nodes.find(n => n.id === 'i1')!;
    const a1 = layout.nodes.find(n => n.id === 'a1')!;
    // Single ingredient — should be centred above its consumer
    assert.strictEqual(i1.cx, a1.cx, 'single ingredient should share cx with its consumer action');
  });

  it('multiple ingredients are fanned around their consumer action cx', () => {
    const nodes = [
      ing({ id: 'i1' }),
      ing({ id: 'i2' }),
      ing({ id: 'i3' }),
      act({ id: 'a1', duration: '10 min', inputs: ['i1','i2','i3'] }),
    ];
    const layout = buildTimelineLayout(makeGraph(nodes));
    const a1 = layout.nodes.find(n => n.id === 'a1')!;
    const i1 = layout.nodes.find(n => n.id === 'i1')!;
    const i2 = layout.nodes.find(n => n.id === 'i2')!;
    const i3 = layout.nodes.find(n => n.id === 'i3')!;
    // All three should have distinct cx values
    assert.notStrictEqual(i1.cx, i2.cx);
    assert.notStrictEqual(i2.cx, i3.cx);
    // Middle ingredient should be centred on the action
    assert.strictEqual(i2.cx, a1.cx, 'middle ingredient should sit at action cx');
    // Ingredients should be symmetric around action
    assert.ok(Math.abs((a1.cx - i1.cx) - (i3.cx - a1.cx)) < 1, 'fan should be symmetric');
  });

  it('ingredient node cy is in the ingredient zone (above action tracks)', () => {
    const nodes  = [ing({ id: 'i1' }), act({ id: 'a1', inputs: ['i1'] })];
    const layout = buildTimelineLayout(makeGraph(nodes));
    const i1 = layout.nodes.find(n => n.id === 'i1')!;
    const a1 = layout.nodes.find(n => n.id === 'a1')!;
    assert.ok(i1.cy < layout.actionZoneY, 'ingredient cy should be above actionZoneY');
    assert.ok(i1.cy < a1.cy, 'ingredient should be visually above its action');
  });

  it('respects lane ordering from graph.lanes (action nodes)', () => {
    const nodes: RecipeNode[] = [
      act({ id: 'serve-step', laneId: 'lane-3' }),
      act({ id: 'prep-step',  laneId: 'lane-1' }),
    ];
    const graph: RecipeGraph = {
      lanes: [
        { id: 'lane-1', label: 'Prep',  type: 'prep'  },
        { id: 'lane-2', label: 'Cook',  type: 'cook'  },
        { id: 'lane-3', label: 'Serve', type: 'serve' },
      ],
      nodes,
    };
    const layout = buildTimelineLayout(graph);
    const prep  = layout.nodes.find(n => n.id === 'prep-step')!;
    const serve = layout.nodes.find(n => n.id === 'serve-step')!;
    assert.ok(prep.cy < serve.cy, 'prep lane should render above serve lane');
  });

  it('cx is greater for a later-starting action node', () => {
    const nodes  = [act({ id: 'A', duration: '10 min' }), act({ id: 'B', duration: '5 min', inputs: ['A'] })];
    const layout = buildTimelineLayout(makeGraph(nodes));
    const a = layout.nodes.find(n => n.id === 'A')!;
    const b = layout.nodes.find(n => n.id === 'B')!;
    assert.ok(b.cx > a.cx, 'B starts after A so should be to the right');
  });

  it('pixelsPerMin stays within bounds', () => {
    const nodes  = Array.from({ length: 5 }, (_, i) => act({ id: `n${i}`, duration: '60 min' }));
    const layout = buildTimelineLayout(makeGraph(nodes));
    assert.ok(layout.pixelsPerMin >= TL.MIN_PPM);
    assert.ok(layout.pixelsPerMin <= TL.MAX_PPM);
  });

  it('actionZoneY equals RULER_H + INGREDIENT_ZONE_H', () => {
    const layout = buildTimelineLayout(makeGraph([act({ id: 'x' })]));
    assert.strictEqual(layout.actionZoneY, TL.RULER_H + TL.INGREDIENT_ZONE_H);
  });
});
