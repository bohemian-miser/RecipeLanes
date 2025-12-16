'use server';

import { embeddingModel, imageModelName, textModel } from '@/lib/genkit';
import { getAIService } from '@/lib/ai-service';
import { getDataService } from '@/lib/data-service';
import { getAuthService } from '@/lib/auth-service';
import { z } from 'zod';

// Constants for Generation Gating
const SESSION_REJECT_LIMIT = 4;
const PROVEN_SAMPLE_SIZE = 20;
const QUALITY_FLOOR_LCB = 0.40;
const MIN_CACHE_SIZE = 3;

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

// Helper for Title Case
function toTitleCase(str: string) {
  return str
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

async function generateAndStoreIcon(ingredient: string, ingredientDocId: string): Promise<{ url: string, lcb: number }> {
  console.log('[generateAndStoreIcon] Generating for:', ingredient);
  
  // 1. Enrich Prompt (AI)
  const visualDescriptionRaw = await getAIService().generateText(
      `Describe a distinct and recognizable visual representation of '${ingredient}' for a 64x64 pixel art icon. If it is an action (e.g. 'chop onion'), describe the tools and objects interacting (e.g. 'A knife slicing a red onion'). Do not describe hands. If it is an object (e.g. 'bag of sugar'), describe it with defining features or labels to ensure it is identifiable (e.g. 'A paper sack labeled "SUGAR" with a few cubes spilling out'). Keep it concise (under 30 words). Focus on visual subject matter only.`
  );
  const visualDescription = visualDescriptionRaw || ingredient;
  console.log(`[generateAndStoreIcon] Enriched prompt: "${visualDescription}"`);

  // 2. Generate Image (AI)
  let downloadURL = await getAIService().generateImage(
    `Generate a high-quality 64x64 pixel art icon of ${visualDescription}. The style should be distinct, colorful, and clearly recognizable, suitable for a game inventory or flowchart. Use clean outlines and bright colors. Ensure the background is transparent.`
  );

  // 3. Download Buffer for Storage
  let imageBuffer: ArrayBuffer;
  try {
      const response = await fetch(downloadURL);
      imageBuffer = await response.arrayBuffer();
  } catch (e) {
      console.error('Failed to download generated image for storage:', e);
      throw new Error('Failed to download generated image');
  }

  const initialImpressions = 1;
  const initialRejections = 0;
  const lcb = calculateWilsonLCB(initialImpressions, initialRejections);

  // 4. Save via Service
  try {
      const savedUrl = await getDataService().saveIcon(
          ingredientDocId,
          ingredient,
          visualDescription,
          downloadURL,
          imageBuffer,
          {
              lcb,
              impressions: initialImpressions,
              rejections: initialRejections,
              textModel,
              imageModel: imageModelName
          }
      );
      downloadURL = savedUrl;
  } catch (e) {
      console.error('DataService save failed:', e);
  }

  return { url: downloadURL, lcb };
}

export async function getAllIconsAction() {
    const session = await getAuthService().verifyAuth();
    if (!session?.isAdmin) return [];
    return getDataService().getAllIcons();
}

export async function getAllStorageFilesAction() {
    const session = await getAuthService().verifyAuth();
    if (!session?.isAdmin) return null;
    return getDataService().listDebugFiles();
}

export async function getSharedGalleryAction() {
    const session = await getAuthService().verifyAuth();
    if (!session) return [];
    
    const allIcons = await getDataService().getAllIcons();
    
    // Group by Ingredient
    const grouped: Record<string, any[]> = {};
    allIcons.forEach((icon: any) => {
        if (!grouped[icon.ingredient_name]) grouped[icon.ingredient_name] = [];
        grouped[icon.ingredient_name].push(icon);
    });

    // Take top 4
    const result = [];
    for (const ing in grouped) {
        const sorted = grouped[ing].sort((a, b) => (b.popularity_score || 0) - (a.popularity_score || 0));
        result.push(...sorted.slice(0, 4));
    }
    return result;
}

export async function getOrCreateIconAction(
    rawIngredient: string, 
    rawSessionRejections = 0,
    rawSeenUrls: string[] = []
) {
  const session = await getAuthService().verifyAuth();
  
  // Validate Input
  const ingredientParse = IngredientSchema.safeParse(rawIngredient);
  if (!ingredientParse.success) return { error: 'Invalid ingredient' };
  let ingredient = toTitleCase(ingredientParse.data);

  const countParse = CountSchema.safeParse(rawSessionRejections);
  const sessionRejections = countParse.success ? countParse.data : 0;

  const seenParse = SeenUrlsSchema.safeParse(rawSeenUrls);
  const seenUrls = new Set(seenParse.success ? seenParse.data : []);

  // 1. Search for Ingredient Group
  let bestMatch = await getDataService().getIngredientByName(ingredient);
  if (bestMatch) {
      ingredient = bestMatch.data.name; // Canonical name
  }

  // 2. Decide: Pick Existing or Generate New
  if (bestMatch) {
      console.log(`[getOrCreateIconAction] Found group: ${ingredient}`);
      const icons = await getDataService().getIconsForIngredient(bestMatch.id);

      // Calculate LCB for decision making
      const evaluated = icons
          .map((icon: any) => {
              const n = icon.impressions || 0;
              const r = icon.rejections || 0;
              return { 
                  ...icon, 
                  lcb: calculateWilsonLCB(n, r), 
                  n, r 
              };
          })
          .filter((i: any) => !i.marked_for_deletion && !seenUrls.has(i.url));

      // Debug Info
      const sortedCandidates = [...evaluated].sort((a: any, b: any) => b.lcb - a.lcb);
      const debugInfo = {
          candidates: sortedCandidates.slice(0, 5).map((c: any) => ({
              url: c.url,
              score: c.lcb,
              impressions: c.n,
              rejections: c.r
          })),
          sessionRejections,
          totalAvailable: evaluated.length,
          decision: 'UNKNOWN'
      };

      // Generation Logic
      let shouldGenerate = false;
      const provenIcons = evaluated.filter((i: any) => i.n >= PROVEN_SAMPLE_SIZE);
      const bestProvenLCB = provenIcons.length > 0 ? Math.max(...provenIcons.map((i: any) => i.lcb)) : 0;
      
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

      if (shouldGenerate) {
          // If user is NOT authenticated, force them to use cache (if available) or fail
          if (!session) {
              if (sortedCandidates.length > 0) {
                  // Fallback to best available candidate regardless of quality check
                  shouldGenerate = false; 
                  // Proceed to selection logic below
              } else {
                  return { error: 'Item not found. Login to forge new items.' };
              }
          }
      }

      if (!shouldGenerate) {
          const selected = sortedCandidates[0];
          const newImpressions = (selected.n || 0) + 1;
          const newLCB = calculateWilsonLCB(newImpressions, selected.r || 0);

          try {
              await getDataService().incrementImpressions(
                  bestMatch.id,
                  selected.id,
                  selected.url,
                  newLCB,
                  newImpressions
              );
          } catch (e) {
              console.error('Failed to increment impressions:', e);
          }

          return { 
              iconUrl: selected.url, 
              isNew: false, 
              popularityScore: newLCB,
              debugInfo 
          };
      }
      
      const { url: newUrl, lcb } = await generateAndStoreIcon(ingredient, bestMatch.id);
      return { 
          iconUrl: newUrl, 
          isNew: true, 
          popularityScore: lcb, 
          debugInfo: { ...debugInfo, decision: 'GENERATED_NEW' } 
      };
  } 
  
  // 3. Create New Ingredient Group (Requires Auth)
  if (!session) return { error: 'Item not found. Login to forge new items.' };

  const newDocId = await getDataService().createIngredient(ingredient);
  const { url: newUrl, lcb } = await generateAndStoreIcon(ingredient, newDocId);
  return { 
      iconUrl: newUrl, 
      isNew: true, 
      popularityScore: lcb,
      debugInfo: { decision: 'NEW_INGREDIENT_GROUP' } 
  };
}

export async function recordRejectionAction(rawIconUrl: string, rawIngredient: string) {
    const session = await getAuthService().verifyAuth();
    if (!session) return { error: 'Authentication required' };

    const urlParse = z.string().url().safeParse(rawIconUrl);
    if (!urlParse.success) return { error: 'Invalid URL' };
    const iconUrl = urlParse.data;

    const ingParse = IngredientSchema.safeParse(rawIngredient);
    if (!ingParse.success) return { error: 'Invalid ingredient' };
    const ingredient = ingParse.data;

    try {
        const match = await getDataService().getIngredientByName(ingredient);
        if (!match) throw new Error('Ingredient not found');
        
        await getDataService().recordRejection(iconUrl, ingredient, match.id);
    } catch (e: any) {
        console.error('recordRejectionAction failed:', e);
    }
    return { success: true };
}

export async function deleteIconByUrlAction(iconUrl: string, ingredientName?: string): Promise<{ success: boolean; error?: string }> {
    const session = await getAuthService().verifyAuth();
    if (!session?.isAdmin) return { success: false, error: 'Admin required' };

    try {
        await getDataService().deleteIcon(iconUrl, ingredientName);
        return { success: true };
    } catch (e: any) {
        console.error('deleteIconByUrlAction failed:', e);
        return { success: false, error: e.message };
    }
}

export async function deleteIngredientCategoryAction(rawIngredient: string): Promise<{ success: boolean; error?: string }> {
    const session = await getAuthService().verifyAuth();
    if (!session?.isAdmin) return { success: false, error: 'Admin required' };

    try {
        const ingredient = toTitleCase(rawIngredient.trim());
        await getDataService().deleteIngredientCategory(ingredient);
        return { success: true };
    } catch (e: any) {
        console.error('deleteIngredientCategoryAction failed:', e);
        return { success: false, error: e.message };
    }
}
