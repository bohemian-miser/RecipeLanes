'use server';

import { getAIService } from '@/lib/ai-service';
import { getDataService } from '@/lib/data-service';
import { getAuthService } from '@/lib/auth-service';
import { z } from 'zod';
import { generateRecipePrompt, parseRecipeGraph, extractServes } from '@/lib/recipe-lanes/parser';
import { generateAdjustmentPrompt } from '@/lib/recipe-lanes/adjuster';
import type { RecipeGraph } from '@/lib/recipe-lanes/types';
import { resolveIconsForGraph } from '@/lib/icon-orchestrator';

// Input Validation Schemas
const IngredientSchema = z.string().min(1).max(100);
const SeenUrlsSchema = z.array(z.string().url()).default([]);

// Helper for Title Case
function toTitleCase(str: string) {
  return str
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
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
    rawSessionRejections = 0, // Kept for API compatibility, unused in new logic
    rawSeenUrls: string[] = []
) {
    console.log(`[getOrCreateIconAction] Starting for: ${rawIngredient}`);
    try {
        // Validate Input
        const ingredientParse = IngredientSchema.safeParse(rawIngredient);
        if (!ingredientParse.success) {
            console.warn(`[getOrCreateIconAction] Invalid ingredient: ${rawIngredient}`);
            return { error: 'Invalid ingredient' };
        }
        const ingredient = toTitleCase(ingredientParse.data);

        const seenParse = SeenUrlsSchema.safeParse(rawSeenUrls);
        const seenUrls = seenParse.success ? seenParse.data : [];
        
        // Treat seen URLs as rejected to force cycling/new generation
        // Map URLs to IDs if possible? queueIcons checks ID in cache.
        // But seenUrls are URLs. DataService queueIcons logic:
        // "if (!rejected.has(icon.id))"
        
        // We need to map seen URLs to IDs, or update queueIcons to check URLs too.
        // For now, let's assume we can't easily map back without querying.
        // BUT queueIcons implementation only checks ID.
        // The client passes URLs.
        // We should fetch the ingredient first to resolve URLs to IDs?
        // Or update queueIcons to accept URLs.
        
        // Actually, let's fetch the ingredient to map URLs to IDs.
        const dataService = getDataService();
        const match = await dataService.getIngredientByName(ingredient);
        const rejectedIds: string[] = [];
        
        if (match && match.data.icons) {
            match.data.icons.forEach((icon: any) => {
                if (seenUrls.includes(icon.url)) {
                    rejectedIds.push(icon.id);
                }
            });
        }

        // 1. Queue Request
        const result = await dataService.queueIcons([{ 
            ingredientName: ingredient, 
            rejectedIds 
        }]);
        
        const stdName = toTitleCase(ingredient);
        
        // 2. Check for Immediate Hit
        if (result.has(stdName)) {
            const hit = result.get(stdName)!;
            console.log(`[getOrCreateIconAction] Cache hit for ${ingredient}: ${hit.iconUrl}`);
            
            // Increment Impressions (Fire and Forget)
            dataService.recordImpression(stdName, hit.iconId)
                .catch(e => console.error('Failed to record impression:', e));

            return {
                iconId: hit.iconId,
                iconUrl: hit.iconUrl,
                isNew: false,
                popularityScore: 0,
                visualDescription: ingredient
            };
        }

        // 3. Poll for Completion
        console.log(`[getOrCreateIconAction] Waiting for generation: ${ingredient}`);
        const completion = await dataService.waitForQueue(ingredient, 15000); // 15s timeout
        
        if (completion) {
             console.log(`[getOrCreateIconAction] Generation completed: ${completion.iconUrl}`);
             return {
                iconId: completion.iconId,
                iconUrl: completion.iconUrl,
                isNew: true,
                popularityScore: 0,
                visualDescription: ingredient
            };
        }

        return { error: 'Generation timed out. Please try again.' };

    } catch (e: any) {
        console.error('[getOrCreateIconAction] Fatal Error:', e);
        return { error: e.message || 'Unknown error during icon generation' };
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
    // const session = await getAuthService().verifyAuth();
    // if (!session?.isAdmin) return { success: false, error: 'Admin required' };

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

// New Action for "Optimistic Return + Background Trigger"
export async function createVisualRecipeAction(recipeText: string, currentId?: string): Promise<{ graph?: RecipeGraph; id?: string; error?: string }> {
    try {
        console.log('[createVisualRecipeAction] 🚀 Starting...');
        
        // 1. Parse Text
        const prompt = generateRecipePrompt(recipeText);
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

        // 2. Optimistic Cache Lookup & Queuing (Unified)
        console.log('[createVisualRecipeAction] 🔍 Checking cache & queuing...');
        
        // Prepare Queue Requests
        const queueItems = graph.nodes
            .filter(n => n.visualDescription)
            .map(n => ({
                ingredientName: n.visualDescription
            }));

        // 3. Save to Firestore (Initial)
        const session = await getAuthService().verifyAuth();
        const userId = session?.uid;
        
        let targetId = undefined;
        let visibility: 'unlisted' | 'public' | 'private' = 'unlisted';

        if (currentId && userId) {
            const original = await getDataService().getRecipe(currentId);
            if (original) {
                if (original.ownerId === userId) {
                    targetId = currentId;
                    visibility = (original.visibility as any) || 'unlisted';
                    if (original.graph.title) graph.title = original.graph.title;
                } else {
                    graph.sourceId = currentId;
                    // ... naming logic ...
                    let newTitle = graph.title || original.graph.title || 'Untitled';
                    if (newTitle.startsWith('Yet another copy of ')) {
                        const match = newTitle.match(/Yet another copy of (.*) \((\d+)\)$/);
                        if (match) {
                            newTitle = `Yet another copy of ${match[1]} (${parseInt(match[2]) + 1})`;
                        } else {
                            newTitle = `${newTitle} (1)`;
                        }
                    } else if (newTitle.startsWith('Another copy of ')) {
                        newTitle = newTitle.replace('Another copy of ', 'Yet another copy of ');
                    } else if (newTitle.startsWith('Copy of ')) {
                        newTitle = newTitle.replace('Copy of ', 'Another copy of ');
                    } else {
                        newTitle = `Copy of ${newTitle}`;
                    }
                    graph.title = newTitle;
                }
            }
        }
        
        console.log('[createVisualRecipeAction] 💾 Saving initial recipe...');
        const id = await getDataService().saveRecipe(graph, targetId, userId, visibility);
        
        // 4. Resolve Icons (Unified Orchestrator)
        // This handles cache checks, rejections, and queuing.
        // It updates the graph with immediate hits.
        const { graph: updatedGraph } = await resolveIconsForGraph(graph, id);
        
        // We already saved the initial graph.
        // If resolveIconsForGraph found hits, we should update the DB or just return the updated graph?
        // resolveIconsForGraph updates the passed graph object in place (or returns updated copy).
        // queueIcons (called inside) updates the DB transactionally for hits.
        // So we don't need to save again?
        // Wait, queueIcons updates DB if recipeId is passed.
        // Yes, updatesByRecipe logic in DataService handles DB update.
        
        console.log(`[createVisualRecipeAction] ✅ Complete. ID: ${id}`);
        return { graph: updatedGraph, id };

    } catch (e: any) {
        console.error('[createVisualRecipeAction] Failed:', e);
        return { error: e.message || 'Failed to process recipe.' };
    }
}

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
    const userId = session?.uid; 
    
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

    return { graph: recipeData?.graph, ownerId: recipeData?.ownerId, ownerName: recipeData?.ownerName };
  } catch (e: any) {
    return { error: e.message };
  }
}



export async function rerollIconAction(
    nodeId: string, 
    ingredientName: string, 
    currentIconUrl: string, 
    seenUrls: string[] = [], 
    recipeId?: string,
    currentIconId?: string
) {
    try {
        console.log(`[rerollIconAction] Rerolling ${ingredientName} (Node ${nodeId})`);
        
        let graph: RecipeGraph | undefined;

        // 1. Persist Rejection to Recipe
        if (recipeId) {
            const recipeData = await getDataService().getRecipe(recipeId);
            if (recipeData) {
                graph = recipeData.graph;
                if (!graph.rejections) graph.rejections = {};
                if (!graph.rejections[ingredientName]) graph.rejections[ingredientName] = [];
                
                // Add current to rejections
                const idToReject = currentIconId || (currentIconUrl ? 'url:' + currentIconUrl : null);
                if (idToReject && !graph.rejections[ingredientName].includes(idToReject)) {
                    graph.rejections[ingredientName].push(idToReject);
                }
                
                // Save persistent rejections
                await getDataService().saveRecipe(graph, recipeId, recipeData.ownerId, recipeData.visibility as any);
            }
        }

        // 2. Resolve Icons (Using Orchestrator)
        if (!graph) {
             return { error: 'Recipe Context required for reroll' };
        }

        // Force the specific node to be re-evaluated by clearing its icon
        const nodeIndex = graph.nodes.findIndex(n => n.id === nodeId);
        if (nodeIndex !== -1) {
            graph.nodes[nodeIndex].iconUrl = undefined;
            graph.nodes[nodeIndex].iconId = undefined;
        }

        const { hits } = await resolveIconsForGraph(graph, recipeId);
        
        // 3. Return Result
        const stdName = toTitleCase(ingredientName);
        if (hits.has(stdName)) {
            const hit = hits.get(stdName)!;
            return { 
                iconId: hit.iconId,
                iconUrl: hit.iconUrl,
                nodeId 
            };
        }

        return { 
            status: 'pending',
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

export async function deleteRecipeAction(recipeId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await getAuthService().verifyAuth();
        if (!session) return { success: false, error: 'Login required' };
        
        await getDataService().deleteRecipe(recipeId, session.uid);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function debugLogAction(message: string) {
    console.log(`[CLIENT-LOG] ${message}`);
}

export async function retryIconGenerationAction(ingredientName: string) {
    try {
        await getDataService().retryIconGeneration(ingredientName);
        return { success: true };
    } catch (e: any) {
        return { error: e.message };
    }
}
