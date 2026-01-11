import {onDocumentWritten } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { generateAndStoreIcon } from './icon-generator';
import {  DB_COLLECTION_QUEUE } from '../../lib/config';
import { getDataService } from '../../lib/data-service';

// --- Helper Functions ---

/**
 * Worker Function (Queue Processor)
 * Processes items in 'icon_queue' collection.
 */
export const processIconQueue = onDocumentWritten({ 
    document: `${DB_COLLECTION_QUEUE}/{ingredientName}`, 
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

    // Double-check current state to handle race conditions (e.g. rapid delete/update)
    const currentSnap = await event.data.after.ref.get();
    if (!currentSnap.exists) {
        console.log(`[Queue] Skipped "${ingredientName}": Document no longer exists.`);
        return;
    }
    const currentData = currentSnap.data();
    if (currentData?.status !== 'pending') {
        console.log(`[Queue] Skipped "${ingredientName}": Status is '${currentData?.status}', expected 'pending'.`);
        return;
    }

    console.log(`[Queue] Processing: "${ingredientName}" for recipes: ${recipeIds.join(', ')}`);

    try {
        await event.data.after.ref.update({ status: 'processing' });
        console.log(`[Queue] Generating new icon for "${ingredientName}"...`);
        
        const result = await generateAndStoreIcon({ ingredientName });
        
        // Update all linked recipes using the atomic helper
        console.log(`[Queue] Updating ${recipeIds.length} recipes...`);
        const dataService = getDataService();
        
        for (const rId of recipeIds) {
            await dataService.assignIconToRecipe(rId, ingredientName, result);
        }

        // Delete the queue item now that processing is complete.
        await event.data.after.ref.delete();

        console.log(`[Queue] Completed and removed "${ingredientName}"`);

    } catch (e: any) {
        console.error(`[Queue] Failed "${ingredientName}":`, e);
        await event.data.after.ref.update({ 
            status: 'failed', 
            error: e.message, 
            updated_at: FieldValue.serverTimestamp() 
        });
    }
});