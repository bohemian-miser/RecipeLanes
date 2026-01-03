import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { genkit, z } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';
import { processIcon } from './image-processing';

initializeApp();
const db = getFirestore();
const storage = getStorage();

const ai = genkit({
    plugins: [vertexAI({ location: 'us-central1' })], 
});

const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

const generateIcon = ai.defineFlow(
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
      const prompt = `Generate a high-quality 64x64 pixel art icon of ${input.ingredient}. The style should be distinct, colorful, and clearly recognizable, suitable for a game inventory or flowchart. Use clean outlines and bright colors. Ensure the background is white.`;
      
      if (isEmulator) {
          if (input.ingredient.toLowerCase().includes('ham')) {
              console.log('Simulating slow generation for Ham (Test Mode)...');
              // I tried making this shorter and the _Wrong_ test failed. I can't explain it.
              // Too long, timeout, too short and the first half of the test is still fine but the second half fails somehow..??
              await new Promise(resolve => setTimeout(resolve, 1000));

              console.log('finished slow generation for Ham...');
          }
          return { 
              url: `https://placehold.co/64x64/png?text=${encodeURIComponent(input.ingredient)}&uuid=${Date.now()}`, 
              prompt 
          };
      }

      const response = await ai.generate({
        model: 'vertexai/imagen-3.0-generate-001',
        prompt,
        output: { format: 'media' },
      });
      
      if (!response.media) throw new Error("No media generated");
      return { url: response.media.url, prompt };
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
    
    // Explicitly use firebasestorage.app bucket to match client expectations
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET || `${process.env.GCLOUD_PROJECT}.firebasestorage.app`;
    const bucket = storage.bucket(bucketName);

    const results = [];
    for (const node of nodesToProcess) {
        try {
            const rawName = node.visualDescription.trim();
            const name = rawName.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
            
            const ingredientsRef = db.collection('ingredients');
            const q = await ingredientsRef.where('name', '==', name).limit(1).get();
            
            let ingredientDocId;
            if (!q.empty) {
                ingredientDocId = q.docs[0].id;
            } else {
                const newDoc = await ingredientsRef.add({ name, created_at: new Date() });
                ingredientDocId = newDoc.id;
            }

            const iconsRef = db.collection(`ingredients/${ingredientDocId}/icons`);
            const iconSnap = await iconsRef.orderBy('popularity_score', 'desc').limit(1).get();

            let finalIconId;
            let finalIconUrl;

            if (!iconSnap.empty) {
                const iconDoc = iconSnap.docs[0];
                finalIconId = iconDoc.id;
                finalIconUrl = iconDoc.data().url;
            } else {
                console.log(`-> Generating icon for ${name}...`);
                const { url: tempUrl, prompt } = await generateIcon({ ingredient: name });
                
                const response = await fetch(tempUrl);
                const buffer = await response.arrayBuffer();
                
                // Process Icon (Background Removal)
                let processedBuffer: Buffer;
                try {
                    console.log(`-> Removing background for ${name}...`);
                    processedBuffer = await processIcon(buffer);
                } catch (err) {
                    console.warn(`-> Background removal failed for ${name}, using original.`, err);
                    processedBuffer = Buffer.from(buffer);
                }

                const fileName = `icons/${name.replace(/\s+/g, '-')}-${Date.now()}.png`;
                const file = bucket.file(fileName);
                await file.save(processedBuffer, {
                    metadata: { 
                        contentType: 'image/png',
                        metadata: {
                            popularity_score: '1.0',
                            impressions: '0',
                            rejections: '0',
                            fullPrompt: prompt,
                            visualDescription: node.visualDescription
                        }
                    }
                });
                
                await file.makePublic();
                finalIconUrl = file.publicUrl();

                const newIconDoc = await iconsRef.add({
                    url: finalIconUrl,
                    fullPrompt: prompt,
                    visualDescription: node.visualDescription,
                    popularity_score: 1.0, 
                    created_at: new Date(),
                    marked_for_deletion: false
                });
                finalIconId = newIconDoc.id;
            }

            results.push({ nodeId: node.id, iconId: finalIconId, iconUrl: finalIconUrl });

        } catch (e) {
            console.error(`Failed to process node ${node.id}:`, e);
            results.push(null);
        }
    }

    const successfulUpdates = results.filter(r => r !== null);
    return successfulUpdates.length > 0 ? successfulUpdates : null;
}

// 1. Automatic Trigger on Creation
export const processNewRecipe = onDocumentCreated({ document: "recipes/{recipeId}", timeoutSeconds: 300, memory: "1GiB" }, async (event) => {
    if (!event.data) return;
    const newData = event.data.data();
    
    // 1. Calculate Updates based on initial data (Slow)
    const updates = await backfillIcons(newData.graph, event.params.recipeId);
    
    if (updates) {
        try {
            // 2. Transactional Update: Fetch LATEST data to preserve position changes
            return await db.runTransaction(async (t) => {
                const ref = event.data!.ref;
                const freshDoc = await t.get(ref);
                if (!freshDoc.exists) return;
                
                const freshData = freshDoc.data();
                if (!freshData || !freshData.graph || !freshData.graph.nodes) return;

                const currentNodes = [...freshData.graph.nodes];
                let changed = false;

                updates.forEach((u: any) => {
                    const idx = currentNodes.findIndex((n: any) => n.id === u.nodeId);
                    if (idx !== -1) {
                        // Only update if not already set (idempotency) or if we are filling a gap
                        if (!currentNodes[idx].iconId) {
                            currentNodes[idx] = {
                                ...currentNodes[idx],
                                iconId: u.iconId,
                                iconUrl: u.iconUrl
                            };
                            changed = true;
                        }
                    }
                });

                if (changed) {
                    t.update(ref, { "graph.nodes": currentNodes });
                }
            });
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
    
    // Fetch 1
    const docSnap = await docRef.get();
    if (!docSnap.exists) throw new HttpsError('not-found', 'Recipe not found');
    
    // Calculate
    const updates = await backfillIcons(docSnap.data()?.graph, recipeId);
    
    if (updates) {
        // Transactional Update
        await db.runTransaction(async (t) => {
            const freshDoc = await t.get(docRef);
            if (!freshDoc.exists) return;
            const freshData = freshDoc.data();
            const currentNodes = [...freshData?.graph.nodes];
            
            updates.forEach((u: any) => {
                const idx = currentNodes.findIndex((n: any) => n.id === u.nodeId);
                if (idx !== -1) {
                    currentNodes[idx] = { ...currentNodes[idx], iconId: u.iconId, iconUrl: u.iconUrl };
                }
            });
            
            t.update(docRef, { "graph.nodes": currentNodes });
        });
        return { success: true, count: updates.length };
    }
    return { success: true, count: 0 };
});
