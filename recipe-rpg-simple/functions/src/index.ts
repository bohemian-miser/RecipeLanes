import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { genkit, z } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';
import { generateAndStoreIcon } from '../../lib/icon-generator';
import { setAIService, MockAIService } from '../../lib/ai-service';

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
    document: "icon_queue/{ingredientName}", 
    timeoutSeconds: 300, 
    memory: "1GiB",
    maxInstances: 1 
}, async (event) => {
    if (!event.data || !event.data.after) return;
    const data = event.data.after.data();
    
    if (!data || data.status !== 'pending') return;

    const rawIngredientName = event.params.ingredientName;
    const ingredientName = standardizeName(rawIngredientName);
    const recipeIds: string[] = data.recipes || [];

    console.log(`[Queue] Processing: "${ingredientName}" for recipes: ${recipeIds.join(', ')}`);

    try {
        await event.data.after.ref.update({ status: 'processing' });

        // 1. Load Cache (ingredients_new)
        const ingDoc = await db.collection('ingredients_new').doc(ingredientName).get();
        let cache = ingDoc.exists ? (ingDoc.data()?.icons || []) : [];
        
        // Ensure cache is sorted by score
        cache.sort((a: any, b: any) => (b.score || 0) - (a.score || 0));

        let generatedIcon: any = null;

        // 2. Process Each Recipe
        console.log(`[Queue] Checking ${recipeIds.length} recipes for updates...`);
        
        for (const rId of recipeIds) {
            await db.runTransaction(async (t) => {
                const recipeRef = db.collection('recipes').doc(rId);
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
                    if (!generatedIcon) {
                        console.log(`[Queue] Generating new icon for "${ingredientName}" (Reason: Cache empty or all rejected by ${rId})...`);
                        // This generates and saves to DB (updating ingredients_new)
                        const result = await generateAndStoreIcon({ ingredientName });
                        
                        generatedIcon = {
                            id: result.id,
                            url: result.url,
                            path: result.path || '', // Ensure generateAndStoreIcon returns path if possible, or we derive it
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
                             // Only update if missing or if this is an explicit reroll (which implies we want *something* new)
                             // Actually, if we are in the queue, we want an update.
                             // But check if current icon is already the selected one?
                             if (n.iconId !== selectedIcon.id) {
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
        // If no recipes were provided (Main Page) or if we iterated recipes but didn't generate (maybe race condition?), 
        // we should ensure an icon is available. 
        // Specifically for Standalone (recipeIds.length === 0), queueIcons only triggers if cache was rejected/empty.
        // So we MUST generate.
        if (!generatedIcon && recipeIds.length === 0) {
             console.log(`[Queue] Standalone request for "${ingredientName}". Generating new icon...`);
             const result = await generateAndStoreIcon({ ingredientName });
             generatedIcon = { id: result.id, url: result.url, path: result.path || '' };
             cache.unshift(generatedIcon);
        }

        // 4. Mark Queue Done
        // We use the ID of the *last generated* or *best available* icon as the global result
        // But mainly we care that processing is done.
        const finalIcon = generatedIcon || cache[0] || null;
        
        await event.data.after.ref.update({ 
            status: 'completed', 
            iconId: finalIcon?.id || null, 
            iconUrl: finalIcon?.url || null, 
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

// Manual Callable Function (Debug / Retry)
// Updated to use the new queue system manually
export const backfillRecipeIcons = onCall({ timeoutSeconds: 60, memory: "256MiB" }, async (request) => {
    const recipeId = request.data.recipeId;
    if (!recipeId) throw new HttpsError('invalid-argument', 'Missing recipeId');

    const docRef = db.collection('recipes').doc(recipeId);
    const docSnap = await docRef.get();
    
    if (!docSnap.exists) throw new HttpsError('not-found', 'Recipe not found');
    const graph = docSnap.data()?.graph;
    
    if (graph && graph.nodes) {
        const nodesToProcess = graph.nodes.filter((n: any) => n.visualDescription && !n.iconId);
        const batch = db.batch();
        nodesToProcess.forEach((n: any) => {
             const name = standardizeName(n.visualDescription);
             const qRef = db.collection('icon_queue').doc(name);
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