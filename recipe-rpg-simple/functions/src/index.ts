import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { genkit, z } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';
import { generateAndStoreIcon } from '../../lib/icon-generator';
import { setAIService, MockAIService } from '../../lib/ai-service';

// initializeApp() is called in lib usually, but we need db here.
// In Firebase Functions, admin is already initialized or we should do it.
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

// Flow wrapper for consistency if needed
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

// Helper to Queue Icons
async function enqueueIcons(graph: any, recipeId: string) {
    if (!graph || !graph.nodes) return;

    const nodesToProcess = graph.nodes.filter((n: any) => n.visualDescription && !n.iconId);
    if (nodesToProcess.length === 0) return;

    console.log(`[enqueueIcons] Found ${nodesToProcess.length} nodes to process for recipe ${recipeId}`);

    const batch = db.batch();
    let queuedCount = 0;
    
    // Track immediate updates for already completed items
    const immediateUpdates: { nodeId: string, iconId: string, iconUrl: string }[] = [];

    for (const node of nodesToProcess) {
        const rawName = node.visualDescription.trim();
        const name = rawName.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        
        // 1. Check existing in DB first (Optimization & Cleanup Support)
        const ingredientsRef = db.collection('ingredients');
        const q = await ingredientsRef.where('name', '==', name).limit(1).get();
        
        let foundInDb = false;
        if (!q.empty) {
            const ingredientDocId = q.docs[0].id;
            const iconsRef = db.collection(`ingredients/${ingredientDocId}/icons`);
            const iconSnap = await iconsRef.orderBy('popularity_score', 'desc').limit(1).get();
            if (!iconSnap.empty) {
                const iconDoc = iconSnap.docs[0];
                console.log(`[enqueueIcons] Found existing icon in DB for "${name}", updating immediately.`);
                immediateUpdates.push({ 
                    nodeId: node.id, 
                    iconId: iconDoc.id, 
                    iconUrl: iconDoc.data().url 
                });
                foundInDb = true;
            }
        }
        if (foundInDb) continue;

        const docRef = db.collection('icon_queue').doc(name);
        const docSnap = await docRef.get();
        const existingData = docSnap.data();

        if (existingData?.status === 'completed' && existingData.iconId && existingData.iconUrl) {
            console.log(`[enqueueIcons] Icon for "${name}" already completed, checking if recipe needs update.`);
            // We need to update the recipe because the frontend might not have it yet 
            // (e.g. cache miss in createVisualRecipeAction but queue has it).
            immediateUpdates.push({ 
                nodeId: node.id, 
                iconId: existingData.iconId, 
                iconUrl: existingData.iconUrl 
            });
            continue;
        }
        
        batch.set(docRef, {
            status: 'pending', 
            created_at: existingData?.created_at || FieldValue.serverTimestamp(),
            recipes: FieldValue.arrayUnion(recipeId) 
        }, { merge: true });
        queuedCount++;
    }
    
    if (immediateUpdates.length > 0) {
        console.log(`[enqueueIcons] Applying ${immediateUpdates.length} immediate updates to recipe ${recipeId}`);
        await db.runTransaction(async (t) => {
            const recipeRef = db.collection('recipes').doc(recipeId);
            const doc = await t.get(recipeRef);
            if (!doc.exists) return;
            const data = doc.data();
            if (!data?.graph?.nodes) return;
            
            const nodes = data.graph.nodes;
            let changed = false;
            
            immediateUpdates.forEach(update => {
                const nodeIndex = nodes.findIndex((n: any) => n.id === update.nodeId);
                if (nodeIndex !== -1 && !nodes[nodeIndex].iconId) {
                    nodes[nodeIndex].iconId = update.iconId;
                    nodes[nodeIndex].iconUrl = update.iconUrl;
                    changed = true;
                }
            });
            
            if (changed) {
                t.update(recipeRef, { "graph.nodes": nodes });
            }
        });
    }

    if (queuedCount > 0) {
        await batch.commit();
        console.log(`[enqueueIcons] Enqueued ${queuedCount} icons.`);
    }
}

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

        // 1. Check Existing Cache first
        let iconId: string | undefined, iconUrl: string | undefined;
        
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
        await event.data.after.ref.update({ 
            status: 'completed', 
            iconId, 
            iconUrl, 
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

// 1. Automatic Trigger on Creation
export const processNewRecipe = onDocumentCreated({ document: "recipes/{recipeId}", timeoutSeconds: 60, memory: "256MiB" }, async (event) => {
    if (!event.data) return;
    const newData = event.data.data();
    await enqueueIcons(newData.graph, event.params.recipeId);
});

// 2. Manual Callable Function (Debug / Retry)
export const backfillRecipeIcons = onCall({ timeoutSeconds: 60, memory: "256MiB" }, async (request) => {
    const recipeId = request.data.recipeId;
    if (!recipeId) throw new HttpsError('invalid-argument', 'Missing recipeId');

    const docRef = db.collection('recipes').doc(recipeId);
    const docSnap = await docRef.get();
    
    if (!docSnap.exists) throw new HttpsError('not-found', 'Recipe not found');
    
    await enqueueIcons(docSnap.data()?.graph, recipeId);
    
    return { success: true, message: "Queued icon generation." };
});
