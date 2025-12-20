import 'dotenv/config';
import { db } from '../lib/firebase-admin';
import type { RecipeGraph } from '../lib/recipe-lanes/types';

async function backfill() {
    console.log("Backfilling and Deduping Recipes...");
    
    const snapshot = await db.collection('recipes').orderBy('created_at', 'desc').get();
    console.log(`Total recipes: ${snapshot.size}`);

    const seenText = new Map<string, string>(); // TextHash -> KeepID
    const updates: Promise<any>[] = [];
    const deletes: Promise<any>[] = [];

    let keptCount = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const graph = data.graph as RecipeGraph;
        
        if (!graph) continue;

        let shouldDelete = false;

        // Dedupe Logic
        if (graph.originalText) {
            const key = graph.originalText.trim().toLowerCase();
            if (seenText.has(key)) {
                console.log(`Duplicate found: ${doc.id} (matches ${seenText.get(key)})`);
                deletes.push(doc.ref.delete());
                shouldDelete = true;
            } else {
                seenText.set(key, doc.id);
                keptCount++;
            }
        } else {
            keptCount++;
        }

        if (shouldDelete) continue;

        // Backfill Title Logic
        if (!graph.title && graph.originalText) {
            let title = graph.originalText.split('\n')[0].trim();
            // Cleanup markdown headers
            title = title.replace(/^#+\s*/, '').replace(/\*+/g, '').trim();
            if (title.length > 50) title = title.substring(0, 50) + '...';
            
            if (title) {
                console.log(`Backfilling title for ${doc.id}: "${title}"`);
                graph.title = title;
                updates.push(doc.ref.update({ graph }));
            }
        }
    }

    console.log(`Processing... Deleting ${deletes.length}, Updating ${updates.length}. Kept ${keptCount}.`);
    await Promise.all([...deletes, ...updates]);
    console.log("Done.");
}

backfill().catch(console.error);
