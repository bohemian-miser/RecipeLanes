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

/*
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
*/

// Helper
function standardizeName(name: string): string {
    return name.trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

// count parameter allows batch recording of impressions when a single icon is assigned to multiple waiting recipes simultaneously.
async function recordImpression(ingredientId: string, iconId: string, count: number = 1) {
    const docRef = db.collection(DB_COLLECTION_INGREDIENTS).doc(ingredientId);
    try {
      await db.runTransaction(async (t) => {
          const doc = await t.get(docRef);
          if (!doc.exists) return;
          const data = doc.data() || {};
          const icons = data.icons || [];
          
          const index = icons.findIndex((i: any) => i.id === iconId);
          if (index !== -1) {
              icons[index].impressions = (icons[index].impressions || 0) + count;
              const n = icons[index].impressions;
              const r = icons[index].rejections || 0;
              // Wilson Score
              if (n > 0) {
                  const k = n - r; const p = k / n; const z = 1.645;
                  const den = 1 + (z * z) / n;
                  const centre = p + (z * z) / (2 * n);
                  const adj = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
                  icons[index].score = Math.max(0, (centre - adj) / den);
              }
              icons.sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
              t.update(docRef, { icons });
          }
      });
    } catch (e) { console.error('recordImpression failed', e); }
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
    if (data.status === 'processing') return;

    // If pending, OR (completed/failed AND has new recipes to process)
    if (data.status !== 'pending' && !hasRecipes) return;

    console.log(`[Queue] Processing: "${ingredientName}" for recipes: ${recipeIds.join(', ')}`);

    try {
        // Lock it
        await event.data.after.ref.update({ status: 'processing' });

        // 1. GENERATE NEW ICON (Batch Mode)
        // Contract: If requests are in the queue, they have exhausted the cache.
        // We generate ONE new icon for the entire waiting batch.
        console.log(`[Queue] Generating new icon for "${ingredientName}" (Batch size: ${recipeIds.length})...`);
        const result = await generateAndStoreIcon({ ingredientName });
        
        const newIconId = result.id;
        const newIconUrl = result.url;
        const newMetadata = result.metadata;

        // 2. FAN-OUT UPDATES
        console.log(`[Queue] Assigning new icon ${newIconId} to ${recipeIds.length} recipes...`);
        
        let successCount = 0;

        for (const rId of recipeIds) {
            await db.runTransaction(async (t) => {
                const recipeRef = db.collection(DB_COLLECTION_RECIPES).doc(rId);
                const doc = await t.get(recipeRef);
                if (!doc.exists) return;
                
                const recipeData = doc.data();
                if (!recipeData?.graph?.nodes) return;
                
                const nodes = recipeData.graph.nodes;
                let changed = false;

                nodes.forEach((n: any) => {
                    if (n.visualDescription) {
                         const nName = standardizeName(n.visualDescription);
                         if (nName === ingredientName) {
                             // Blindly update. They queued for a new icon, they get it.
                             if (n.iconId !== newIconId) {
                                 n.iconId = newIconId;
                                 n.iconUrl = newIconUrl;
                                 if (newMetadata) n.iconMetadata = newMetadata;
                                 changed = true;
                             }
                         }
                    }
                });
                
                if (changed) {
                    t.update(recipeRef, { "graph.nodes": nodes });
                    successCount++;
                }
            });
        }

        // 3. RECORD IMPRESSIONS
        if (successCount > 0) {
            await recordImpression(ingredientName, newIconId, successCount);
        }

        // 4. CLEANUP
        const update: any = { 
            status: 'completed', 
            iconId: newIconId, 
            iconUrl: newIconUrl, 
            updated_at: FieldValue.serverTimestamp() 
        };
        
        if (newMetadata) update.metadata = newMetadata;

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