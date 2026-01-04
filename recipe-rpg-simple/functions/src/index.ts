import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { genkit, z } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';
// import { processIcon } from './image-processing'; // Using lib now
import { generateAndStoreIcon } from '../../lib/icon-generator';
import { setAIService, MockAIService } from '../../lib/ai-service';

// ... (skipping unchanged code until processIconQueue) ...

// Worker Function (Queue Processor)
// Max Instances = 1 to throttle rate
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

        // 1. Check Existing Cache first (Optimization)
        let iconId, iconUrl;
        
        const ingredientsRef = db.collection('ingredients');
        const q = await ingredientsRef.where('name', '==', ingredientName).limit(1).get();
        
        if (!q.empty) {
            const ingredientDocId = q.docs[0].id;
            const iconsRef = db.collection(`ingredients/${ingredientDocId}/icons`);
            const iconSnap = await iconsRef.orderBy('popularity_score', 'desc').limit(1).get();
            if (!iconSnap.empty) {
                const iconDoc = iconSnap.docs[0];
                iconId = iconDoc.id;
                iconUrl = iconDoc.data().url;
                console.log(`[Queue] Found existing icon for "${ingredientName}"`);
            }
        }

        // 2. Generate if missing
        if (!iconId) {
             console.log(`[Queue] Generating new icon for "${ingredientName}"...`);
             const result = await generateAndStoreIcon({ ingredientName });
             iconId = result.id;
             iconUrl = result.url;
        }
        
        // 3. Update all linked recipes
        console.log(`[Queue] Updating ${recipeIds.length} recipes...`);
        for (const rId of recipeIds) {
            const recipeRef = db.collection('recipes').doc(rId);
            await db.runTransaction(async (t) => {
                const doc = await t.get(recipeRef);
                if (!doc.exists) return;
                const recipeData = doc.data();
                if (!recipeData?.graph?.nodes) return;
                
                const nodes = recipeData.graph.nodes;
                let changed = false;
                
                nodes.forEach((n: any) => {
                    if (n.visualDescription && !n.iconId) {
                         // Loose match on name (normalized)
                         const nName = n.visualDescription.trim().split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
                         if (nName === ingredientName) {
                             n.iconId = iconId;
                             n.iconUrl = iconUrl;
                             changed = true;
                         }
                    }
                });
                
                if (changed) {
                    t.update(recipeRef, { "graph.nodes": nodes });
                }
            });
        }

        // 4. Mark Queue Done
        await event.data.after.ref.update({ status: 'completed', iconId, iconUrl, updated_at: FieldValue.serverTimestamp() });
        console.log(`[Queue] Completed "${ingredientName}"`);

    } catch (e: any) {
        console.error(`[Queue] Failed "${ingredientName}":`, e);
        // We log error but don't throw to avoid infinite retry loops on fatal errors.
        // Status 'failed' allows manual retry/inspection.
        await event.data.after.ref.update({ status: 'failed', error: e.message, updated_at: FieldValue.serverTimestamp() });
    }
});

// 1. Automatic Trigger on Creation
export const processNewRecipe = onDocumentCreated({ document: "recipes/{recipeId}", timeoutSeconds: 60, memory: "256MiB" }, async (event) => {
    if (!event.data) return;
    const newData = event.data.data();
    // Use Queue instead of direct processing
    await enqueueIcons(newData.graph, event.params.recipeId);
});

// 2. Manual Callable Function (Debug / Retry)
export const backfillRecipeIcons = onCall({ timeoutSeconds: 60, memory: "256MiB" }, async (request) => {
    const recipeId = request.data.recipeId;
    if (!recipeId) throw new HttpsError('invalid-argument', 'Missing recipeId');

    const docRef = db.collection('recipes').doc(recipeId);
    const docSnap = await docRef.get();
    
    if (!docSnap.exists) throw new HttpsError('not-found', 'Recipe not found');
    
    // Trigger Queue
    await enqueueIcons(docSnap.data()?.graph, recipeId);
    
    return { success: true, message: "Queued icon generation." };
});
