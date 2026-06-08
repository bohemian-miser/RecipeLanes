/**
 * Debug script: run one or more adjustments against a live recipe in sequence.
 * Shows the full AI prompt, raw response, patch/graph detection, and applyPatch result.
 *
 * Usage:
 *   npx tsx --env-file=.env.staging scripts/debug-adjust.ts <recipeId> "<step1>" ["<step2>" ...]
 *
 * Each instruction is applied to the result of the previous one, simulating a real chat session.
 */
import 'dotenv/config';
import { db } from '../lib/firebase-admin';
import { generateAdjustmentPrompt } from '../lib/recipe-lanes/adjuster';
import { applyPatch, preserveNodeShortlist } from '../lib/recipe-lanes/model-utils';
import { parseRecipeGraph } from '../lib/recipe-lanes/parser';
import { getAIService } from '../lib/ai-service';
import type { RecipeGraph, RecipePatch } from '../lib/recipe-lanes/types';

function parseJson(raw: string): any {
    let s = raw.trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) s = fence[1].trim();
    else { const a = s.indexOf('{'), b = s.lastIndexOf('}'); if (a !== -1 && b > a) s = s.slice(a, b + 1); }
    return JSON.parse(s);
}

async function runStep(graph: RecipeGraph, instruction: string, stepNum: number): Promise<RecipeGraph> {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Step ${stepNum}: "${instruction}"`);
    console.log(`${'─'.repeat(60)}`);

    const prompt = generateAdjustmentPrompt(graph, instruction);
    console.log(`Prompt: ${prompt.length} chars`);

    const t0 = Date.now();
    const raw = await getAIService().generateText(prompt);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\nAI response (${elapsed}s, ${raw.length} chars):\n${raw}`);

    let parsed: any;
    try { parsed = parseJson(raw); }
    catch (e) { console.error('\n❌ JSON parse failed:', e); return graph; }

    if (parsed.lanes && parsed.nodes) {
        console.log('\n✅ Full graph returned');
        try {
            const newGraph = parseRecipeGraph(JSON.stringify(parsed));
            // Restore icons for unchanged nodes
            newGraph.nodes = newGraph.nodes.map(n => {
                const old = graph.nodes.find(o => o.id === n.id);
                return old ? preserveNodeShortlist(n, old) : n;
            });
            console.log(`   ${newGraph.nodes.length} nodes, ${newGraph.lanes.length} lanes`);
            printNodeList(newGraph);
            return newGraph;
        } catch (e) { console.error('❌ parseRecipeGraph failed:', e); return graph; }
    } else {
        const patch = parsed as RecipePatch;
        console.log('\n✅ Patch returned');
        console.log(`   message:      "${patch.message}"`);
        console.log(`   addNodes:     ${patch.addNodes?.length ?? 0} ${(patch.addNodes ?? []).map(n => `"${n.text}"`).join(', ')}`);
        console.log(`   updateNodes:  ${patch.updateNodes?.length ?? 0} ${(patch.updateNodes ?? []).map(n => n.id).join(', ')}`);
        console.log(`   removeNodeIds:${JSON.stringify(patch.removeNodeIds ?? [])}`);

        const existingIds = new Set(graph.nodes.map(n => n.id));
        const missing = (patch.removeNodeIds ?? []).filter(id => !existingIds.has(id));
        if (missing.length) console.warn(`\n⚠️  removeNodeIds not in graph: ${JSON.stringify(missing)}`);

        try {
            const result = applyPatch(graph, patch);
            const delta = result.nodes.length - graph.nodes.length;
            console.log(`\n   applyPatch: ${result.nodes.length} nodes (${delta >= 0 ? '+' : ''}${delta})`);
            printNodeList(result);
            return result;
        } catch (e) { console.error('❌ applyPatch failed:', e); return graph; }
    }
}

function printNodeList(graph: RecipeGraph) {
    graph.nodes.forEach(n => {
        const icon = n.iconShortlist?.length ? '🖼' : (n.status === 'pending' ? '⏳' : '❌');
        console.log(`     ${icon} [${n.id}] "${n.text}" (${n.type})`);
    });
}

async function main() {
    const args = process.argv.slice(2);
    const recipeId = args[0];
    const instructions = args.slice(1);
    if (!recipeId || instructions.length === 0) {
        console.error('Usage: npx tsx --env-file=.env.staging scripts/debug-adjust.ts <recipeId> "<step1>" ["<step2>" ...]');
        process.exit(1);
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Recipe: ${recipeId}`);
    console.log(`${'═'.repeat(60)}`);
    const snap = await db.collection('recipes').doc(recipeId).get();
    if (!snap.exists) { console.error('Recipe not found'); process.exit(1); }
    let graph = snap.data()!.graph as RecipeGraph;
    console.log(`Title: ${graph.title}  Nodes: ${graph.nodes.length}  Lanes: ${graph.lanes.length}`);
    console.log('Initial nodes:');
    printNodeList(graph);

    for (let i = 0; i < instructions.length; i++) {
        graph = await runStep(graph, instructions[i], i + 1);
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log('Final graph:');
    console.log(`  ${graph.nodes.length} nodes, ${graph.lanes.length} lanes`);
    printNodeList(graph);
}

main().catch(console.error);
