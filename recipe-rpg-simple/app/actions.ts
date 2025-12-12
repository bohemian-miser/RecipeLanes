'use server';

import { ai, embeddingModel, imageModelName } from '@/lib/genkit';
import { db, storage } from '@/lib/firebase-admin';
import { memoryStore } from '@/lib/store';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { randomUUID } from 'crypto';

// Constants for Generation Gating
const SESSION_REJECT_LIMIT = 4;
const PROVEN_SAMPLE_SIZE = 20;
const QUALITY_FLOOR_LCB = 0.40;
const MIN_CACHE_SIZE = 3;
const NEW_ICON_WEIGHT = 10;
const REJECT_PENALTY = 10; // Keep for now if needed, though recordRejectionAction handles it logic internally with LCB

// Input Validation Schemas
const IngredientSchema = z.string().min(1).max(100);
const IconUrlSchema = z.string().url().optional();
const CountSchema = z.number().int().min(0).default(0);
const SeenUrlsSchema = z.array(z.string().url()).default([]);

// Wilson Score Interval (Lower Confidence Bound)
function calculateWilsonLCB(n: number, r: number): number {
  if (n === 0) return 0;
  const k = n - r;
  const p = k / n;
  const z = 1.645; // 95% confidence (one-sided)
  
  const den = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const adj = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  
  const lcb = (centre - adj) / den;
  return Math.max(0, lcb); // Clamp to 0
}

// Helper to update Storage Metadata safely
async function updateStorageMetadata(iconUrl: string, updates: { impressions?: number, rejections?: number, lcb?: number }) {
    if (!process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) return;
    try {
        const matches = iconUrl.match(/\/o\/([^?]+)/);
        if (matches && matches[1]) {
            const filePath = decodeURIComponent(matches[1]);
            const bucket = storage.bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'ropgcp.firebasestorage.app');
            const file = bucket.file(filePath);
            
            // Construct string-based metadata object
            const metadata: Record<string, string> = {};
            if (updates.impressions !== undefined) metadata.impressions = String(updates.impressions);
            if (updates.rejections !== undefined) metadata.rejections = String(updates.rejections);
            if (updates.lcb !== undefined) metadata.lcb = String(updates.lcb);

            await file.setMetadata({ metadata });
        }
    } catch (err) {
        console.warn('Storage metadata update failed:', err);
    }
}

async function generateAndStoreIcon(ingredient: string, ingredientDocId: string, useFallback = false): Promise<{ url: string, lcb: number }> {
  console.log('[generateAndStoreIcon] Generating for:', ingredient);
  
  // 1. Generate Image
  const { media } = await ai.generate({
    model: imageModelName,
    prompt: `Generate a 64x64 pixel art icon for ${ingredient}. The style should be reminiscent of an 8-bit video game. Ensure the background is transparent.`,
  });

  if (!media || !media.url) throw new Error('Image generation failed');

  let downloadURL = media.url;
  const initialImpressions = 1;
  const initialRejections = 0;
  const lcb = calculateWilsonLCB(initialImpressions, initialRejections);

  // 2. Upload to Storage
  if (!useFallback) {
      try {
          const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'ropgcp.firebasestorage.app';
          const bucket = storage.bucket(bucketName);
          const fileName = `icons/${ingredient.replace(/\s+/g, '-')}-${Date.now()}.png`;
          const file = bucket.file(fileName);
          const token = randomUUID();
          
          const response = await fetch(media.url);
          const buffer = await response.arrayBuffer();
          
          await file.save(Buffer.from(buffer), {
              metadata: { 
                  contentType: 'image/png',
                  metadata: {
                      firebaseStorageDownloadTokens: token,
                      impressions: String(initialImpressions),
                      rejections: String(initialRejections),
                      lcb: String(lcb)
                  }
              }
          });
          
          downloadURL = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(fileName)}?alt=media&token=${token}`;
      } catch (e) {
          console.warn('Storage upload failed, using ephemeral URL:', e);
      }
  }

  // 3. Store Metadata
  if (useFallback) {
      memoryStore.addIcon({
          url: downloadURL,
          ingredient,
          ingredientId: ingredientDocId,
          popularity_score: lcb, // Mapping LCB to score field for compat
          created_at: Date.now(),
          marked_for_deletion: false
      });
  } else {
      try {
          await db.collection('ingredients').doc(ingredientDocId).collection('icons').add({
              url: downloadURL,
              impressions: initialImpressions,
              rejections: initialRejections,
              popularity_score: lcb, // Keep popularity_score field for UI compat
              ingredient_name: ingredient,
              created_at: FieldValue.serverTimestamp(),
              marked_for_deletion: false
          });
          console.log(`[generateAndStoreIcon] Successfully wrote metadata for ${ingredient}`);
      } catch (e) {
          console.error('Firestore add failed:', e);
      }
  }

  return { url: downloadURL, lcb };
}

export async function getAllIconsAction() {
    try {
        const snapshot = await db.collectionGroup('icons').limit(100).get();
        const items = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                path: doc.ref.path,
                ...data,
                created_at: data.created_at?.toDate?.()?.toISOString() || data.created_at
            };
        });
        // Sort in memory by LCB (popularity_score) descending
        // @ts-ignore
        return items.sort((a, b) => (b.popularity_score || 0) - (a.popularity_score || 0));
    } catch (e) {
        console.error('Failed to fetch all icons:', e);
        return [];
    }
}

export async function getAllStorageFilesAction() {
    try {
        const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'ropgcp.firebasestorage.app';
        const bucket = storage.bucket(bucketName);
        const [files] = await bucket.getFiles({ prefix: 'icons/', maxResults: 50 });
        return files.map(file => ({
            name: file.name,
            updated: file.metadata.updated,
            contentType: file.metadata.contentType,
            size: file.metadata.size,
            // Map metadata to simplified props
            // @ts-ignore
            popularityScore: file.metadata.metadata?.lcb || '0',
            // @ts-ignore
            impressions: file.metadata.metadata?.impressions || '0',
            // @ts-ignore
            rejections: file.metadata.metadata?.rejections || '0',
            mediaLink: file.metadata.mediaLink,
            publicUrl: `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(file.name)}?alt=media`
        }));
    } catch (e) {
        console.error('Failed to fetch storage files:', e);
        return [];
    }
}

export async function getOrCreateIconAction(
    rawIngredient: string, 
    rawSessionRejections = 0,
    rawSeenUrls: string[] = []
) {
  // Validate Input
  const ingredientParse = IngredientSchema.safeParse(rawIngredient);
  if (!ingredientParse.success) return { error: 'Invalid ingredient' };
  let ingredient = ingredientParse.data;

  const countParse = CountSchema.safeParse(rawSessionRejections);
  const sessionRejections = countParse.success ? countParse.data : 0;

  const seenParse = SeenUrlsSchema.safeParse(rawSeenUrls);
  const seenUrls = new Set(seenParse.success ? seenParse.data : []);

  let useFallback = false;
  try {
      if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
          // Check for credentials
      }
  } catch (e) { useFallback = true; }

  // 1. Search for Ingredient Group (Exact Match)
  let bestMatch = null;
  if (!useFallback) {
      try {
          const snapshot = await db.collection('ingredients').get();
          const matchDoc = snapshot.docs.find(doc => 
              doc.data().name.toLowerCase() === ingredient.toLowerCase()
          );
          if (matchDoc) {
              bestMatch = { id: matchDoc.id, data: matchDoc.data() };
              ingredient = matchDoc.data().name; // Use canonical name
          }
      } catch (e) {
          console.warn('Firestore read failed, using fallback:', e);
          useFallback = true;
      }
  }

  if (useFallback) {
      const ingredients = memoryStore.getIngredients();
      const match = ingredients.find(i => i.name.toLowerCase() === ingredient.toLowerCase());
      if (match) {
          bestMatch = { id: match.id, data: match };
          ingredient = match.name;
      }
  }

  // 2. Decide: Pick Existing or Generate New
  if (bestMatch) {
      console.log(`[getOrCreateIconAction] Found group: ${bestMatch.data.name}`);
      let icons: any[] = [];
      
      if (!useFallback) {
          const iconSnap = await db.collection('ingredients').doc(bestMatch.id).collection('icons').get();
          icons = iconSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      } else {
          icons = memoryStore.getIconsForIngredient(bestMatch.id);
      }

      // Calculate LCB for all icons and filter
      const evaluated = icons
          .map(icon => {
              const n = icon.impressions || 0;
              const r = icon.rejections || 0;
              return { 
                  ...icon, 
                  lcb: calculateWilsonLCB(n, r), 
                  n, r 
              };
          })
          .filter(i => !i.marked_for_deletion && !seenUrls.has(i.url));

      // DEBUG INFO PREPARATION
      // Create a snapshot of ALL candidates (even filtered ones, maybe? No, just evaluated ones)
      // Actually user wants to see "5 options".
      // Let's take top 5 sorted by LCB for debug info
      const sortedCandidates = [...evaluated].sort((a, b) => b.lcb - a.lcb);
      
      const debugInfo = {
          candidates: sortedCandidates.slice(0, 5).map(c => ({
              url: c.url,
              score: c.lcb,
              impressions: c.n,
              rejections: c.r
          })),
          sessionRejections,
          totalAvailable: evaluated.length,
          decision: 'UNKNOWN'
      };

      // GENERATION GATE LOGIC
      let shouldGenerate = false;
      const provenIcons = evaluated.filter(i => i.n >= PROVEN_SAMPLE_SIZE);
      const bestProvenLCB = provenIcons.length > 0 ? Math.max(...provenIcons.map(i => i.lcb)) : 0;
      
      if (evaluated.length === 0) {
          debugInfo.decision = 'CACHE_EXHAUSTED';
          shouldGenerate = true;
      } else if (sessionRejections >= SESSION_REJECT_LIMIT) {
          if (provenIcons.length > 0 && bestProvenLCB < QUALITY_FLOOR_LCB) {
              debugInfo.decision = 'QUALITY_FLOOR_BREACH';
              shouldGenerate = true;
          } else if (icons.length < MIN_CACHE_SIZE) {
              debugInfo.decision = 'CACHE_TOO_SMALL_REJECT_STREAK';
              shouldGenerate = true;
          } else {
              debugInfo.decision = 'CACHE_SUFFICIENT';
          }
      } else {
          debugInfo.decision = 'NORMAL_SELECTION';
      }

      if (!shouldGenerate) {
          // Selection Strategy: Highest LCB
          const selected = sortedCandidates[0];
          const newImpressions = selected.n + 1;
          const newLCB = calculateWilsonLCB(newImpressions, selected.r);
          
          if (!useFallback) {
              await db.collection('ingredients').doc(bestMatch.id).collection('icons').doc(selected.id).update({
                  impressions: FieldValue.increment(1),
                  popularity_score: newLCB
              });
              
              // Update Storage Metadata
              await updateStorageMetadata(selected.url, { 
                  impressions: newImpressions, 
                  lcb: newLCB 
              });
          }
          
          return { 
              iconUrl: selected.url, 
              isNew: false, 
              popularityScore: newLCB,
              debugInfo // RETURN DEBUG INFO
          };
      }
      
      const { url: newUrl, lcb } = await generateAndStoreIcon(ingredient, bestMatch.id, useFallback);
      return { 
          iconUrl: newUrl, 
          isNew: true, 
          popularityScore: lcb, 
          debugInfo: { ...debugInfo, decision: 'GENERATED_NEW' } 
      };
  } 
  
  // 3. Create New Ingredient Group
  let newDocId = '';
  if (useFallback) {
      newDocId = memoryStore.addIngredient({ name: ingredient, embedding: [], created_at: Date.now() });
  } else {
      const docRef = await db.collection('ingredients').add({
          name: ingredient,
          embedding: [],
          created_at: FieldValue.serverTimestamp()
      });
      newDocId = docRef.id;
  }

  const { url: newUrl, lcb } = await generateAndStoreIcon(ingredient, newDocId, useFallback);
  return { 
      iconUrl: newUrl, 
      isNew: true, 
      popularityScore: lcb,
      debugInfo: { decision: 'NEW_INGREDIENT_GROUP' } 
  };
}

export async function recordRejectionAction(rawIconUrl: string, rawIngredient: string) {
    const urlParse = z.string().url().safeParse(rawIconUrl);
    if (!urlParse.success) return { error: 'Invalid URL' };
    const iconUrl = urlParse.data;

    const ingParse = IngredientSchema.safeParse(rawIngredient);
    if (!ingParse.success) return { error: 'Invalid ingredient' };
    const ingredient = ingParse.data;

    let useFallback = false;
    try {
        const ingSnapshot = await db.collection('ingredients').get();
        const ingDoc = ingSnapshot.docs.find(d => d.data().name.toLowerCase() === ingredient.toLowerCase());
        
        if (!ingDoc) throw new Error('Ingredient not found');

        const iconQuery = ingDoc.ref.collection('icons').where('url', '==', iconUrl);
        const snapshot = await iconQuery.get();
        
        if (snapshot.empty) throw new Error('Icon not found in Firestore');
        
        const batch = db.batch();
        for (const doc of snapshot.docs) {
            const data = doc.data();
            const n = (data.impressions || 0);
            const r = (data.rejections || 0) + 1; 
            const newLcb = calculateWilsonLCB(n, r);

            batch.update(doc.ref, { 
                rejections: FieldValue.increment(1),
                popularity_score: newLcb
            });
            
            // Update Storage Metadata using helper
            await updateStorageMetadata(iconUrl, { rejections: r, lcb: newLcb });
        }
        await batch.commit();
    } catch (e) {
        useFallback = true;
        console.error('recordRejectionAction failed:', e);
    }
    return { success: true };
}