'use server';

import { embeddingModel, imageModelName, textModel, ai } from '@/lib/genkit';
import { getAIService } from '@/lib/ai-service';
import { getDataService } from '@/lib/data-service';
import { getAuthService } from '@/lib/auth-service';
import { z } from 'zod';
import { generateRecipePrompt, parseRecipeGraph, extractServes } from '@/lib/recipe-lanes/parser';
import { generateAdjustmentPrompt } from '@/lib/recipe-lanes/adjuster';
import { generateIconFlow } from '@/lib/flows';
// import { processIcon } from '@/lib/image-processing';
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

async function generateAndStoreIcon(ingredient: string, ingredientDocId: string): Promise<{ url: string, lcb: number, fullPrompt: string, visualDescription: string }> {
  console.log(`[generateAndStoreIcon] 🟢 START for: "${ingredient}" (DocID: ${ingredientDocId})`);
  
  try {
      // 1. Run Genkit Flow (Image generation)
      console.log(`[generateAndStoreIcon] Calling generateIconFlow...`);
      const { url: downloadURL, imagePrompt: fullPrompt } = await generateIconFlow({ ingredient });
      const visualDescription = ingredient;
      console.log(`[generateAndStoreIcon] 🎨 Generated URL: ${downloadURL?.substring(0, 50)}...`);
      
      // 2. Download Buffer for Storage
      let imageBuffer: ArrayBuffer;
      try {
          console.log(`[generateAndStoreIcon] Downloading image...`);
          const response = await fetch(downloadURL);
          if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
          imageBuffer = await response.arrayBuffer();
          console.log(`[generateAndStoreIcon] Downloaded ${imageBuffer.byteLength} bytes.`);
      } catch (e) {
          console.error('[generateAndStoreIcon] 🔴 Failed to download generated image:', e);
          throw new Error('Failed to download generated image');
      }
      let finalBuffer: ArrayBuffer | Buffer = imageBuffer;
    //   // 3. Process Image (Remove Background)
    //   let finalBuffer: ArrayBuffer | Buffer = imageBuffer;
    //   try {
    //       console.log(`[generateAndStoreIcon] Processing image (background removal)...`);
    //       finalBuffer = await processIcon(imageBuffer);
    //       console.log(`[generateAndStoreIcon] Processed image size: ${finalBuffer.byteLength} bytes.`);
    //   } catch (e) {
    //       console.warn('[generateAndStoreIcon] ⚠️ Background removal failed, using original image:', e);
    //   }

      const initialImpressions = 1;
      const initialRejections = 0;
      const lcb = calculateWilsonLCB(initialImpressions, initialRejections);

      // 4. Save via Service
      let finalUrl = downloadURL;
      try {
          console.log(`[generateAndStoreIcon] Saving to DataService...`);
          const savedUrl = await getDataService().saveIcon(
              ingredientDocId,
              ingredient,
              visualDescription,
              fullPrompt,
              downloadURL,
              finalBuffer,
              {
                  lcb,
                  impressions: initialImpressions,
                  rejections: initialRejections,
                  textModel,
                  imageModel: imageModelName
              }
          );
          finalUrl = savedUrl;
          console.log(`[generateAndStoreIcon] ✅ Saved successfully. Final URL: ${finalUrl}`);
      } catch (e) {
          console.error('[generateAndStoreIcon] 🔴 DataService save failed:', e);
      }

      return { url: finalUrl, lcb, fullPrompt, visualDescription };
  } catch (e) {
      console.error(`[generateAndStoreIcon] 🔴 Fatal error for "${ingredient}":`, e);
      throw e;
  }
}

export async function getAllIconsAction() {
    const session = await getAuthService().verifyAuth();
    if (!session?.isAdmin) return [];
    return getDataService().getAllIcons();
}

export async function getPagedIconsAction(page: number = 1, limit: number = 20, query?: string) {
    // Public access allowed for gallery
    return getDataService().getPagedIcons(page, limit, query);
}

export async function getAllStorageFilesAction() {
    const session = await getAuthService().verifyAuth();
    // if (!session?.isAdmin) return null; // Removed Admin check
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
    console.log(`[getOrCreateIconAction] Starting for: ${rawIngredient}`);
    try {
        // Guests allowed, but we check session for accounting if needed
        const session = await getAuthService().verifyAuth();
      
        // Validate Input
        const ingredientParse = IngredientSchema.safeParse(rawIngredient);
        if (!ingredientParse.success) {
            console.warn(`[getOrCreateIconAction] Invalid ingredient: ${rawIngredient}`);
            return { error: 'Invalid ingredient' };
        }
        let ingredient = toTitleCase(ingredientParse.data);

        const countParse = CountSchema.safeParse(rawSessionRejections);
        const sessionRejections = countParse.success ? countParse.data : 0;

        const seenParse = SeenUrlsSchema.safeParse(rawSeenUrls);
        const seenUrls = new Set(seenParse.success ? seenParse.data : []);

        // 1. Search for Ingredient Group
        let bestMatch = await getDataService().getIngredientByName(ingredient);
        if (bestMatch) {
            ingredient = bestMatch.data.name; // Canonical name
            console.log(`[getOrCreateIconAction] Found existing group: ${ingredient}`);
        } else {
            console.log(`[getOrCreateIconAction] New ingredient group: ${ingredient}`);
        }

        // 2. Decide: Pick Existing or Generate New
        if (bestMatch) {
            const icons = await getDataService().getIconsForIngredient(bestMatch.id);
            console.log(`[getOrCreateIconAction] Found ${icons.length} existing icons for ${ingredient}`);

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
                console.log(`[getOrCreateIconAction] Cache exhausted for ${ingredient}, generating new.`);
                debugInfo.decision = 'CACHE_EXHAUSTED';
                shouldGenerate = true;
            } else if (sessionRejections >= SESSION_REJECT_LIMIT) {
                if (provenIcons.length > 0 && bestProvenLCB < QUALITY_FLOOR_LCB) {
                    console.log(`[getOrCreateIconAction] Quality floor breach for ${ingredient}, generating new.`);
                    debugInfo.decision = 'QUALITY_FLOOR_BREACH';
                    shouldGenerate = true;
                } else if (icons.length < MIN_CACHE_SIZE) {
                    console.log(`[getOrCreateIconAction] Cache too small for ${ingredient} and rejections high, generating new.`);
                    debugInfo.decision = 'CACHE_TOO_SMALL_REJECT_STREAK';
                    shouldGenerate = true;
                } else {
                    debugInfo.decision = 'CACHE_SUFFICIENT';
                }
            } else {
                debugInfo.decision = 'NORMAL_SELECTION';
            }

            if (!shouldGenerate) {
                const selected = sortedCandidates[0];
                console.log(`[getOrCreateIconAction] Returning cached icon: ${selected.url}`);
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
                    fullPrompt: selected.fullPrompt || selected.imagePrompt,
                    visualDescription: selected.visualDescription || selected.prompt,
                    debugInfo
                };
            }
          
                      console.log(`[getOrCreateIconAction] Calling generateAndStoreIcon for ${ingredient}...`);
                      const result = await generateAndStoreIcon(ingredient, bestMatch.id);
                      console.log(`[getOrCreateIconAction] Generation success for ${ingredient}: ${result.url}`);
                      return { 
                          ...result,
                          iconUrl: result.url, 
                          isNew: true, 
                          debugInfo: { ...debugInfo, decision: 'GENERATED_NEW' } 
                      };
                  } 
                        
                // 3. Create New Ingredient Group (Requires Auth)
                // This is currently commented out so anyone can forge new ingredients.
                // I will add this back as soon as there are any shenanigans or costs.
                //   if (!session) {
                //       console.warn(`[getOrCreateIconAction] Item not found and user not logged in: ${ingredient}`);
                //       return { error: 'Item not found. Login to forge new items.' };
                //   }
            
                  console.log(`[getOrCreateIconAction] Creating new ingredient group for ${ingredient}...`);
                  const newDocId = await getDataService().createIngredient(ingredient);
                  const result = await generateAndStoreIcon(ingredient, newDocId);
                  console.log(`[getOrCreateIconAction] Initial generation success for ${ingredient}: ${result.url}`);
                  return { 
                      ...result,
                      iconUrl: result.url,
                      isNew: true, 
                      debugInfo: { decision: 'NEW_INGREDIENT_GROUP' } 
                  };
    } catch (e: any) {
        console.error('[getOrCreateIconAction] Fatal Error:', e);
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

export async function updateIconMetadataAction(iconUrl: string, ingredientName: string, updates: { ingredientName?: string, visualDescription?: string }) {
    const session = await getAuthService().verifyAuth();
    if (!session?.isAdmin) return { error: 'Admin required' };

    try {
        const service = getDataService();
        if ('updateIconMetadata' in service) {
             // @ts-ignore
             await service.updateIconMetadata(iconUrl, updates);
        } else {
            return { error: 'Service does not support metadata updates' };
        }
        
        return { success: true };
    } catch (e: any) {
        console.error('updateIconMetadataAction failed:', e);
        return { error: e.message };
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

export async function populateRecipeIconsAction(recipeId: string): Promise<{ updates?: { nodeId: string, iconUrl: string }[], success: boolean, error?: string }> {
    try {
        const recipeData = await getDataService().getRecipe(recipeId);
        if (!recipeData) throw new Error("Recipe not found");
        
        const graph = recipeData.graph;
        const nodesToProcess = graph.nodes.filter(n => !n.iconUrl && n.visualDescription);
        if (nodesToProcess.length === 0) return { success: true, updates: [] };

        const updates: { nodeId: string, iconUrl: string }[] = [];
        
        // Limit concurrency
        const chunk = 5;
        for (let i = 0; i < nodesToProcess.length; i += chunk) {
            const batch = nodesToProcess.slice(i, i + chunk);
            const results = await Promise.all(batch.map(async (node) => {
                 const result = await getOrCreateIconAction(node.visualDescription!);
                 if (result && 'iconUrl' in result && result.iconUrl) {
                     return { nodeId: node.id, iconUrl: result.iconUrl };
                 }
                 return null;
            }));
            results.filter(Boolean).forEach(r => updates.push(r!));
        }
        
        return { success: true, updates };

    } catch (e: any) {
        console.error('populateRecipeIconsAction failed:', e);
        return { success: false, error: e.message };
    }
}

export async function parseRecipeAction(recipeText: string): Promise<{ graph?: RecipeGraph; error?: string }> {
    try {
        // Guests allowed
        
        const prompt = generateRecipePrompt(recipeText);
        
        // Use AIService (Mock aware)
        const text = await getAIService().generateText(prompt);

        const graph = parseRecipeGraph(text);
        graph.originalText = recipeText;
        
        const serves = extractServes(recipeText);
        if (serves) {
            graph.baseServes = serves;
            graph.serves = serves;
        } else {
            graph.baseServes = 1;
            graph.serves = 1;
        }

        return { graph };

    } catch (e: any) {
        console.error('parseRecipeAction failed:', e);
        return { error: e.message || 'Failed to parse recipe.' };
    }
}

export async function adjustRecipeAction(currentGraph: RecipeGraph, prompt: string) {
  try {
    const fullPrompt = generateAdjustmentPrompt(currentGraph, prompt);
    const text = await getAIService().generateText(fullPrompt);

    const newGraph = parseRecipeGraph(text);

    // Restore icons if ID matches and AI forgot them
    newGraph.nodes.forEach(n => {
        if (!n.iconUrl) {
            const old = currentGraph.nodes.find(o => o.id === n.id);
            if (old && old.iconUrl) n.iconUrl = old.iconUrl;
        }
    });

    return { graph: newGraph, adjustment: prompt };
  } catch (e: any) {
    console.error('adjustRecipeAction failed:', e);
    return { error: e.message };
  }
}

export async function saveRecipeAction(graph: RecipeGraph, existingId?: string, visibility: 'private' | 'unlisted' | 'public' = 'unlisted') {
  try {
    const session = await getAuthService().verifyAuth();
    const userId = session?.uid; // Allow saving if not logged in? DataService handles it (might require userId for some cases)
    // The requirement: "Every recipe made by a logged in user is saved to their account"
    
    const dataService = getDataService();
    const id = await dataService.saveRecipe(graph, existingId, userId, visibility);
    return { id };
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function getRecipeAction(id: string) {
  try {
    const dataService = getDataService();
    const recipeData = await dataService.getRecipe(id);
    
    if (recipeData?.graph && !recipeData.graph.visibility) {
        // Backfill visibility if missing (default to unlisted)
        console.log(`[getRecipeAction] Backfilling visibility for ${id}`);
        recipeData.graph.visibility = 'unlisted';
        // We don't necessarily need to await this save to return the data, 
        // but it's safer to ensure consistency.
        await dataService.saveRecipe(recipeData.graph, id, undefined, 'unlisted');
    }

    return { graph: recipeData?.graph, ownerId: recipeData?.ownerId };
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function generateGraphIconsAction(graph: RecipeGraph): Promise<{ graph: RecipeGraph; error?: string }> {
    console.log(`[generateGraphIconsAction] 🚀 Starting for graph with ${graph.nodes.length} nodes.`);
    try {
        const newGraph: RecipeGraph = JSON.parse(JSON.stringify(graph));
        
        const nodesToProcess = newGraph.nodes.filter(n => n.visualDescription && !n.iconUrl);
        console.log(`[generateGraphIconsAction] Found ${nodesToProcess.length} nodes needing icons.`);

        const chunk = 3;
        for (let i = 0; i < newGraph.nodes.length; i += chunk) {
            const batch = newGraph.nodes.slice(i, i + chunk);
            await Promise.all(batch.map(async (node) => {
                if (node.visualDescription && !node.iconUrl) {
                    console.log(`[generateGraphIconsAction] Processing node: ${node.text} (Visual: ${node.visualDescription})`);
                    try {
                        const result = await getOrCreateIconAction(node.visualDescription);
                        if (result && 'iconUrl' in result && result.iconUrl) {
                            console.log(`[generateGraphIconsAction] Icon assigned for "${node.text}": ${result.iconUrl.substring(0, 30)}...`);
                            node.iconUrl = result.iconUrl;
                        } else {
                            console.warn(`[generateGraphIconsAction] No icon returned for "${node.text}"`);
                        }
                    } catch (e) {
                        console.error(`[generateGraphIconsAction] Error processing node "${node.text}":`, e);
                    }
                }
            }));
        }

        console.log(`[generateGraphIconsAction] 🏁 Finished.`);
        return { graph: newGraph };

    } catch (e: any) {
        console.error('[generateGraphIconsAction] 🔴 Failed:', e);
        return { graph, error: e.message };
    }
}

export async function rerollIconAction(nodeId: string, ingredientName: string, currentIconUrl: string, seenUrls: string[] = []) {
    try {
        // Record Rejection if possible
        if (currentIconUrl) {
             const ingMatch = await getDataService().getIngredientByName(ingredientName);
             if (ingMatch) {
                 await getDataService().recordRejection(currentIconUrl, ingredientName, ingMatch.id);
             }
        }

        // Get New Icon
        // Combine current bad one with history of bad ones
        const allSeen = Array.from(new Set([...seenUrls, currentIconUrl]));
        const result = await getOrCreateIconAction(ingredientName, 0, allSeen);
        
        if ('error' in result) return { error: result.error };
        
        return { 
            iconUrl: result.iconUrl,
            nodeId 
        };

    } catch (e: any) {
        console.error('rerollIconAction failed:', e);
        return { error: e.message };
    }
}

export async function getPublicGalleryAction() {
    try {
        const service = getDataService();
        return await service.getPublicRecipes(50);
    } catch (e: any) {
        console.error('getPublicGalleryAction failed:', e);
        return [];
    }
}

export async function toggleStarAction(recipeId: string): Promise<{ starred: boolean; error?: string }> {
    try {
        const session = await getAuthService().verifyAuth();
        if (!session) return { starred: false, error: 'Login required' };
        
        const starred = await getDataService().toggleStar(recipeId, session.uid);
        return { starred };
    } catch (e: any) {
        return { starred: false, error: e.message };
    }
}

export async function voteRecipeAction(recipeId: string, vote: 'like' | 'dislike' | 'none'): Promise<{ error?: string }> {
    try {
        const session = await getAuthService().verifyAuth();
        if (!session) return { error: 'Login required' };
        
        await getDataService().voteRecipe(recipeId, session.uid, vote);
        return {};
    } catch (e: any) {
        return { error: e.message };
    }
}

export async function copyRecipeAction(recipeId: string): Promise<{ newId?: string; error?: string }> {
    try {
        const session = await getAuthService().verifyAuth();
        if (!session) return { error: 'Login required' };
        
        const newId = await getDataService().copyRecipe(recipeId, session.uid);
        return { newId };
    } catch (e: any) {
        return { error: e.message };
    }
}

export async function checkExistingCopiesAction(originalId: string): Promise<{ copies: any[]; error?: string }> {
    try {
        const session = await getAuthService().verifyAuth();
        if (!session) return { copies: [] }; // Or error? Prompt implies "If she opens bob's link... again" -> likely logged in check
        
        const copies = await getDataService().checkExistingCopies(originalId, session.uid);
        return { copies };
    } catch (e: any) {
        return { copies: [], error: e.message };
    }
}

export async function debugLogAction(message: string) {
    console.log(`[CLIENT-LOG] ${message}`);
}
