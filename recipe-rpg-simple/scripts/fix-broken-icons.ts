import dotenv from 'dotenv';
import { standardizeIngredientName } from '../lib/utils';

async function fixBrokenIcons() {
    dotenv.config();
    const { db } = await import('../lib/firebase-admin');

    console.log('--- Fixing Broken Icons ---');

    // 1. Build Cache of Valid Icon IDs
    console.log('Loading valid icons from Ingredients...');
    const ingSnapshot = await db.collection('ingredients_new').get();
    const validIconIds = new Set<string>();
    
    ingSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.icons && Array.isArray(data.icons)) {
            data.icons.forEach((i: any) => validIconIds.add(i.id));
        }
    });
    console.log(`Loaded ${validIconIds.size} valid icon IDs.`);

    // 2. Scan Recipes
    console.log('Scanning Recipes...');
    const recSnapshot = await db.collection('recipes').get();
    
    let fixedCount = 0;
    const batch = db.batch();
    let opCount = 0;

    for (const doc of recSnapshot.docs) {
        const data = doc.data();
        const graph = data.graph;
        if (!graph || !Array.isArray(graph.nodes)) continue;

        let changed = false;
        const newNodes = graph.nodes.map((n: any) => {
            if (n.iconId) {
                if (!validIconIds.has(n.iconId)) {
                    console.log(`[Broken] Recipe "${doc.id}" Node "${n.text}": Icon ${n.iconId} not found in DB. Removing.`);
                    // Clear icon
                    const { icon, iconId, iconUrl, ...rest } = n;
                    changed = true;
                    return rest;
                }
            }
            return n;
        });

        if (changed) {
            batch.update(doc.ref, { "graph.nodes": newNodes });
            fixedCount++;
            opCount++;
            if (opCount >= 400) {
                await batch.commit();
                opCount = 0;
            }
        }
    }

    if (opCount > 0) {
        await batch.commit();
    }

    console.log('--- Complete ---');
    console.log(`Fixed ${fixedCount} recipes.`);
}

fixBrokenIcons().catch(console.error);
