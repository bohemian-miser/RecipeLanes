'use server';

import { embeddingModel, imageModelName, textModel, ai } from '@/lib/genkit';
import { getAIService } from '@/lib/ai-service';
import { getDataService } from '@/lib/data-service';
import { getAuthService } from '@/lib/auth-service';
import { z } from 'zod';
import { generateRecipePrompt, parseRecipeGraph } from '@/lib/recipe-lanes/parser';
import { generateIconFlow } from '@/lib/flows';
import type { RecipeGraph } from '@/lib/recipe-lanes/types';

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

async function generateAndStoreIcon(ingredient: string, ingredientDocId: string): Promise<{ url: string, lcb: number, imagePrompt: string }> {
  console.log('[generateAndStoreIcon] Generating for:', ingredient);
  
  // 1. Run Genkit Flow (Text + Image)
  // This encapsulates the prompt enrichment and image generation logic
  const { url: downloadURL, visualDescription, imagePrompt, fullImagePrompt } = await generateIconFlow({ ingredient });
  
  // 2. Download Buffer for Storage
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

  // 3. Save via Service
  let finalUrl = downloadURL;
  try {
      const savedUrl = await getDataService().saveIcon(
          ingredientDocId,
          ingredient,
          visualDescription,
          imagePrompt,
          fullImagePrompt,
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
      finalUrl = savedUrl;
  } catch (e) {
      console.error('DataService save failed:', e);
  }

  return { url: finalUrl, lcb, imagePrompt };
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
    try {
        const session = await getAuthService().verifyAuth();
        if (!session) return [];
        
        // Filter out soft-deleted items
        const allIcons = (await getDataService().getAllIcons()).filter((i: any) => !i.marked_for_deletion);
        
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
    } catch (e) {
        console.error('getSharedGalleryAction failed:', e);
        return [];
    }
}

export async function getOrCreateIconAction(
    rawIngredient: string, 
    rawSessionRejections = 0,
    rawSeenUrls: string[] = []
) {
  try {
      const session = await getAuthService().verifyAuth();
      if (!session) return { error: 'Authentication required' };

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
                      shouldGenerate = false; 
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
                  imagePrompt: selected.imagePrompt,
                  debugInfo 
              };
          }
          
          const { url: newUrl, lcb, imagePrompt } = await generateAndStoreIcon(ingredient, bestMatch.id);
          return { 
              iconUrl: newUrl, 
              isNew: true, 
              popularityScore: lcb, 
              imagePrompt,
              debugInfo: { ...debugInfo, decision: 'GENERATED_NEW' } 
          };
      } 
      
      // 3. Create New Ingredient Group (Requires Auth)
      if (!session) return { error: 'Item not found. Login to forge new items.' };

      const newDocId = await getDataService().createIngredient(ingredient);
      const { url: newUrl, lcb, imagePrompt } = await generateAndStoreIcon(ingredient, newDocId);
      return { 
          iconUrl: newUrl, 
          isNew: true, 
          popularityScore: lcb,
          imagePrompt,
          debugInfo: { decision: 'NEW_INGREDIENT_GROUP' } 
      };

  } catch (e: any) {
      console.error('[getOrCreateIconAction] Error:', e);
      const msg = e.message || '';
      if (msg.includes('invalid_grant')) {
          return { error: 'Server authentication failed. Please check backend credentials.' };
      }
      if (msg.includes('API key expired') || msg.includes('API key not valid')) {
          return { error: 'AI Service Error: The API Key is invalid or expired. Please contact the administrator.' };
      }
      return { error: `Failed to forge item: ${msg}` };
  }
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

// --- Recipe Lanes Actions ---

export async function parseRecipeAction(recipeText: string): Promise<{ graph?: RecipeGraph; error?: string }> {
    try {
        const session = await getAuthService().verifyAuth();
        // Allow unauthenticated usage? Maybe limit rate?
        // For now, let's require auth to prevent abuse of the complex prompt.
        if (!session) return { error: 'Authentication required' };

        const prompt = generateRecipePrompt(recipeText);
        
        // Use Genkit to generate the JSON
        const response = await ai.generate({
            model: textModel,
            prompt: prompt,
            config: {
                temperature: 0.2, // Low temp for structured output
            }
        });

        const text = response.text;
        const graph = parseRecipeGraph(text);
        return { graph };

    } catch (e: any) {
        console.error('parseRecipeAction failed:', e);
        return { error: e.message || 'Failed to parse recipe.' };
    }
}

export async function generateGraphIconsAction(graph: RecipeGraph): Promise<{ graph: RecipeGraph; error?: string }> {
    try {
        const session = await getAuthService().verifyAuth();
        if (!session) return { error: 'Authentication required', graph };

        const updatedNodes = [];
        
        // Process in parallel? Or sequential to avoid rate limits?
        // Parallel chunks of 3 is safe.
        const chunk = 3;
        for (let i = 0; i < graph.nodes.length; i += chunk) {
            const batch = graph.nodes.slice(i, i + chunk);
            await Promise.all(batch.map(async (node) => {
                if (node.visualDescription) {
                    // Use visual description as the "Ingredient Name" for caching
                    // This creates a group like "A carrot going into a grater"
                    const result = await getOrCreateIconAction(node.visualDescription);
                    if (result && 'iconUrl' in result) {
                        node.iconUrl = result.iconUrl;
                    }
                }
            }));
            updatedNodes.push(...batch);
        }

        // Reconstruct graph (actually updated in place due to references, but let's be safe)
        // Since I pushed to updatedNodes, I have the list.
        // Wait, graph.nodes elements were modified in place.
        
        return { graph };

    } catch (e: any) {
        console.error('generateGraphIconsAction failed:', e);
        return { graph, error: e.message };
    }
}