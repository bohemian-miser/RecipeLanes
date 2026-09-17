import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    calculateNotationLayout,
    notationLabelBox,
    notationSpineHalfExtent,
    isNotationStationId,
    NOTATION,
    type NotationVisualNode,
} from '../lib/recipe-lanes/layout-notation';
import {
    estimateLabel,
    LABEL_LINE_HEIGHT,
    VERB_LABEL_WIDTH,
} from '../lib/recipe-lanes/notation-metrics';
import type { RecipeGraph, RecipeNode } from '../lib/recipe-lanes/types';

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

    // Regression: a no-input ACTION (e.g. "Preheat the oven") is a "leaf" by
    // getLeafNodeIds's in-degree-0 definition. It must be placed exactly once
    // (on its lane's spine, by the actions loop) — not duplicated as a
    // floating leaf when another action consumes it, and not re-added by the
    // orphan-leaf fallback when nothing consumes it.
    it('never emits duplicate node ids for zero-input actions', () => {
        const g: RecipeGraph = {
            lanes: [{ id: 'oven', label: 'Oven', type: 'cook' }],
            nodes: [
                { id: 'preheat', laneId: 'oven', type: 'action', text: 'Preheat the oven', visualDescription: '' },
                { id: 'lonely', laneId: 'oven', type: 'action', text: 'Grease the tray', visualDescription: '' },
                { id: 'bake1', laneId: 'oven', type: 'action', text: 'Bake the cake', visualDescription: '', inputs: ['preheat'] },
            ],
        };
        const l = calculateNotationLayout(g);
        const ids = l.nodes.map(n => n.id);
        assert.strictEqual(new Set(ids).size, ids.length, `duplicate ids in ${JSON.stringify(ids)}`);
        // Consumed zero-input action keeps its action role (verb/state), not 'leaf'.
        const preheat = l.nodes.find(n => n.id === 'preheat')!;
        assert.notStrictEqual(preheat.role, 'leaf');
        // Unconsumed zero-input action also keeps its action role.
        const lonely = l.nodes.find(n => n.id === 'lonely')!;
        assert.notStrictEqual(lonely.role, 'leaf');
    });
});

// ── Placement invariant ──────────────────────────────────────────────────────
// Every node in graph.nodes must appear EXACTLY ONCE in layout.nodes. A node
// missing from the layout doesn't just fail to render: buildGraphForSave
// intersects graph.nodes with the rendered RF nodes, so saving in Notation
// mode would permanently delete it from the recipe.
function assertEveryNodePlacedOnce(graph: RecipeGraph) {
    const layout = calculateNotationLayout(graph);
    const counts = new Map<string, number>();
    for (const n of layout.nodes) counts.set(n.id, (counts.get(n.id) ?? 0) + 1);
    for (const gn of graph.nodes) {
        assert.strictEqual(counts.get(gn.id), 1, `node ${gn.id} must appear exactly once in the layout`);
    }
}

describe('calculateNotationLayout placement invariant', () => {
    it('places every node of the standard fixture exactly once', () => {
        assertEveryNodePlacedOnce(buildGraph());
    });

    it('places an ingredient node WITH inputs (not a leaf, not an action) instead of dropping it', () => {
        const graph = buildGraph();
        // e.g. an applyPatch-produced "derived ingredient": consumed nowhere,
        // but fed by an action — in-degree > 0 so it is not in getLeafNodeIds,
        // and it is not an action, so no primary placement pass covers it.
        graph.nodes.push({
            id: 'i-mid',
            laneId: 'lane1',
            type: 'ingredient',
            text: 'reserved garlic oil',
            visualDescription: 'garlic oil',
            inputs: ['action2'],
        });
        assertEveryNodePlacedOnce(graph);

        const layout = calculateNotationLayout(graph);
        const placed = layout.nodes.find(n => n.id === 'i-mid')!;
        assert.strictEqual(placed.role, 'state');
        assert.strictEqual(placed.laneId, 'lane1');
    });

    it('places every node of the 27-node torture fixture exactly once', () => {
        const graph = buildTortureGraph();
        assert.strictEqual(graph.nodes.length, 27, 'fixture size drifted');
        assertEveryNodePlacedOnce(graph);
    });

    it('holds for a graph with a no-input action and an orphan ingredient', () => {
        const graph = buildGraph();
        graph.nodes.push(
            { id: 'a-noinput', laneId: 'lane2', type: 'action', text: 'Preheat the oven', visualDescription: '' },
            { id: 'i-orphan', laneId: 'lane2', type: 'ingredient', text: 'parsley', visualDescription: 'parsley' },
        );
        assertEveryNodePlacedOnce(graph);
    });
});

// ── Torture fixture ──────────────────────────────────────────────────────────
// Mirrors the 27-node recipe that exposed the original spacing failure (4
// lanes, long real-world ingredient names, in-lane branches, cross-lane joins,
// same-lane same-depth siblings, a zero-input action, leaves whose consumer is
// in a DIFFERENT lane from the leaf itself). Measured on the old engine: 18 of
// 31 rendered node boxes overlapped and 41 of 42 label boxes collided.
function buildTortureGraph(): RecipeGraph {
    const ing = (id: string, laneId: string, text: string, inputs?: string[]): RecipeNode =>
        ({ id, laneId, type: 'ingredient', text, visualDescription: text, ...(inputs ? { inputs } : {}) });
    const act = (
        id: string,
        laneId: string,
        text: string,
        inputs?: string[],
        extra: Partial<RecipeNode> = {},
    ): RecipeNode =>
        ({ id, laneId, type: 'action', text, visualDescription: '', ...(inputs ? { inputs } : {}), ...extra });

    return {
        lanes: [
            { id: 'prep', label: 'Prep', type: 'prep' },
            { id: 'stove', label: 'Stovetop', type: 'cook' },
            { id: 'oven', label: 'Oven', type: 'cook' },
            { id: 'plate', label: 'Plating', type: 'serve' },
        ],
        nodes: [
            // — Prep —
            ing('i-flour', 'prep', '400g 00 flour, sifted'),
            ing('i-eggs', 'prep', '4 large free-range eggs, at room temperature'),
            ing('i-mozz', 'prep', '250g fresh mozzarella di bufala, well drained'),
            ing('i-basil', 'prep', '1 large bunch of fresh basil leaves, torn'),
            ing('i-parm', 'prep', '80g Parmigiano Reggiano, very finely grated'),
            act('a-dough', 'prep', 'Make the pasta dough', ['i-flour', 'i-eggs']),
            // same lane, same depth as a-dough — the case the old tie-break nudge
            // (ACTION_SPACING / 2 = 82.5px inside a 130px label box) guaranteed to collide
            act('a-tear', 'prep', 'Tear the mozzarella into rough pieces', ['i-mozz']),
            act('a-rest', 'prep', 'Rest the dough for thirty minutes', ['a-dough'], { duration: '30 min' }),
            act('a-roll', 'prep', 'Roll and cut the tagliatelle', ['a-rest']),

            // — Stovetop —
            ing('i-oil', 'stove', '3 tablespoons of extra virgin olive oil'),
            ing('i-onion', 'stove', '1 large yellow onion, diced small'),
            ing('i-garlic', 'stove', '3 cloves of garlic, finely minced'),
            ing('i-toms', 'stove', '500g San Marzano tomatoes, peeled and deseeded'),
            ing('i-salt', 'stove', 'Sea salt and freshly cracked black pepper'),
            act('a-heat', 'stove', 'Heat the olive oil in a wide pan', ['i-oil']),
            act('a-sweat', 'stove', 'Sweat the onion and garlic until soft', ['a-heat', 'i-onion', 'i-garlic'], { duration: '8 min' }),
            act('a-simmer', 'stove', 'Simmer the tomato sauce gently', ['a-sweat', 'i-toms'], { duration: '25 min', temperature: 'Low heat' }),
            act('a-season', 'stove', 'Season the sauce to taste', ['a-simmer', 'i-salt']),
            act('a-boil', 'stove', 'Boil the tagliatelle until al dente', ['a-roll'], { duration: '3 min' }), // cross-lane input
            act('a-toss', 'stove', 'Toss the pasta through the sauce', ['a-boil', 'a-season']),

            // — Oven —
            ing('i-crumbs', 'oven', '60g coarse sourdough breadcrumbs'),
            act('a-preheat', 'oven', 'Preheat the oven to 220 degrees', undefined, { temperature: '220C' }), // zero-input action
            act('a-layer', 'oven', 'Layer pasta, sauce and mozzarella', ['a-toss', 'a-tear', 'a-preheat', 'i-crumbs']),
            act('a-bake', 'oven', 'Bake until bubbling and golden brown', ['a-layer'], { duration: '20 min' }),

            // — Plating — (i-basil / i-parm live in the Prep lane but are consumed here)
            ing('i-drizzle', 'plate', 'A final drizzle of peppery olive oil'),
            act('a-settle', 'plate', 'Rest the bake before serving', ['a-bake'], { duration: '10 min' }),
            act('a-plate', 'plate', 'Plate up and finish with basil and parmesan', ['a-settle', 'i-basil', 'i-parm', 'i-drizzle']),
        ],
    };
}

// ── Occupied-box helper ──────────────────────────────────────────────────────
// A node's real screen footprint is its layout box UNION its label box — the
// original engine only ever reasoned about the former, which is exactly why
// labels smeared over each other. `notationLabelBox` is the same estimate the
// layout spaced by, evaluated with the conservative 4-line row budget.
interface Box { x1: number; y1: number; x2: number; y2: number }

function occupiedBox(n: NotationVisualNode): Box {
    const label = notationLabelBox(n);
    return {
        x1: Math.min(n.x, label.x),
        y1: Math.min(n.y, label.y),
        x2: Math.max(n.x + n.width, label.x + label.width),
        y2: Math.max(n.y + n.height, label.y + label.height),
    };
}

const EPS = 1e-6;
function overlaps(a: Box, b: Box): boolean {
    return a.x2 - b.x1 > EPS && b.x2 - a.x1 > EPS && a.y2 - b.y1 > EPS && b.y2 - a.y1 > EPS;
}

function overlappingPairs(layout: ReturnType<typeof calculateNotationLayout>): string[] {
    const boxes = layout.nodes.map(n => ({ id: n.id, box: occupiedBox(n) }));
    const hits: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
            if (overlaps(boxes[i].box, boxes[j].box)) hits.push(`${boxes[i].id} ∩ ${boxes[j].id}`);
        }
    }
    return hits;
}

const centerX = (n: NotationVisualNode) => n.x + n.width / 2;

describe('notation label estimator', () => {
    it('is monotone non-decreasing in text length', () => {
        let prevW = -1, prevH = -1;
        for (let len = 0; len <= 120; len += 3) {
            const m = estimateLabel('x'.repeat(len), 12, 92, 2);
            assert.ok(m.width >= prevW, `width regressed at len ${len}`);
            assert.ok(m.height >= prevH, `height regressed at len ${len}`);
            prevW = m.width;
            prevH = m.height;
        }
    });

    it('never estimates wider than the box it wraps in', () => {
        for (const len of [1, 5, 40, 400]) {
            assert.ok(estimateLabel('x'.repeat(len), 12, 92, 2).width <= 92);
            assert.ok(estimateLabel('x'.repeat(len), 9, VERB_LABEL_WIDTH, 3).width <= VERB_LABEL_WIDTH);
        }
    });

    it('reports height as lines x fontPx x lineHeight, clamped to maxLines', () => {
        for (const len of [1, 20, 60, 400]) {
            for (const maxLines of [1, 2, 3, 4]) {
                const m = estimateLabel('x'.repeat(len), 12, 92, maxLines);
                assert.ok(m.lines <= maxLines, `lines ${m.lines} exceeded clamp ${maxLines}`);
                assert.strictEqual(m.height, m.lines * 12 * LABEL_LINE_HEIGHT);
            }
        }
        const empty = estimateLabel('', 12, 92, 2);
        assert.deepStrictEqual(empty, { width: 0, lines: 0, height: 0 });
    });
});

describe('calculateNotationLayout spacing invariants', () => {
    const fixtures: Array<[string, RecipeGraph]> = [
        ['standard fixture', buildGraph()],
        ['torture fixture', buildTortureGraph()],
    ];

    for (const [name, graph] of fixtures) {
        const layout = calculateNotationLayout(graph);

        // 1 — the headline regression gate.
        it(`${name}: no two occupied boxes overlap`, () => {
            const hits = overlappingPairs(layout);
            assert.deepStrictEqual(hits, [], `${hits.length} overlapping pair(s): ${hits.join(', ')}`);
        });

        // 2 — same-lane spine neighbours are spaced by their own label widths.
        it(`${name}: same-lane spine neighbours clear each other's labels`, () => {
            const byLane = new Map<string, NotationVisualNode[]>();
            for (const n of layout.nodes) {
                if (n.role !== 'verb' && n.role !== 'state') continue;
                const list = byLane.get(n.laneId) ?? [];
                list.push(n);
                byLane.set(n.laneId, list);
            }
            for (const [laneId, items] of byLane) {
                items.sort((a, b) => centerX(a) - centerX(b));
                for (let i = 1; i < items.length; i++) {
                    const a = items[i - 1], b = items[i];
                    const need = notationSpineHalfExtent(a) + notationSpineHalfExtent(b) + NOTATION.LABEL_PAD;
                    assert.ok(
                        centerX(b) - centerX(a) >= need - EPS,
                        `${laneId}: ${a.id} -> ${b.id} gap ${centerX(b) - centerX(a)} < required ${need}`,
                    );
                }
            }
        });

        // 3 — leaves in one lane's leaf row claim disjoint horizontal slots.
        it(`${name}: leaf slots are disjoint within each lane row`, () => {
            const byRow = new Map<string, NotationVisualNode[]>();
            for (const n of layout.nodes) {
                if (n.role !== 'leaf') continue;
                const list = byRow.get(n.laneId) ?? [];
                list.push(n);
                byRow.set(n.laneId, list);
            }
            for (const [laneId, leaves] of byRow) {
                leaves.sort((a, b) => centerX(a) - centerX(b));
                // one row per lane: all leaves share a y
                for (const l of leaves) assert.strictEqual(l.y, leaves[0].y, `${laneId}: ${l.id} is off the leaf row`);
                const slot = (n: NotationVisualNode) =>
                    Math.max(n.width, notationLabelBox(n).width) + NOTATION.LEAF_SLOT_PAD;
                for (let i = 1; i < leaves.length; i++) {
                    const a = leaves[i - 1], b = leaves[i];
                    const need = (slot(a) + slot(b)) / 2;
                    assert.ok(
                        centerX(b) - centerX(a) >= need - EPS,
                        `${laneId}: leaf slots ${a.id} / ${b.id} overlap (${centerX(b) - centerX(a)} < ${need})`,
                    );
                }
            }
        });

        // 4 — a lane's whole vertical band (leaf ink through below-spine labels)
        //     never touches another lane's.
        it(`${name}: row bands do not intersect`, () => {
            const bands = new Map<string, { top: number; bottom: number }>();
            for (const n of layout.nodes) {
                const b = occupiedBox(n);
                const cur = bands.get(n.laneId);
                bands.set(n.laneId, {
                    top: Math.min(cur?.top ?? Infinity, b.y1),
                    bottom: Math.max(cur?.bottom ?? -Infinity, b.y2),
                });
            }
            const ordered = [...bands.entries()].sort((a, b) => a[1].top - b[1].top);
            for (let i = 1; i < ordered.length; i++) {
                const prev = ordered[i - 1], cur = ordered[i];
                assert.ok(
                    cur[1].top >= prev[1].bottom - EPS,
                    `band ${prev[0]} (…${prev[1].bottom}) bleeds into ${cur[0]} (${cur[1].top}…)`,
                );
            }
        });

        // 5 — flow always reads left-to-right, cross-lane inputs included.
        it(`${name}: every spine item sits right of all its spine inputs`, () => {
            const byId = new Map(layout.nodes.map(n => [n.id, n]));
            for (const gn of graph.nodes) {
                const target = byId.get(gn.id);
                if (!target || (target.role !== 'verb' && target.role !== 'state')) continue;
                for (const inputId of gn.inputs ?? []) {
                    const src = byId.get(inputId);
                    if (!src || (src.role !== 'verb' && src.role !== 'state')) continue;
                    assert.ok(
                        centerX(target) - centerX(src) >= NOTATION.MIN_EDGE_DX - EPS,
                        `${inputId} -> ${gn.id}: dx ${centerX(target) - centerX(src)} < MIN_EDGE_DX`,
                    );
                }
            }
        });

        // 6 — no slack: each x is exactly the max of its active constraints, and
        //     a lane's first unconstrained item starts at ROW_START_X.
        it(`${name}: spine placement is compact (no dead space)`, () => {
            const byId = new Map(layout.nodes.map(n => [n.id, n]));
            const byLane = new Map<string, NotationVisualNode[]>();
            for (const n of layout.nodes) {
                if (n.role !== 'verb' && n.role !== 'state') continue;
                const list = byLane.get(n.laneId) ?? [];
                list.push(n);
                byLane.set(n.laneId, list);
            }
            for (const [laneId, items] of byLane) {
                items.sort((a, b) => centerX(a) - centerX(b));
                items.forEach((item, i) => {
                    let expected: number = NOTATION.ROW_START_X;
                    if (i > 0) {
                        const prev = items[i - 1];
                        expected = centerX(prev) + Math.max(
                            NOTATION.MIN_ACTION_GAP,
                            notationSpineHalfExtent(prev) + notationSpineHalfExtent(item) + NOTATION.LABEL_PAD,
                        );
                    }
                    for (const inputId of (item.data as RecipeNode).inputs ?? []) {
                        const src = byId.get(inputId);
                        if (!src || (src.role !== 'verb' && src.role !== 'state')) continue;
                        expected = Math.max(expected, centerX(src) + NOTATION.MIN_EDGE_DX);
                    }
                    assert.ok(
                        Math.abs(centerX(item) - expected) < 1e-6,
                        `${laneId}: ${item.id} at ${centerX(item)} but its binding constraint is ${expected}`,
                    );
                });
                // A lane whose first step has no upstream spine input has
                // nothing holding it right — it must start flush at
                // ROW_START_X (the "700px of empty spine" bug).
                const firstInputs = ((items[0].data as RecipeNode).inputs ?? [])
                    .map(id => byId.get(id))
                    .filter(src => src && (src.role === 'verb' || src.role === 'state'));
                if (firstInputs.length === 0) {
                    assert.strictEqual(
                        centerX(items[0]), NOTATION.ROW_START_X,
                        `${laneId}: unconstrained first spine item should be flush at ROW_START_X`,
                    );
                }
            }
            // At least one lane must actually be flush left, or the layout has
            // silently drifted right again.
            const flush = layout.nodes.filter(
                n => (n.role === 'verb' || n.role === 'state') && centerX(n) === NOTATION.ROW_START_X,
            );
            assert.ok(flush.length > 0, 'no lane starts at ROW_START_X — dead space on the left');
        });

        // 9 — determinism.
        it(`${name}: is deterministic across runs`, () => {
            assert.deepStrictEqual(calculateNotationLayout(graph), calculateNotationLayout(graph));
        });
    }

    it('regression: the torture fixture used to produce dozens of overlaps', () => {
        // Guard-rail on the fixture itself: if it ever degenerates to a handful
        // of nodes the "0 overlaps" assertion above becomes meaningless.
        const layout = calculateNotationLayout(buildTortureGraph());
        assert.ok(layout.nodes.length >= 30, `expected a dense fixture, got ${layout.nodes.length} nodes`);
        assert.strictEqual(overlappingPairs(layout).length, 0);
    });
});

describe('calculateNotationLayout estimator injection', () => {
    it('accepts a custom estimator and still satisfies the spacing invariants', () => {
        // A deliberately fatter model (0.75 char factor) — spacing must follow
        // the estimator, not baked-in constants.
        const fat = (text: string, fontPx: number, boxWidthPx: number, maxLines: number) => {
            const chars = (text ?? '').trim().length;
            if (chars === 0) return { width: 0, lines: 0, height: 0 };
            const natural = chars * fontPx * 0.75;
            const lines = Math.min(Math.max(1, maxLines), Math.max(1, Math.ceil(natural / Math.max(1, boxWidthPx))));
            return { width: Math.min(boxWidthPx, natural), lines, height: lines * fontPx * LABEL_LINE_HEIGHT };
        };
        const graph = buildTortureGraph();
        const lean = calculateNotationLayout(graph);
        const wide = calculateNotationLayout(graph, fat);
        assert.ok(wide.width >= lean.width, 'a fatter estimator must not produce a narrower canvas');
        const boxes = wide.nodes.map(n => ({ id: n.id, box: (() => {
            const label = notationLabelBox(n, fat);
            return {
                x1: Math.min(n.x, label.x), y1: Math.min(n.y, label.y),
                x2: Math.max(n.x + n.width, label.x + label.width),
                y2: Math.max(n.y + n.height, label.y + label.height),
            };
        })() }));
        for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
                assert.ok(!overlaps(boxes[i].box, boxes[j].box), `${boxes[i].id} ∩ ${boxes[j].id} under the fat estimator`);
            }
        }
    });
});

describe('notation station spine stub', () => {
    const graph = buildTortureGraph();
    const layout = calculateNotationLayout(graph);

    it('draws one spine stub from each station badge to its row s first step', () => {
        for (const lane of graph.lanes) {
            const stub = layout.edges.find(e => e.sourceId === `notation-station-${lane.id}`);
            assert.ok(stub, `lane ${lane.id} has no station spine stub`);
            assert.strictEqual(stub!.kind, 'spine');
            const first = layout.nodes
                .filter(n => n.laneId === lane.id && (n.role === 'verb' || n.role === 'state'))
                .sort((a, b) => centerX(a) - centerX(b))[0];
            assert.strictEqual(stub!.targetId, first.id);
        }
    });

    it('is recognisable as synthetic so the save path can drop it', () => {
        const synthetic = layout.edges.filter(e => isNotationStationId(e.sourceId));
        assert.strictEqual(synthetic.length, graph.lanes.length);
        // Real edges never originate at a station badge.
        for (const e of layout.edges) {
            if (isNotationStationId(e.sourceId)) continue;
            assert.ok(graph.nodes.some(n => n.id === e.sourceId), `edge ${e.id} has a non-graph source`);
        }
    });
});
