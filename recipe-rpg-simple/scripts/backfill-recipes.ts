import 'dotenv/config';
import { db } from '../lib/firebase-admin';
import type { RecipeGraph } from '../lib/recipe-lanes/types';
import { ai, textModel } from '../lib/genkit';

async function generateTitle(text: string): Promise<string> {
    try {
        const { text: title } = await ai.generate({
            model: textModel,
            prompt: `Generate a concise (max 5 words), appetizing title for this cooking recipe. Do not use quotes. Just the title. Text: "${text.substring(0, 1000)}"...`,
            config: { temperature: 0.3 }
        });
        return title.trim().replace(/^"|"$/g, '');
    } catch (e) {
        console.error("AI Title Gen Failed:", e);
        return "";
    }
}

async function backfill() {
    console.log("Backfilling and Deduping Recipes with AI Titles...");
    
    const snapshot = await db.collection('recipes').orderBy('created_at', 'desc').get();
    console.log(`Total recipes: ${snapshot.size}`);

    const seenText = new Map<string, string>(); 
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

        // Smart Title Logic
        const currentTitle = graph.title || "";
        // Heuristic: If missing, "Ingredients", too long (>40 chars), or looks like instructions
        const isBad = !currentTitle || 
                      currentTitle.toLowerCase() === 'ingredients' || 
                      currentTitle.length > 40 || 
                      currentTitle.includes('\n') ||
                      /^(crack|mix|add|cut|slice|boil|cook)/i.test(currentTitle);

        if (isBad && graph.originalText) {
            process.stdout.write(`Generating title for ${doc.id}... `);
            const newTitle = await generateTitle(graph.originalText);
            if (newTitle) {
                console.log(`"${newTitle}" (was: "${currentTitle.substring(0, 20)}"...)`);
                graph.title = newTitle;
                updates.push(doc.ref.update({ graph }));
            } else {
                console.log("Failed.");
            }
        }
    }

    console.log(`Processing... Deleting ${deletes.length}, Updating ${updates.length}.`);
    await Promise.all([...deletes, ...updates]);
    console.log("Done.");
}

backfill().catch(console.error);