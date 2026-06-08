/**
 * Debug script: run an adjustment against a live recipe and show the full AI
 * request/response, patch/graph detection, and whether applyPatch worked.
 *
 * Usage:
 *   npx tsx --env-file=.env.staging scripts/debug-adjust.ts <recipeId> "<instruction>"
 */
import 'dotenv/config';
import { db } from '../lib/firebase-admin';
import { generateAdjustmentPrompt } from '../lib/recipe-lanes/adjuster';
import { applyPatch } from '../lib/recipe-lanes/model-utils';
import { parseRecipeGraph } from '../lib/recipe-lanes/parser';
import { getAIService } from '../lib/ai-service';
import type { RecipeGraph, RecipePatch } from '../lib/recipe-lanes/types';

async function main() {
    const [recipeId, instruction] = process.argv.slice(2);
    if (!recipeId || !instruction) {
        console.error('Usage: npx tsx --env-file=.env.staging scripts/debug-adjust.ts <recipeId> "<instruction>"');
        process.exit(1);
    }

    console.log(`\n=== Recipe: ${recipeId} ===`);
    const snap = await db.collection('recipes').doc(recipeId).get();
    if (!snap.exists) { console.error('Recipe not found'); process.exit(1); }
    const graph = snap.data()!.graph as RecipeGraph;
    console.log(`Title: ${graph.title}, Nodes: ${graph.nodes.length}`);
    console.log('Node IDs & texts:');
    graph.nodes.forEach(n => console.log(`  [${n.id}] "${n.text}" (${n.type}) vd="${n.visualDescription}"`));

    console.log(`\n=== Instruction: "${instruction}" ===`);
    const prompt = generateAdjustmentPrompt(graph, instruction);
    console.log(`\n--- Prompt (${prompt.length} chars) ---`);
    console.log(prompt.slice(0, 1000) + (prompt.length > 1000 ? '\n...(truncated)' : ''));

    console.log('\n--- Calling AI... ---');
    const t0 = Date.now();
    const raw = await getAIService().generateText(prompt);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n--- AI Response (${elapsed}s, ${raw.length} chars) ---`);
    console.log(raw);

    // Parse
    let jsonStr = raw.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
    else { const s = jsonStr.indexOf('{'), e = jsonStr.lastIndexOf('}'); if (s !== -1 && e > s) jsonStr = jsonStr.slice(s, e + 1); }

    let parsed: any;
    try { parsed = JSON.parse(jsonStr); } catch (e) { console.error('\n❌ JSON parse failed:', e); process.exit(1); }

    console.log('\n--- Parsed ---');
    if (parsed.lanes && parsed.nodes) {
        console.log('✅ Full graph returned');
        try {
            const newGraph = parseRecipeGraph(jsonStr);
            console.log(`   Nodes: ${newGraph.nodes.length}, Lanes: ${newGraph.lanes.length}`);
        } catch (e) { console.error('❌ parseRecipeGraph failed:', e); }
    } else {
        const patch = parsed as RecipePatch;
        console.log('✅ Patch returned');
        console.log(`   message: "${patch.message}"`);
        console.log(`   addNodes: ${patch.addNodes?.length ?? 0}`);
        console.log(`   updateNodes: ${patch.updateNodes?.length ?? 0}`);
        console.log(`   removeNodeIds: ${JSON.stringify(patch.removeNodeIds ?? [])}`);
        console.log(`   addLanes: ${patch.addLanes?.length ?? 0}`);
        console.log(`   removeLaneIds: ${JSON.stringify(patch.removeLaneIds ?? [])}`);
        if (patch.updateTitle) console.log(`   updateTitle: "${patch.updateTitle}"`);

        // Validate removeNodeIds actually exist
        const existingIds = new Set(graph.nodes.map(n => n.id));
        const missing = (patch.removeNodeIds ?? []).filter(id => !existingIds.has(id));
        if (missing.length) console.warn(`\n⚠️  removeNodeIds not found in graph: ${JSON.stringify(missing)}`);

        try {
            const result = applyPatch(graph, patch);
            console.log(`\n   applyPatch result: ${result.nodes.length} nodes (was ${graph.nodes.length})`);
            result.nodes.forEach(n => console.log(`     [${n.id}] "${n.text}" status=${n.status ?? 'none'}`));
        } catch (e) { console.error('❌ applyPatch failed:', e); }
    }
}

main().catch(console.error);
