import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { genkit, z } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';
// import { processIcon } from './image-processing'; // Using lib now
import { generateAndStoreIcon } from '../../lib/icon-generator';
import { setAIService, MockAIService } from '../../lib/ai-service';

// initializeApp(); // Lib handles this now
const db = getFirestore();
const storage = getStorage();


if (process.env.FUNCTIONS_EMULATOR === 'true') {
    console.log('Enforcing Mock AI Service in Emulator');
    setAIService(new MockAIService());
}

const ai = genkit({
    plugins: [vertexAI({ location: 'us-central1' })], 
});

// Flow wrapper for consistency if needed, or we can just use the lib directly
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
      // We delegate to the shared generator
      // Note: generateAndStoreIcon saves to DB, which is more than what this flow promised (just gen).
      // But for our app flow, that's fine.
      // If we just want the URL:
      const result = await generateAndStoreIcon({ ingredientName: input.ingredient });
      return { url: result.url, prompt: result.prompt };
    }
  );

// Shared Logic for Backfilling Icons
async function backfillIcons(graph: any, recipeId: string) {
    console.log(`[backfillIcons] Checking recipe ${recipeId}...`);
    if (!graph || !graph.nodes) {
        console.log('[backfillIcons] No graph or nodes found.');
        return null;
    }

    const nodesToProcess = graph.nodes.filter((n: any) => 
        n.visualDescription && 
        !n.iconId 
    );
    console.log(`[backfillIcons] Found ${nodesToProcess.length} nodes to process out of ${graph.nodes.length}.`);

    if (nodesToProcess.length === 0) return null;

    console.log(`Processing ${nodesToProcess.length} nodes for recipe ${recipeId}`);
    
    const results = [];
    for (const node of nodesToProcess) {
        try {
            const rawName = node.visualDescription.trim();
            const name = rawName.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
            
            // Check existing first (Optimization)
            const ingredientsRef = db.collection('ingredients');
            const q = await ingredientsRef.where('name', '==', name).limit(1).get();
            
            if (!q.empty) {
                const ingredientDocId = q.docs[0].id;
                const iconsRef = db.collection(`ingredients/${ingredientDocId}/icons`);
                const iconSnap = await iconsRef.orderBy('popularity_score', 'desc').limit(1).get();
                if (!iconSnap.empty) {
                    const iconDoc = iconSnap.docs[0];
                    results.push({ nodeId: node.id, iconId: iconDoc.id, iconUrl: iconDoc.data().url });
                    continue;
                }
            }

            console.log(`-> Generating icon for ${name}...`);
            const result = await generateAndStoreIcon({ ingredientName: name });
            results.push({ nodeId: node.id, iconId: result.id, iconUrl: result.url });

        } catch (e) {
            console.error(`Failed to process node ${node.id}:`, e);
            results.push(null);
        }
    }

    const successfulUpdates = results.filter(r => r !== null);
    if (successfulUpdates.length === 0) return null;

    const currentNodes = [...graph.nodes];
    let changed = false;

    successfulUpdates.forEach((update: any) => {
        const nodeIndex = currentNodes.findIndex((n: any) => n.id === update.nodeId);
        if (nodeIndex !== -1) {
            currentNodes[nodeIndex] = {
                ...currentNodes[nodeIndex],
                iconId: update.iconId,
                iconUrl: update.iconUrl
            };
            changed = true;
        }
    });

    return changed ? currentNodes : null;
}

// 1. Automatic Trigger on Creation
export const processNewRecipe = onDocumentCreated({ document: "recipes/{recipeId}", timeoutSeconds: 300, memory: "1GiB" }, async (event) => {
    if (!event.data) return;
    const newData = event.data.data();
    const updatedNodes = await backfillIcons(newData.graph, event.params.recipeId);
    if (updatedNodes) {
        try {
            return await event.data.ref.update({ "graph.nodes": updatedNodes });
        } catch (e: any) {
            // Ignore NOT_FOUND errors if the recipe was deleted while processing
            if (e.code === 5 || e.message?.includes('NOT_FOUND')) {
                console.log(`[processNewRecipe] Recipe ${event.params.recipeId} deleted before update.`);
                return null;
            }
            throw e;
        }
    }
    return null;
});

// 2. Manual Callable Function (Debug / Retry)
export const backfillRecipeIcons = onCall({ timeoutSeconds: 300, memory: "1GiB" }, async (request) => {
    const recipeId = request.data.recipeId;
    if (!recipeId) throw new HttpsError('invalid-argument', 'Missing recipeId');

    const docRef = db.collection('recipes').doc(recipeId);
    const docSnap = await docRef.get();
    
    if (!docSnap.exists) throw new HttpsError('not-found', 'Recipe not found');
    
    const updatedNodes = await backfillIcons(docSnap.data()?.graph, recipeId);
    
    if (updatedNodes) {
        await docRef.update({ "graph.nodes": updatedNodes });
        return { success: true, count: updatedNodes.length };
    }
    return { success: true, count: 0 };
});
