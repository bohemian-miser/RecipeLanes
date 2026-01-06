import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { genkit, z } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';
import { generateAndStoreIcon } from '../../lib/icon-generator';
import { setAIService, MockAIService } from '../../lib/ai-service';
import { DB_COLLECTION_INGREDIENTS, DB_COLLECTION_QUEUE, DB_COLLECTION_RECIPES } from '../../lib/config';

const db = getFirestore();
const storage = getStorage();

console.log(`[Functions] Initializing. MOCK_AI: ${process.env.MOCK_AI}, FUNCTIONS_EMULATOR: ${process.env.FUNCTIONS_EMULATOR}, BUCKET: ${process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET}, PROJECT: ${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}`);

if (process.env.FUNCTIONS_EMULATOR === 'true') {
    console.log('Enforcing Mock AI Service in Emulator');
    setAIService(new MockAIService());
}

const ai = genkit({
    plugins: [vertexAI({ location: 'us-central1' })], 
});

export const generateIcon = ai.defineFlow(
    {
      name: 'generateIcon',
      inputSchema: z.object({
        ingredient: z.string(),
      }),
      outputSchema: z.object({
        url: z.string(),
        prompt: z.string(),
      }),
    },
    async (input) => {
      const result = await generateAndStoreIcon({ ingredientName: input.ingredient });
      return { url: result.url, prompt: result.prompt };
    }
  );

// Helper
function standardizeName(name: string): string {
    return name.trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

// Worker Function (Queue Processor)
export const processIconQueue = onDocumentWritten({ 
    document: `${DB_COLLECTION_QUEUE}/{ingredientName}`, 
    timeoutSeconds: 300, 
    memory: "1GiB",
    maxInstances: 1 
}, async (event) => {
    if (!event.data || !event.data.after) return;
    const data = event.data.after.data();
    
    if (!data) return;

    const rawIngredientName = event.params.ingredientName;
    const ingredientName = standardizeName(rawIngredientName);
    const recipeIds: string[] = data.recipes || [];
    const hasRecipes = recipeIds.length > 0;

    // If status is 'processing', assume active runner handles it.
    // If active runner misses new IDs, it will write 'completed' later, triggering us again.
    if (data.status === 'processing') return;

    // If pending, OR (completed/failed AND has new recipes to process)
    if (data.status !== 'pending' && !hasRecipes) return;

    console.log(`[Queue] Processing: "${ingredientName}" for recipes: ${recipeIds.join(', ')}`);

    try {
        // Lock it. Note: If we crash here, it stays 'processing'. Cloud Functions retry should handle it if enabled, 
        // but 'onDocumentWritten' retry policy needs config. For now, assume reliability.
        await event.data.after.ref.update({ status: 'processing' });

        // 1. Load Cache (ingredients_new)
        const ingDoc = await db.collection(DB_COLLECTION_INGREDIENTS).doc(ingredientName).get();
        let cache = ingDoc.exists ? (ingDoc.data()?.icons || []) : [];
        
        // Ensure cache is sorted by score
        cache.sort((a: any, b: any) => (b.score || 0) - (a.score || 0));

        let generatedIcon: any = null;

        // 2. Process Each Recipe
        console.log(`[Queue] Checking ${recipeIds.length} recipes for updates...`);
        
        for (const rId of recipeIds) {
            await db.runTransaction(async (t) => {
                const recipeRef = db.collection(DB_COLLECTION_RECIPES).doc(rId);
                const doc = await t.get(recipeRef);
                if (!doc.exists) return;
                
                const recipeData = doc.data();
                if (!recipeData?.graph?.nodes) return;
                
                const nodes = recipeData.graph.nodes;
                const rejections = recipeData.graph.rejections?.[ingredientName] || [];
                const rejectedSet = new Set(rejections); // IDs or URLs

                // Find Best Icon for this Recipe
                let selectedIcon = null;
                
                // Try from Cache
                for (const icon of cache) {
                    if (!rejectedSet.has(icon.id) && !rejectedSet.has(icon.url) && !rejectedSet.has(icon.path)) {
                        selectedIcon = icon;
                        break;
                    }
                }

                // Try from recently generated (in this run)
                if (!selectedIcon && generatedIcon) {
                    if (!rejectedSet.has(generatedIcon.id)) {
                        selectedIcon = generatedIcon;
                    }
                }

                // If still no icon, GENERATE NEW
                if (!selectedIcon) {
                    // Only generate ONE new icon per batch run to avoid spamming if multiple recipes reject everything.
                    // Subsequent recipes will use this new one.
                    if (!generatedIcon) {
                        console.log(`[Queue] Generating new icon for "${ingredientName}" (Reason: Cache empty or all rejected by ${rId})...`);
                        const result = await generateAndStoreIcon({ ingredientName });
                        
                        generatedIcon = {
                            id: result.id,
                            url: result.url,
                            path: result.path || '', 
                            score: 0
                        };
                        
                        // Add to local cache for subsequent recipes
                        cache.unshift(generatedIcon);
                    }
                    selectedIcon = generatedIcon;
                }

                // Update Nodes
                let changed = false;
                nodes.forEach((n: any) => {
                    if (n.visualDescription) {
                         const nName = standardizeName(n.visualDescription);
                         if (nName === ingredientName) {
                             if (selectedIcon && n.iconId !== selectedIcon.id) {
                                 n.iconId = selectedIcon.id;
                                 n.iconUrl = selectedIcon.url;
                                 changed = true;
                             }
                         }
                    }
                });
                
                if (changed) {
                    t.update(recipeRef, { "graph.nodes": nodes });
                }
            });
        }

        // 3. Standalone / Fallback Generation
        if (!generatedIcon && recipeIds.length === 0) {
             // Only force generation if we are in 'pending' state (explicit request)
             // OR if we are re-running for some reason?
             // If status was 'completed' and recipes=[], we returned early above.
             // So here status MUST be 'pending' (or we passed guard).
             console.log(`[Queue] Standalone request for "${ingredientName}". Generating new icon...`);
             const result = await generateAndStoreIcon({ ingredientName });
             generatedIcon = { id: result.id, url: result.url, path: result.path || '' };
             cache.unshift(generatedIcon);
        }

        // 4. Mark Queue Done & CLEAR processed recipes
        const finalIcon = generatedIcon || cache[0] || null;
        
        const update: any = { 
            status: 'completed', 
            iconId: finalIcon?.id || null, 
            iconUrl: finalIcon?.url || null, 
            updated_at: FieldValue.serverTimestamp() 
        };

        if (recipeIds.length > 0) {
            update.recipes = FieldValue.arrayRemove(...recipeIds);
        }
        
        await event.data.after.ref.update(update);
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

// Manual Callable Function (Debug / Retry)
// Updated to use the new queue system manually
export const backfillRecipeIcons = onCall({ timeoutSeconds: 60, memory: "256MiB" }, async (request) => {
    const recipeId = request.data.recipeId;
    if (!recipeId) throw new HttpsError('invalid-argument', 'Missing recipeId');

    const docRef = db.collection(DB_COLLECTION_RECIPES).doc(recipeId);
    const docSnap = await docRef.get();
    
    if (!docSnap.exists) throw new HttpsError('not-found', 'Recipe not found');
    const graph = docSnap.data()?.graph;
    
    if (graph && graph.nodes) {
        const nodesToProcess = graph.nodes.filter((n: any) => n.visualDescription && !n.iconId);
        const batch = db.batch();
        nodesToProcess.forEach((n: any) => {
             const name = standardizeName(n.visualDescription);
             const qRef = db.collection(DB_COLLECTION_QUEUE).doc(name);
             batch.set(qRef, { 
                 status: 'pending', 
                 recipes: FieldValue.arrayUnion(recipeId),
                 created_at: FieldValue.serverTimestamp() 
             }, { merge: true });
        });
        await batch.commit();
    }
    
    return { success: true, message: "Queued icon generation." };
});