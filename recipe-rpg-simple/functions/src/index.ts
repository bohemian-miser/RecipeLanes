import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAIService } from '../../lib/ai-service';
import { getDataService } from '../../lib/data-service';
import { processIcon } from './image-processing';
import { generateAndStoreIcon } from './icon-generator';
import { DB_COLLECTION_INGREDIENTS, DB_COLLECTION_QUEUE, DB_COLLECTION_RECIPES } from '../../lib/config';
import { standardizeIngredientName } from '../../lib/utils';
import { db } from '../../lib/firebase-admin';

// --- Helper Functions ---


/**
 * Worker Function (Queue Processor)
 * Processes items in 'icon_queue' collection.
 */
export const processIconQueue = onDocumentWritten({ 
    document: "icon_queue/{ingredientName}", 
    timeoutSeconds: 300, 
    memory: "1GiB",
    maxInstances: 1 
}, async (event) => {
    if (!event.data || !event.data.after) return;
    const data = event.data.after.data();
    
    // Only process if status is 'pending'
    if (!data || data.status !== 'pending') return;

    const ingredientName = event.params.ingredientName;
    const recipeIds: string[] = data.recipes || [];

    console.log(`[Queue] Processing: "${ingredientName}" for recipes: ${recipeIds.join(', ')}`);

    try {
        await event.data.after.ref.update({ status: 'processing' });
        console.log(`[Queue] Generating new icon for "${ingredientName}"...`);
        
        const result = await generateAndStoreIcon({ ingredientName });
        
        // Update all linked recipes
        console.log(`[Queue] Updating ${recipeIds.length} recipes...`);
        for (const rId of recipeIds) {
            const recipeRef = db.collection(DB_COLLECTION_RECIPES).doc(rId);
            await db.runTransaction(async (t) => {
                const doc = await t.get(recipeRef);
                if (!doc.exists) return;
                const recipeData = doc.data();
                if (!recipeData?.graph?.nodes) return;
                
                const nodes = recipeData.graph.nodes;
                let changed = false;
                
                nodes.forEach((n: any) => {
                    if (n.visualDescription && !n.iconId) {
                         const nName = standardizeIngredientName(String(n.visualDescription));
                        if (nName === ingredientName) {
                            // Update node with new icon details
                            n.iconId = result.id;
                            n.iconUrl = result.url;
                            changed = true;
                        }
                    }
                });
                
                if (changed) {
                    t.update(recipeRef, { "graph.nodes": nodes });
                }
            });
        }

        //TODO: Delete the record. Any in flight recipes that would be added 
        // to the backlog, will instead have their reject list checked and find
        // the new icon in the cache.
        await event.data.after.ref.update({ 
            status: 'completed',
            iconId: result.id,
            iconUrl: result.url,
            updated_at: FieldValue.serverTimestamp()
        });

        console.log(`[Queue] Completed "${ingredientName}"`);

    } catch (e: any) {
        console.error(`[Queue] Failed "${ingredientName}":`, e);
        await event.data.after.ref.update({ 
            status: 'failed', 
            error: e.message, 
            updated_at: FieldValue.serverTimestamp() 
        });
    }
});