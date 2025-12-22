import { calculatePenroseLayout } from '../lib/recipe-lanes/layout-penrose';
import type { RecipeGraph } from '../lib/recipe-lanes/types';

const mockGraph: RecipeGraph = {
    nodes: [
        { id: '1', laneId: 'l1', text: 'N1', visualDescription: 'N1', type: 'ingredient' },
        { id: '2', laneId: 'l1', text: 'N2', visualDescription: 'N2', type: 'ingredient' },
        { id: '3', laneId: 'l1', text: 'N3', visualDescription: 'N3', type: 'action', inputs: ['1', '2'] }
    ],
    lanes: [
        { id: 'l1', label: 'Lane 1', type: 'prep' }
    ]
};

async function test() {
    console.log("Testing Penrose Layout...");
    try {
        const result = await calculatePenroseLayout(mockGraph, 1);
        console.log("Result:", result);
        console.log("Nodes:", result.nodes.length);
        if (result.nodes.length !== 3) throw new Error("Incorrect node count");
    } catch (e) {
        console.error("Penrose Failed:", e);
        process.exit(1);
    }
}

test();
