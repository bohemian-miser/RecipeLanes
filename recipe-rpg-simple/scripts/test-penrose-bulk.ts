import 'dotenv/config';
import { JSDOM } from 'jsdom';

// Polyfill window/document for Penrose (MathJax)
const dom = new JSDOM();
global.window = dom.window as any;
global.document = dom.window.document;
global.navigator = dom.window.navigator;

import { db } from '../lib/firebase-admin';
import { calculatePenroseLayout } from '../lib/recipe-lanes/layout-penrose';
import type { RecipeGraph } from '../lib/recipe-lanes/types';

async function run() {
    console.log("Fetching recipes from Firestore...");
    try {
        const snapshot = await db.collection('recipes').limit(50).get();
        
        if (snapshot.empty) {
            console.log("No recipes found.");
            return;
        }

        console.log(`Found ${snapshot.size} recipes. Testing Penrose...`);

        let success = 0;
        let fail = 0;

        for (const doc of snapshot.docs) {
            const id = doc.id;
            const data = doc.data();
            const graph = data.graph as RecipeGraph;
            
            if (!graph || !graph.nodes) {
                console.log(`[SKIP] ${id} - Invalid graph structure`);
                continue;
            }

            process.stdout.write(`Testing Recipe ${id} (${graph.nodes.length} nodes)... `);
            
            try {
                // Timeout promise? Penrose might hang.
                const penrosePromise = calculatePenroseLayout(graph, 1);
                // Race with timeout
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error("Timeout (30s)")), 30000)
                );

                const layout: any = await Promise.race([penrosePromise, timeoutPromise]);
                
                console.log(`SUCCESS. Output nodes: ${layout.nodes.length}`);
                success++;
            } catch (e: any) {
                console.log("FAIL");
                console.error(`  Error: ${e.message}`);
                // Print detailed error for the first few
                if (fail < 3) {
                    if (e.errors) console.error("  Penrose Errors:", JSON.stringify(e.errors, null, 2));
                    else console.error(e);
                }
                fail++;
            }
        }

        console.log(`\n=== Summary ===`);
        console.log(`Success: ${success}`);
        console.log(`Failure: ${fail}`);
        
        if (fail > 0) process.exit(1);

    } catch (e: any) {
        console.error("Script Execution Failed:", e);
        process.exit(1);
    }
}

run();
