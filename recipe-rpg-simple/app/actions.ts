'use server';

import { ai, embeddingModel, imagenModel } from '@/lib/genkit';
import { db, storage } from '@/lib/firebase-admin';
import { memoryStore } from '@/lib/store';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

const SIMILARITY_THRESHOLD = 0.85;
const POPULARITY_BONUS = 5;
const NEW_ICON_WEIGHT = 10;

// Input Validation Schemas
const IngredientSchema = z.string().min(1).max(100);
const IconUrlSchema = z.string().url().optional();
const CountSchema = z.number().int().min(0).default(0);
const AdjustmentSchema = z.number().int();

// Helper to calculate cosine similarity
// Force rebuild
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  const dotProduct = vecA.reduce((acc, val, i) => acc + val * vecB[i], 0);
  const magA = Math.sqrt(vecA.reduce((acc, val) => acc + val * val, 0));
  const magB = Math.sqrt(vecB.reduce((acc, val) => acc + val * val, 0));
  if (magA === 0 || magB === 0) return 0;
  return dotProduct / (magA * magB);
}

async function generateAndStoreIcon(ingredient: string, generationCount: number, ingredientDocId: string, useFallback = false): Promise<string> {
  console.log('[generateAndStoreIcon] Generating for:', ingredient);
  
  // 1. Generate Image
  const { media } = await ai.generate({
    model: imagenModel,
    prompt: `Generate a 64x64 pixel art icon for ${ingredient}. The style should be reminiscent of an 8-bit video game. Ensure the background is transparent.`,
  });

  if (!media || !media.url) throw new Error('Image generation failed');

  let downloadURL = media.url;

  // 2. Upload to Storage (if not fallback and we want persistence)
  if (!useFallback && process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      try {
          const bucket = storage.bucket();
          const fileName = `icons/${ingredient.replace(/\s+/g, '-')}-${Date.now()}.png`;
          const file = bucket.file(fileName);
          
          const response = await fetch(media.url);
          const buffer = await response.arrayBuffer();
          
          await file.save(Buffer.from(buffer), {
              metadata: { contentType: 'image/png' }
          });
          await file.makePublic();
          downloadURL = file.publicUrl();
      } catch (e) {
          console.warn('Storage upload failed, using ephemeral URL:', e);
      }
  }

  const popularityScore = POPULARITY_BONUS + Math.log2(generationCount + 1);

  // 3. Store Metadata
  if (useFallback) {
      memoryStore.addIcon({
          url: downloadURL,
          ingredient,
          ingredientId: ingredientDocId,
          popularity_score: popularityScore,
          created_at: Date.now(),
          marked_for_deletion: false
      });
  } else {
      try {
          await db.collection('ingredients').doc(ingredientDocId).collection('icons').add({
              url: downloadURL,
              popularity_score: popularityScore,
              created_at: FieldValue.serverTimestamp(),
              marked_for_deletion: false
          });
      } catch (e) {
          console.error('Firestore add failed:', e);
      }
  }

  return downloadURL;
}

export async function getOrCreateIconAction(rawIngredient: string, rawExistingIconUrl?: string, rawGenerationCount = 0) {
  // Validate Input
  const ingredientParse = IngredientSchema.safeParse(rawIngredient);
  if (!ingredientParse.success) return { error: 'Invalid ingredient' };
  const ingredient = ingredientParse.data;

  const urlParse = IconUrlSchema.safeParse(rawExistingIconUrl);
  const existingIconUrl = urlParse.success ? urlParse.data : undefined;

  const countParse = CountSchema.safeParse(rawGenerationCount);
  const generationCount = countParse.success ? countParse.data : 0;

  let useFallback = false;
  try {
      if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
          // Check for credentials presence
      }
  } catch (e) { useFallback = true; }

  // 1. Embed Input
  let embedding: number[] = [];
  try {
      const response = await ai.embed({ embedder: embeddingModel, content: ingredient });
      if (response && response.embedding) {
          embedding = response.embedding;
      } else {
          console.error('Embedding response missing data:', response);
          return { error: 'Failed to generate embedding for ingredient.' };
      }
  } catch (e) {
      console.error('Embedding failed:', e);
      return { error: 'Failed to process ingredient text.' };
  }

  // 2. Search for Ingredient Group
  let bestMatch = null;
  
  if (!useFallback) {
      try {
          const snapshot = await db.collection('ingredients').get();
          for (const doc of snapshot.docs) {
              const data = doc.data();
              if (data.embedding && embedding.length > 0) {
                  const sim = cosineSimilarity(embedding, data.embedding);
                  if (sim > SIMILARITY_THRESHOLD && (!bestMatch || sim > bestMatch.sim)) {
                      bestMatch = { id: doc.id, data, sim };
                  }
              }
          }
      } catch (e) {
          console.warn('Firestore read failed, using fallback:', e);
          useFallback = true;
      }
  }

  if (useFallback) {
      const ingredients = memoryStore.getIngredients();
      for (const ing of ingredients) {
          if (ing.embedding && embedding.length > 0) {
              const sim = cosineSimilarity(embedding, ing.embedding);
              if (sim > SIMILARITY_THRESHOLD && (!bestMatch || sim > bestMatch.sim)) {
                  bestMatch = { id: ing.id, data: ing, sim };
              }
          }
      }
  }

  // 3. Decide: Pick Existing or Generate New
  if (bestMatch) {
      console.log(`Found match: ${bestMatch.data.name} (sim: ${bestMatch.sim})`);
      let icons: any[] = [];
      
      if (!useFallback) {
          const iconSnap = await db.collection('ingredients').doc(bestMatch.id).collection('icons').get();
          icons = iconSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      } else {
          icons = memoryStore.getIconsForIngredient(bestMatch.id);
      }

      // Filter
      const available = icons.filter(i => !i.marked_for_deletion && i.url !== existingIconUrl);
      
      if (available.length > 0) {
          // Weighted Random
          const totalScore = available.reduce((sum, i) => sum + Math.max(0, i.popularity_score) + 1, 0) + NEW_ICON_WEIGHT;
          let randomPoint = Math.random() * totalScore;
          
          for (const icon of available) {
              randomPoint -= (Math.max(0, icon.popularity_score) + 1);
              if (randomPoint <= 0) {
                  return { iconUrl: icon.url, isNew: false };
              }
          }
          console.log('Rolling for NEW icon despite matches.');
      }
      
      const newUrl = await generateAndStoreIcon(ingredient, generationCount, bestMatch.id, useFallback);
      return { iconUrl: newUrl, isNew: true };
  } 
  
  // 4. Create New Ingredient Group
  let newDocId = '';
  if (useFallback) {
      newDocId = memoryStore.addIngredient({ name: ingredient, embedding, created_at: Date.now() });
  } else {
      const docRef = await db.collection('ingredients').add({
          name: ingredient,
          embedding,
          created_at: FieldValue.serverTimestamp()
      });
      newDocId = docRef.id;
  }

  const newUrl = await generateAndStoreIcon(ingredient, generationCount, newDocId, useFallback);
  return { iconUrl: newUrl, isNew: true };
}

export async function updatePopularityAction(rawIconUrl: string, rawAdjustment: number) {
    const urlParse = z.string().url().safeParse(rawIconUrl);
    if (!urlParse.success) return { error: 'Invalid URL' };
    const iconUrl = urlParse.data;

    const adjParse = AdjustmentSchema.safeParse(rawAdjustment);
    if (!adjParse.success) return { error: 'Invalid adjustment' };
    const adjustment = adjParse.data;

    let useFallback = false;
    try {
        const query = db.collectionGroup('icons').where('url', '==', iconUrl);
        const snapshot = await query.get();
        if (snapshot.empty) throw new Error('Not found in Firestore');
        
        const batch = db.batch();
        for (const doc of snapshot.docs) {
            const data = doc.data();
            const newScore = (data.popularity_score || 0) + adjustment;
            batch.update(doc.ref, { popularity_score: newScore });
            
            // Deletion Check
            const parentCollection = doc.ref.parent;
            const siblings = await parentCollection.count().get();
            const count = siblings.data().count;
            
            if (newScore < -Math.max(count, 100)) {
                batch.update(doc.ref, { marked_for_deletion: true });
            }
        }
        await batch.commit();
    } catch (e) {
        useFallback = true;
    }

    if (useFallback) {
        memoryStore.updateIconPopularity(iconUrl, adjustment);
    }
    return { success: true };
}