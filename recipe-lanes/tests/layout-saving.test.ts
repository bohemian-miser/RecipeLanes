/**
 * Layout-saving regression tests.
 *
 * The reported production bug: user moves nodes, the app saves, but on reload
 * the coordinates are back in the original positions.
 *
 * Each test probes a distinct layer of the save→restore pipeline so that when
 * one fails we know exactly where the data is lost:
 *
 *  Layer A  buildGraphForSave          (data preparation before saveRecipeAction)
 *  Layer B  saveRecipeAction → getRecipe  (data-service roundtrip)
 *  Layer C  mergeSnapshot               (Zustand store integration after Firestore snap)
 *  Layer D  runLayout restore logic     (pure logic that determines node positions on load)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildGraphForSave } from '../components/recipe-lanes/hooks/useSaveAndFork';
import { useRecipeStore } from '../lib/stores/recipe-store';
import { getDataService, setDataService, MemoryDataService } from '../lib/data-service';
import { memoryStore } from '../lib/store';
import { setAuthService, MockAuthService } from '../lib/auth-service';
import { saveRecipeAction } from '../app/actions';
import type { RecipeGraph, RecipeNode, NodeLayout } from '../lib/recipe-lanes/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, x = 0, y = 0): RecipeNode {
    return { id, laneId: 'l1', text: `Node ${id}`, visualDescription: `desc-${id}`, type: 'action', x, y };
}

function makeGraph(overrides: Partial<RecipeGraph> = {}): RecipeGraph {
    return {
        title: 'Test Recipe',
        lanes: [{ id: 'l1', label: 'Main', type: 'cook' }],
        nodes: [makeNode('n1', 0, 0), makeNode('n2', 100, 0)],
        ...overrides,
    };
}

/** Simulates the React Flow nodes returned by getNodes() after a user drag. */
function rfNode(id: string, x: number, y: number) {
    return { id, type: 'minimal', position: { x, y } };
}

/**
 * Simulates the "apply layouts to graph nodes" logic that runLayout(true) performs
 * in react-flow-diagram.tsx — this is the restore step on page load.
 * Returns the positions each node WOULD be rendered at.
 */
function simulateRestorePositions(
    graph: RecipeGraph,
    mode: string,
): { id: string; x: number; y: number }[] {
    if (graph.layouts?.[mode]) {
        // Branch 1: independent layouts map (the primary restore path)
        return graph.nodes.map(n => {
            const pos = graph.layouts![mode].find(l => l.id === n.id);
            return pos ? { id: n.id, x: pos.x, y: pos.y } : { id: n.id, x: n.x ?? 0, y: n.y ?? 0 };
        });
    }
    if (graph.layoutMode === mode && graph.nodes.some(n => n.x !== undefined)) {
        // Branch 2: fallback — node-level x/y from saved layoutMode
        return graph.nodes.map(n => ({ id: n.id, x: n.x ?? 0, y: n.y ?? 0 }));
    }
    // No saved layout found: fresh layout would be computed
    return [];
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

beforeEach(() => {
    memoryStore.clear();
    setDataService(new MemoryDataService());
    setAuthService(new MockAuthService({ uid: 'user-1', email: 'u@test.com', name: 'User 1', isAdmin: false }));
    useRecipeStore.getState().reset();
});

// ============================================================
// LAYER A — buildGraphForSave (data preparation)
// ============================================================

describe('Layer A — buildGraphForSave', () => {

    it('[A1] captures moved node coordinates into layouts when graph has NO prior layouts (fresh recipe)', () => {
        const graph = makeGraph(); // no layouts

        const result = buildGraphForSave(graph, 'dagre', [rfNode('n1', 100, 200), rfNode('n2', 300, 200)], []);

        assert.deepStrictEqual(
            result.layouts?.['dagre'],
            [{ id: 'n1', x: 100, y: 200 }, { id: 'n2', x: 300, y: 200 }],
            'layouts[dagre] must hold the moved coordinates',
        );
        assert.equal(result.layoutMode, 'dagre', 'layoutMode must be set');
        assert.equal(result.nodes.find(n => n.id === 'n1')?.x, 100, 'node x must reflect drag position');
        assert.equal(result.nodes.find(n => n.id === 'n1')?.y, 200, 'node y must reflect drag position');
    });

    it('[A2] preserves moved coordinates when graph.layouts already has an entry for this mode', () => {
        // Simulates the SECOND save — graph already has layouts from the first save
        const graph = makeGraph({
            layouts: { dagre: [{ id: 'n1', x: 0, y: 0 }, { id: 'n2', x: 100, y: 0 }] },
            layoutMode: 'dagre',
        });

        const result = buildGraphForSave(graph, 'dagre', [rfNode('n1', 250, 400), rfNode('n2', 350, 400)], []);

        assert.deepStrictEqual(
            result.layouts?.['dagre'],
            [{ id: 'n1', x: 250, y: 400 }, { id: 'n2', x: 350, y: 400 }],
            'existing layouts entry must be overwritten with new positions',
        );
    });

    it('[A3] preserves OTHER mode layouts when only one mode is being saved', () => {
        const graph = makeGraph({
            layouts: {
                dagre:     [{ id: 'n1', x: 0,  y: 0  }, { id: 'n2', x: 100, y: 0   }],
                swimlanes: [{ id: 'n1', x: 50, y: 60 }, { id: 'n2', x: 150, y: 60  }],
            },
        });

        const result = buildGraphForSave(graph, 'dagre', [rfNode('n1', 300, 500), rfNode('n2', 400, 500)], []);

        assert.deepStrictEqual(
            result.layouts?.['dagre'],
            [{ id: 'n1', x: 300, y: 500 }, { id: 'n2', x: 400, y: 500 }],
            'dagre layout must be updated',
        );
        assert.deepStrictEqual(
            result.layouts?.['swimlanes'],
            [{ id: 'n1', x: 50, y: 60 }, { id: 'n2', x: 150, y: 60 }],
            'swimlanes layout must be untouched',
        );
    });

    it('[A4 - BUG] does NOT throw and captures positions when graph.layouts is a frozen object (Zustand-like)', () => {
        // Even though Zustand v5 does not freeze, explicitly test that we never
        // mutate the original graph.layouts reference.
        const originalLayouts = Object.freeze({ dagre: Object.freeze([{ id: 'n1', x: 0, y: 0 }]) as NodeLayout[] }) as RecipeGraph['layouts'];
        const graph = makeGraph({ layouts: originalLayouts });

        let result: RecipeGraph;
        assert.doesNotThrow(() => {
            result = buildGraphForSave(graph, 'dagre', [rfNode('n1', 200, 300), rfNode('n2', 300, 300)], []);
        }, 'buildGraphForSave must not throw on frozen layouts');

        assert.deepStrictEqual(
            result!.layouts?.['dagre'],
            [{ id: 'n1', x: 200, y: 300 }, { id: 'n2', x: 300, y: 300 }],
            'layouts must contain the dragged positions even when input was frozen',
        );
        // Verify we did NOT mutate the original frozen object
        assert.deepStrictEqual(
            originalLayouts!['dagre'],
            [{ id: 'n1', x: 0, y: 0 }],
            'original layouts object must be unchanged (no mutation)',
        );
    });
});

// ============================================================
// LAYER B — saveRecipeAction → getRecipe roundtrip
// ============================================================

describe('Layer B — saveRecipeAction → getRecipe roundtrip', () => {

    it('[B1] layouts are persisted through a save and retrievable', async () => {
        const graph = makeGraph();
        // Initial save (no layouts yet)
        const { id } = await saveRecipeAction(graph);
        assert.ok(id, 'initial save must return an id');

        // Simulate user drag: build graph with moved positions
        const moved = buildGraphForSave(
            graph,
            'dagre',
            [rfNode('n1', 150, 250), rfNode('n2', 350, 250)],
            [],
        );

        // Save with layouts
        const res = await saveRecipeAction(moved, id);
        assert.ok(!res.error, `save with layouts must not error: ${res.error}`);

        // Load back
        const loaded = await getDataService().getRecipe(id!);
        assert.ok(loaded, 'recipe must be loadable after save');
        assert.ok(loaded!.graph.layouts, 'loaded graph must have a layouts field');
        assert.ok(loaded!.graph.layouts!['dagre'], 'loaded graph must have layouts for dagre mode');
        assert.deepStrictEqual(
            loaded!.graph.layouts!['dagre'],
            [{ id: 'n1', x: 150, y: 250 }, { id: 'n2', x: 350, y: 250 }],
            'loaded layouts[dagre] must match the moved positions',
        );
    });

    it('[B2] node-level x/y coordinates are also persisted', async () => {
        const graph = makeGraph();
        const { id } = await saveRecipeAction(graph);

        const moved = buildGraphForSave(
            graph,
            'dagre',
            [rfNode('n1', 150, 250), rfNode('n2', 350, 250)],
            [],
        );
        await saveRecipeAction(moved, id);

        const loaded = await getDataService().getRecipe(id!);
        const n1 = loaded!.graph.nodes.find(n => n.id === 'n1');
        assert.equal(n1?.x, 150, 'node n1.x must be 150 after save');
        assert.equal(n1?.y, 250, 'node n1.y must be 250 after save');
    });

    it('[B3] layoutMode is persisted alongside layouts', async () => {
        const graph = makeGraph();
        const { id } = await saveRecipeAction(graph);

        const moved = buildGraphForSave(graph, 'dagre', [rfNode('n1', 10, 20), rfNode('n2', 30, 20)], []);
        await saveRecipeAction(moved, id);

        const loaded = await getDataService().getRecipe(id!);
        assert.equal(loaded!.graph.layoutMode, 'dagre', 'layoutMode must be persisted');
    });

    it('[B4] second drag-save accumulates — does not wipe previous save', async () => {
        const graph = makeGraph();
        const { id } = await saveRecipeAction(graph);

        // First drag
        const drag1 = buildGraphForSave(graph, 'dagre', [rfNode('n1', 100, 100), rfNode('n2', 200, 100)], []);
        await saveRecipeAction(drag1, id);

        // Second drag — simulate: load the just-saved graph from DB, then drag again
        const after1 = (await getDataService().getRecipe(id!))!.graph;
        const drag2 = buildGraphForSave(after1, 'dagre', [rfNode('n1', 300, 400), rfNode('n2', 500, 400)], []);
        await saveRecipeAction(drag2, id);

        const loaded = await getDataService().getRecipe(id!);
        assert.deepStrictEqual(
            loaded!.graph.layouts!['dagre'],
            [{ id: 'n1', x: 300, y: 400 }, { id: 'n2', x: 500, y: 400 }],
            'second drag positions must overwrite first drag positions',
        );
    });
});

// ============================================================
// LAYER C — mergeSnapshot (Zustand store integration)
// ============================================================

describe('Layer C — mergeSnapshot carries layouts from Firestore into Zustand state', () => {

    it('[C1] first-load snapshot populates layouts in store', () => {
        const incoming = makeGraph({
            layouts: { dagre: [{ id: 'n1', x: 150, y: 250 }, { id: 'n2', x: 350, y: 250 }] },
            layoutMode: 'dagre',
        });

        useRecipeStore.getState().mergeSnapshot(incoming);

        const g = useRecipeStore.getState().graph!;
        assert.ok(g.layouts?.['dagre'], 'store graph must have layouts.dagre after first snapshot');
        assert.deepStrictEqual(
            g.layouts!['dagre'],
            [{ id: 'n1', x: 150, y: 250 }, { id: 'n2', x: 350, y: 250 }],
            'layouts.dagre in store must match the incoming snapshot',
        );
    });

    it('[C2] subsequent snapshot (post-save) does NOT strip layouts', () => {
        // Simulate: user loaded recipe (no layouts), dragged, app called onSave → setGraph,
        // then Firestore snapshot arrived with the saved layouts.

        // Step 1: initial load (no layouts)
        const initial = makeGraph();
        useRecipeStore.getState().mergeSnapshot(initial);

        // Step 2: onSave called setGraph with the dragged graph (has layouts)
        const afterDrag = makeGraph({
            layouts: { dagre: [{ id: 'n1', x: 150, y: 250 }, { id: 'n2', x: 350, y: 250 }] },
            layoutMode: 'dagre',
        });
        useRecipeStore.getState().setGraph(afterDrag); // simulates onSave → setGraph

        // Step 3: Firestore snapshot arrives (same data that was saved)
        const fromFirestore = makeGraph({
            layouts: { dagre: [{ id: 'n1', x: 150, y: 250 }, { id: 'n2', x: 350, y: 250 }] },
            layoutMode: 'dagre',
        });
        useRecipeStore.getState().mergeSnapshot(fromFirestore);

        const g = useRecipeStore.getState().graph!;
        assert.ok(g.layouts?.['dagre'], 'store graph must still have layouts.dagre after post-save snapshot');
        assert.deepStrictEqual(
            g.layouts!['dagre'],
            [{ id: 'n1', x: 150, y: 250 }, { id: 'n2', x: 350, y: 250 }],
            'layouts must survive the post-save mergeSnapshot cycle',
        );
    });

    it('[C3] mergeSnapshot does not lose layouts when only nodes changed (icon update)', () => {
        // Simulates an icon arriving via Firestore after a drag-save
        const withLayouts = makeGraph({
            layouts: { dagre: [{ id: 'n1', x: 150, y: 250 }, { id: 'n2', x: 350, y: 250 }] },
            layoutMode: 'dagre',
        });
        useRecipeStore.getState().mergeSnapshot(withLayouts);

        // Icon update arrives via Firestore — nodes mutated but layouts unchanged
        const iconUpdate = {
            ...withLayouts,
            nodes: withLayouts.nodes.map(n =>
                n.id === 'n1' ? { ...n, visualDescription: 'new description' } : n,
            ),
        };
        useRecipeStore.getState().mergeSnapshot(iconUpdate);

        const g = useRecipeStore.getState().graph!;
        assert.ok(g.layouts?.['dagre'], 'layouts must survive a node-level icon update snapshot');
        assert.deepStrictEqual(
            g.layouts!['dagre'],
            [{ id: 'n1', x: 150, y: 250 }, { id: 'n2', x: 350, y: 250 }],
        );
    });
});

// ============================================================
// LAYER D — runLayout restore logic (pure version)
// ============================================================

describe('Layer D — simulateRestorePositions (runLayout branch 1 & 2)', () => {

    it('[D1] branch 1: uses layouts[mode] when present', () => {
        const graph = makeGraph({
            layouts: { dagre: [{ id: 'n1', x: 150, y: 250 }, { id: 'n2', x: 350, y: 250 }] },
            layoutMode: 'dagre',
        });

        const positions = simulateRestorePositions(graph, 'dagre');
        assert.deepStrictEqual(positions, [
            { id: 'n1', x: 150, y: 250 },
            { id: 'n2', x: 350, y: 250 },
        ], 'positions must come from layouts[dagre]');
    });

    it('[D2] branch 1 wins over branch 2 when both are available', () => {
        // layouts and layoutMode both present — layouts[mode] should win
        const graph = makeGraph({
            nodes: [makeNode('n1', 99, 99), makeNode('n2', 199, 99)],
            layouts: { dagre: [{ id: 'n1', x: 150, y: 250 }, { id: 'n2', x: 350, y: 250 }] },
            layoutMode: 'dagre',
        });

        const positions = simulateRestorePositions(graph, 'dagre');
        assert.deepStrictEqual(positions, [
            { id: 'n1', x: 150, y: 250 },
            { id: 'n2', x: 350, y: 250 },
        ], 'layouts[mode] must win over node-level x/y');
    });

    it('[D3] branch 2: falls back to node-level x/y when no layouts[mode]', () => {
        const graph = makeGraph({
            nodes: [makeNode('n1', 150, 250), makeNode('n2', 350, 250)],
            // no layouts map, but layoutMode matches
            layoutMode: 'dagre',
        });

        const positions = simulateRestorePositions(graph, 'dagre');
        assert.deepStrictEqual(positions, [
            { id: 'n1', x: 150, y: 250 },
            { id: 'n2', x: 350, y: 250 },
        ], 'fallback must use node-level x/y when layoutMode matches');
    });

    it('[D4] returns empty when neither layouts[mode] nor matching layoutMode exists', () => {
        const graph = makeGraph({
            // No layouts, no layoutMode matching current mode
        });

        const positions = simulateRestorePositions(graph, 'dagre');
        assert.deepStrictEqual(positions, [], 'should signal "no saved layout" so a fresh layout is computed');
    });

    it('[D5] wrong mode: layouts exist but not for the current mode — returns empty', () => {
        const graph = makeGraph({
            layouts: { swimlanes: [{ id: 'n1', x: 50, y: 50 }] },
            layoutMode: 'swimlanes',
        });

        // User reloads in default 'dagre' mode but recipe was saved in 'swimlanes'
        const positions = simulateRestorePositions(graph, 'dagre');
        assert.deepStrictEqual(positions, [],
            'if the saved mode does not match the current mode, positions cannot be restored — ' +
            'this is a known limitation (not this bug)',
        );
    });
});

// ============================================================
// END-TO-END — full pipeline: drag → save → "reload" → positions correct
// ============================================================

describe('End-to-end: drag → save → reload → positions restored', () => {

    it('[E1] full cycle: positions survive a complete save and fresh load', async () => {
        // --- INITIAL LOAD ---
        const initial = makeGraph();
        const { id } = await saveRecipeAction(initial);
        assert.ok(id);

        // Simulate: initial snapshot from Firestore
        const initialSnap = (await getDataService().getRecipe(id!))!.graph;
        useRecipeStore.getState().mergeSnapshot(initialSnap);

        // --- USER DRAGS n1 to (250, 400) ---
        const storeGraph = useRecipeStore.getState().graph!;
        const graphToSave = buildGraphForSave(
            storeGraph,
            'dagre',
            [rfNode('n1', 250, 400), rfNode('n2', 450, 400)],
            [],
        );

        // --- AUTO-SAVE ---
        const saveRes = await saveRecipeAction(graphToSave, id);
        assert.ok(!saveRes.error, `auto-save must succeed: ${saveRes.error}`);

        // Simulate onSave → setGraph
        useRecipeStore.getState().setGraph(graphToSave);

        // Simulate Firestore snapshot arriving
        const firestoreSnap = (await getDataService().getRecipe(id!))!.graph;
        useRecipeStore.getState().mergeSnapshot(firestoreSnap);

        // --- RELOAD (resetRecipeStore → fresh snapshot) ---
        useRecipeStore.getState().reset();
        const reloadSnap = (await getDataService().getRecipe(id!))!.graph;
        useRecipeStore.getState().mergeSnapshot(reloadSnap); // first-load branch

        const reloaded = useRecipeStore.getState().graph!;

        // Verify layouts are present for the reload
        assert.ok(reloaded.layouts?.['dagre'],
            'layouts.dagre must be present after reload — this is what runLayout(true) reads');

        // Verify the positions runLayout(true) WOULD use
        const restoredPositions = simulateRestorePositions(reloaded, 'dagre');
        assert.ok(restoredPositions.length > 0,
            'simulateRestorePositions must find saved positions (would trigger branch 1 in runLayout)',
        );
        assert.deepStrictEqual(
            restoredPositions.find(p => p.id === 'n1'),
            { id: 'n1', x: 250, y: 400 },
            'n1 must be at its dragged position after reload',
        );
        assert.deepStrictEqual(
            restoredPositions.find(p => p.id === 'n2'),
            { id: 'n2', x: 450, y: 400 },
            'n2 must be at its dragged position after reload',
        );
    });

    it('[E2] multiple drags: only the last positions are used on reload', async () => {
        const initial = makeGraph();
        const { id } = await saveRecipeAction(initial);
        let storeGraph = (await getDataService().getRecipe(id!))!.graph;
        useRecipeStore.getState().mergeSnapshot(storeGraph);

        // First drag
        let moved = buildGraphForSave(useRecipeStore.getState().graph!, 'dagre',
            [rfNode('n1', 100, 100), rfNode('n2', 200, 100)], []);
        await saveRecipeAction(moved, id);
        useRecipeStore.getState().mergeSnapshot((await getDataService().getRecipe(id!))!.graph);

        // Second drag (different positions)
        moved = buildGraphForSave(useRecipeStore.getState().graph!, 'dagre',
            [rfNode('n1', 777, 888), rfNode('n2', 999, 888)], []);
        await saveRecipeAction(moved, id);

        // Reload
        useRecipeStore.getState().reset();
        useRecipeStore.getState().mergeSnapshot((await getDataService().getRecipe(id!))!.graph);

        const positions = simulateRestorePositions(useRecipeStore.getState().graph!, 'dagre');
        assert.deepStrictEqual(
            positions.find(p => p.id === 'n1'),
            { id: 'n1', x: 777, y: 888 },
            'latest drag position must win',
        );
    });
});
