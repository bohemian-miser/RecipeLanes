import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { getDataService, setDataService, MemoryDataService } from '../lib/data-service';
import { calculateLayout } from '../lib/recipe-lanes/layout';
import type { RecipeGraph, RecipeNode } from '../lib/recipe-lanes/types';

// ── helpers ───────────────────────────────────────────────────────────────────

function ing(partial: Partial<RecipeNode> & { id: string }): RecipeNode {
  return { laneId: 'prep', text: partial.id, visualDescription: partial.id, type: 'ingredient', x: 0, y: 0, inputs: [], ...partial } as RecipeNode;
}

function act(partial: Partial<RecipeNode> & { id: string }): RecipeNode {
  return { laneId: 'prep', text: partial.id, visualDescription: partial.id, type: 'action', x: 0, y: 0, inputs: [], ...partial } as RecipeNode;
}

// Sample graph: onion (ing) → chop (action) → saute (action) → finish (action)
const sampleGraph: RecipeGraph = {
  title: 'Timeline Test Recipe',
  lanes: [
    { id: 'prep', label: 'prep', type: 'prep' },
    { id: 'cook', label: 'cook', type: 'cook' },
  ],
  nodes: [
    ing({ id: 'onion', laneId: 'prep' }),
    act({ id: 'chop', laneId: 'prep', inputs: ['onion'], duration: '3 min' }),
    act({ id: 'saute', laneId: 'cook', inputs: ['chop'], duration: '5 min' }),
    act({ id: 'finish', laneId: 'cook', inputs: ['saute'], duration: '2 min' }),
  ],
};

// ── Simulates what useSaveAndFork.getGraph() does ──────────────────────────────
//
// The UI runs calculateLayout to get initial positions, then ReactFlow nodes
// carry those positions. On save, getGraph() snapshots them into layouts[mode].
// Here we do the same computation without ReactFlow in the loop.

function buildGraphToSave(baseGraph: RecipeGraph, movedNodeId: string, dx: number, dy: number): RecipeGraph {
  const mode = 'timeline';

  // Step 1: run layout to get positions (same as react-flow-diagram.tsx runLayout)
  const layout = calculateLayout(baseGraph, mode);

  // Step 2: build a positions map from the layout (same as what RF node.position holds)
  const positions: Record<string, { x: number; y: number }> = {};
  for (const vn of layout.nodes) {
    positions[vn.id] = { x: vn.x, y: vn.y };
  }

  // Step 3: simulate a node drag — update the position of movedNodeId
  if (positions[movedNodeId]) {
    positions[movedNodeId] = {
      x: positions[movedNodeId].x + dx,
      y: positions[movedNodeId].y + dy,
    };
  }

  // Step 4: build layouts[mode] snapshot (same as useSaveAndFork.getGraph())
  const layouts: Record<string, { id: string; x: number; y: number }[]> = {
    ...(baseGraph.layouts ?? {}),
    [mode]: Object.entries(positions).map(([id, pos]) => ({ id, x: pos.x, y: pos.y })),
  };

  // Step 5: embed positions into nodes (same as useSaveAndFork.getGraph())
  const nodesWithPos = baseGraph.nodes.map(n => ({
    ...n,
    x: positions[n.id]?.x ?? n.x ?? 0,
    y: positions[n.id]?.y ?? n.y ?? 0,
  }));

  return { ...baseGraph, nodes: nodesWithPos, layouts, layoutMode: mode };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('timeline save / load round-trip', () => {
  beforeEach(() => {
    setDataService(new MemoryDataService());
  });

  it('persists layoutMode=timeline after save and reload', async () => {
    const graphToSave = buildGraphToSave(sampleGraph, 'saute', 0, 0);
    assert.strictEqual(graphToSave.layoutMode, 'timeline', 'layoutMode should be set before save');

    const service = getDataService();
    const id = await service.saveRecipe(graphToSave, undefined, 'test-user', 'unlisted');
    const loaded = await service.getRecipe(id);

    assert.ok(loaded, 'recipe should exist after save');
    assert.strictEqual(loaded!.graph.layoutMode, 'timeline', 'layoutMode should survive save/load');
  });

  it('persists node positions including a simulated drag', async () => {
    const dx = 42, dy = -17;
    const graphToSave = buildGraphToSave(sampleGraph, 'saute', dx, dy);

    // Record the pre-save position for 'saute'
    const sauteBeforeSave = graphToSave.nodes.find(n => n.id === 'saute')!;

    const service = getDataService();
    const id = await service.saveRecipe(graphToSave, undefined, 'test-user', 'unlisted');
    const loaded = await service.getRecipe(id);

    assert.ok(loaded, 'recipe should exist after save');
    const sauteAfterLoad = loaded!.graph.nodes.find(n => n.id === 'saute')!;
    assert.ok(sauteAfterLoad, 'saute node should exist in loaded graph');
    assert.strictEqual(sauteAfterLoad.x, sauteBeforeSave.x, 'saute x should be preserved');
    assert.strictEqual(sauteAfterLoad.y, sauteBeforeSave.y, 'saute y should be preserved');
  });

  it('persists the layouts[timeline] map with per-node positions', async () => {
    const dx = 100, dy = 50;
    const graphToSave = buildGraphToSave(sampleGraph, 'finish', dx, dy);

    const service = getDataService();
    const id = await service.saveRecipe(graphToSave, undefined, 'test-user', 'unlisted');
    const loaded = await service.getRecipe(id);

    const tlLayouts = loaded!.graph.layouts?.['timeline'];
    assert.ok(tlLayouts && tlLayouts.length > 0, 'layouts.timeline should be populated');

    const finishEntry = tlLayouts!.find((e: any) => e.id === 'finish');
    const expectedFinish = graphToSave.layouts!['timeline'].find(e => e.id === 'finish');
    assert.ok(finishEntry, 'finish entry should be in layouts.timeline');
    assert.strictEqual(finishEntry!.x, expectedFinish!.x, 'finish x should match saved value');
    assert.strictEqual(finishEntry!.y, expectedFinish!.y, 'finish y should match saved value');
  });

  it('each node in layouts.timeline has distinct positions (layout ran)', async () => {
    const graphToSave = buildGraphToSave(sampleGraph, 'chop', 0, 0);
    const tlLayouts = graphToSave.layouts!['timeline'];

    // All action nodes should have non-zero x (timeline lays them out horizontally)
    const actionEntries = tlLayouts.filter(e => sampleGraph.nodes.find(n => n.id === e.id && n.type === 'action'));
    assert.ok(actionEntries.length >= 2, 'should have at least 2 action entries in layouts');
    const xs = actionEntries.map(e => e.x);
    const allSame = xs.every(x => x === xs[0]);
    assert.ok(!allSame, 'action nodes should have different x positions in timeline layout');
  });
});
