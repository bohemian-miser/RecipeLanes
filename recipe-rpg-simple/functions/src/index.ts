import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { genkit, z } from 'genkit';

// 1. CHANGE: Import vertexAI from the UNIFIED package
import { vertexAI } from '@genkit-ai/google-genai';

initializeApp();
const db = getFirestore();
const storage = getStorage();

const ai = genkit({
    // 2. CHANGE: Configure vertexAI here. 
    // This looks identical to the old way, but comes from the new package.
    plugins: [vertexAI({ location: 'us-central1' })], 
});

const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true' || process.env.MOCK_AI === 'true';

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
      // Prompt copied from lib/flows.ts
      const prompt = `Generate a high-quality 64x64 pixel art icon of ${input.ingredient}. The style should be distinct, colorful, and clearly recognizable, suitable for a game inventory or flowchart. Use clean outlines and bright colors. Ensure the background is white.`;
      
      if (isEmulator) {
          if (input.ingredient.toLowerCase().includes('ham')) {
              console.log('Simulating slow generation for Ham...');
              await new Promise(resolve => setTimeout(resolve, 6000));

              console.log('finished slow generation for Ham...');
          }
          // Direct mock return bypassing Genkit generate for robustness in tests
          return { 
              url: `https://placehold.co/64x64/png?text=${encodeURIComponent(input.ingredient)}`, 
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

export const processNewRecipe = onDocumentCreated("recipes/{recipeId}", async (event) => {
    if (!event.data) return; 
    
    const newData = event.data.data(); // onDocumentCreated has .data() method on QueryDocumentSnapshot
    
    // Only proceed if graph exists and has nodes
    if (!newData || !newData.graph || !newData.graph.nodes) return;

    // Check if we actually need to process (avoid infinite loops)
    // Process ANY node with visualDescription (Ingredients OR Actions)
    const nodesToProcess = newData.graph.nodes.filter((n: any) => 
        n.visualDescription && 
        !n.iconId 
    );

    if (nodesToProcess.length === 0) return;

    console.log(`Processing ${nodesToProcess.length} nodes for recipe ${event.params.recipeId}`);

    const bucket = storage.bucket();

    await Promise.all(nodesToProcess.map(async (node: any, index: number) => {
        try {
            // 1. Check Cache (Ingredients Collection)
            const name = node.visualDescription.toLowerCase().trim();
            const ingredientsRef = db.collection('ingredients');
            const q = await ingredientsRef.where('name', '==', name).limit(1).get();
            
            let ingredientDocId;

            if (!q.empty) {
                ingredientDocId = q.docs[0].id;
            } else {
                const newDoc = await ingredientsRef.add({ 
                    name, 
                    created_at: new Date() 
                });
                ingredientDocId = newDoc.id;
            }

            // Check for existing icons
            const iconsRef = db.collection(`ingredients/${ingredientDocId}/icons`);
            const iconSnap = await iconsRef.orderBy('popularity_score', 'desc').limit(1).get();

            let finalIconId;
            let finalIconUrl;

            if (!iconSnap.empty) {
                const iconDoc = iconSnap.docs[0];
                finalIconId = iconDoc.id;
                finalIconUrl = iconDoc.data().url;
            } else {
                // Generate
                console.log(`aaae Generating icon for ${name}...`);

                const { url: tempUrl, prompt } = await generateIcon({ ingredient: name });
                console.log(`Generated icon for ${name}...`);
                // Upload to Storage
                // If emulator/mock, tempUrl might be external (placehold.co), so we fetch it.
                const response = await fetch(tempUrl);
                const buffer = await response.arrayBuffer();
                const fileName = `icons/${name.replace(/\s+/g, '-')}-${Date.now()}.png`;
                const file = bucket.file(fileName);
                
                await file.save(Buffer.from(buffer), {
                    metadata: { contentType: 'image/png' }
                });
                await file.makePublic();
                // In emulator, makePublic() might not generate a usable publicUrl() for the browser context 
                // without specific config, but standard Storage emulator url is fine.
                finalIconUrl = file.publicUrl();

                // Save Metadata
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
    })).then((results) => {
        const successfulUpdates = results.filter(r => r !== null);
        if (successfulUpdates.length === 0) return;

        const currentNodes = [...newData.graph.nodes];
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

        if (changed) {
            return event.data!.ref.update({
                "graph.nodes": currentNodes
            });
        }
        return null;
    });
});