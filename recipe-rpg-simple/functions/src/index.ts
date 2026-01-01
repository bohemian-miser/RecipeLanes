import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { genkit, z } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';

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

    const results = await Promise.all(nodesToProcess.map(async (node: any) => {
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
                const fileName = `icons/${name.replace(/\s+/g, '-')}-${Date.now()}.png`;
                const file = bucket.file(fileName);
                await file.save(Buffer.from(buffer), {
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

            return { nodeId: node.id, iconId: finalIconId, iconUrl: finalIconUrl };

        } catch (e) {
            console.error(`Failed to process node ${node.id}:`, e);
            return null;
        }
    }));

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
export const processNewRecipe = onDocumentCreated("recipes/{recipeId}", async (event) => {
    if (!event.data) return;
    const newData = event.data.data();
    const updatedNodes = await backfillIcons(newData.graph, event.params.recipeId);
    if (updatedNodes) {
        return event.data.ref.update({ "graph.nodes": updatedNodes });
    }
    return null;
});

// 2. Manual Callable Function (Debug / Retry)
export const backfillRecipeIcons = onCall(async (request) => {
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
