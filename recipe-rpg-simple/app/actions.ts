'use server';

import { getAIService } from '@/lib/ai-service';
import { getDataService } from '@/lib/data-service';
import { getAuthService } from '@/lib/auth-service';
import { z } from 'zod';
import { generateRecipePrompt, parseRecipeGraph, extractServes } from '@/lib/recipe-lanes/parser';
import { generateAdjustmentPrompt } from '@/lib/recipe-lanes/adjuster';
import type { RecipeGraph } from '@/lib/recipe-lanes/types';
import { standardizeIngredientName } from '@/lib/utils';
import { db } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { DB_COLLECTION_INGREDIENTS, DB_COLLECTION_QUEUE, DB_COLLECTION_RECIPES } from '@/lib/config';

// Input Validation Schemas
const IngredientSchema = z.string().min(1).max(100);
const SeenUrlsSchema = z.array(z.string().url()).default([]);
/* New code */

/**
 * Scans a recipe graph for nodes missing icons, checks the ingredient cache,
 * and either applies an immediate hit or queues a generation request.
 */
async function resolveIcons(recipeId: string) {
    console.log(`[resolveIcons] Processing recipe: ${recipeId}`);
    
    const recipeRef = db.collection(DB_COLLECTION_RECIPES).doc(recipeId);
    const doc = await recipeRef.get();
    
    if (!doc.exists) {
        console.error(`[resolveIcons] Recipe ${recipeId} not found.`);
        return;
    }
    
    const data = doc.data();
    const graph = data?.graph;
    
    if (!graph || !Array.isArray(graph.nodes)) return;

    // Get recipe-level rejections
    const recipeRejections = graph.rejections || {};

    // Identify nodes that need icons (visualDescription present, iconId missing OR rejected)
    const nodesToProcess = graph.nodes.filter((n: any) => {
        if (!n.visualDescription) return false;
        if (!n.iconId) return true;
        const stdName = standardizeIngredientName(n.visualDescription as string);
        return recipeRejections[stdName]?.includes(n.iconId);
    });
    
    if (nodesToProcess.length === 0) {
        console.log(`[resolveIcons] No pending nodes for ${recipeId}`);
        return;
    }

    console.log(`[resolveIcons] Found ${nodesToProcess.length} nodes to process.`);

    const batch = db.batch();
    let queuedCount = 0;
    const immediateUpdates = new Map<string, { iconId: string, iconUrl: string }>();
    
    // Optimization: Pre-fetch all required ingredients
    const uniqueNames = Array.from(new Set(nodesToProcess.map((n: any) => standardizeIngredientName(String(n.visualDescription))))) as string[];
    const ingRefs = uniqueNames.map((name: string) => db.collection(DB_COLLECTION_INGREDIENTS).doc(name));
    
    let ingSnaps: FirebaseFirestore.DocumentSnapshot[] = [];
    if (ingRefs.length > 0) {
        ingSnaps = await db.getAll(...ingRefs);
    }
    
    const ingMap = new Map<string, any>();
    ingSnaps.forEach(s => {
        if (s.exists) ingMap.set(s.id, s.data());
    });

    for (const node of nodesToProcess) {
        const stdName = standardizeIngredientName(String(node.visualDescription));
        const rejectedIds = new Set<string>(recipeRejections[stdName] || []);
        
        const ingData = ingMap.get(stdName);
        let bestIcon = null;

        if (ingData && ingData.icons && Array.isArray(ingData.icons)) {
            // Find best icon not in rejections
            // Sort by score (descending)
            const sortedIcons = [...ingData.icons].sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
            
            for (const icon of sortedIcons) {
                if (!rejectedIds.has(icon.id) && !icon.marked_for_deletion) {
                    bestIcon = icon;
                    break;
                }
            }
        }

        if (bestIcon) {
            // Cache Hit
            immediateUpdates.set(node.id, { iconId: bestIcon.id, iconUrl: bestIcon.url });
        } else {
            // Cache Miss -> Queue
            const queueRef = db.collection(DB_COLLECTION_QUEUE).doc(stdName);
            // Use set with merge to create or update
            batch.set(queueRef, {
                status: 'pending',
                created_at: FieldValue.serverTimestamp(),
                recipes: FieldValue.arrayUnion(recipeId)
            }, { merge: true });
            queuedCount++;
        }
    }

    // 2. Apply Immediate Updates
    if (immediateUpdates.size > 0) {
        console.log(`[resolveIcons] Applying ${immediateUpdates.size} immediate cache hits.`);
        const newNodes = graph.nodes.map((n: any) => {
            if (immediateUpdates.has(n.id)) {
                return { ...n, ...immediateUpdates.get(n.id) };
            }
            return n;
        });
        
        batch.update(recipeRef, { "graph.nodes": newNodes });
    }

    // 3. Commit Queue & Updates
    if (queuedCount > 0 || immediateUpdates.size > 0) {
        await batch.commit();
        console.log(`[resolveIcons] Batch committed: ${immediateUpdates.size} updates, ${queuedCount} queued.`);
    } else {
        console.log(`[resolveIcons] No actions taken.`);
    }
}

// --- Cloud Functions ---

/**
 * Server Action for clients to reject an icon.
 * Records the rejection, clears the icon from the node, and triggers a refill.
 */
export async function rejectIcon(recipeId: string, nodeId: string, ingredientName: string, currentIconId?: string) {
    console.log(`[rejectIcon] Request: Recipe ${recipeId}, Node ${nodeId}, Ingredient ${ingredientName}`);
    
    if (!recipeId || !nodeId || !ingredientName) {
        throw new Error('Missing recipeId, nodeId, or ingredientName');
    }

    const recipeRef = db.collection(DB_COLLECTION_RECIPES).doc(recipeId);
    let iconIdToReject = currentIconId;

    await db.runTransaction(async (t) => {
        const doc = await t.get(recipeRef);
        if (!doc.exists) throw new Error('Recipe not found');
        
        const data = doc.data()!;
        // Optional: Check ownership here if needed
        
        const graph = data.graph;
        const nodes = graph.nodes || [];
        const nodeIndex = nodes.findIndex((n: any) => n.id === nodeId);
        
        if (nodeIndex === -1) throw new Error('Node not found in graph');
        
        const node = nodes[nodeIndex];
        // If not provided, try to infer from node
        const stdName = standardizeIngredientName(String(ingredientName));

        // 1. Record Rejection in Recipe
        if (!graph.rejections) graph.rejections = {};
        if (!graph.rejections[stdName]) graph.rejections[stdName] = [];
        
        if (iconIdToReject && !graph.rejections[stdName].includes(iconIdToReject)) {
            graph.rejections[stdName].push(iconIdToReject);
        }

        // 2. Clear Icon from Node
        // TODO clear all node fields.
        nodes[nodeIndex].iconId = null;
        nodes[nodeIndex].iconUrl = null;
        
        t.update(recipeRef, {
            "graph.rejections": graph.rejections,
            "graph.nodes": nodes
        });
    });

    // 3. Record Global Stats (Best Effort)
    if (iconIdToReject) {
        const stdName = standardizeIngredientName(ingredientName);
        try {
            const dataService = getDataService();
            await dataService.recordRejection(iconIdToReject, ingredientName, stdName);
        } catch (e) {
            console.error('[rejectIcon] Failed to record global stats:', e);
        }
    }

    // 4. Trigger Refill (Async)
    // We cleared the icon, so resolveIcons will attempt to find a replacement
    await resolveIcons(recipeId);
    
    return { success: true };
}

export async function createDebugRecipeAction() {
    try {
        const session = await getAuthService().verifyAuth();
        const userId = session?.uid;

        const graph: RecipeGraph = {
            title: 'debug recipe',
            visibility: 'private',
            lanes: [{ id: 'lane-1', label: 'Ingredients', type: 'prep' }],
            nodes: [],
            rejections: {}
        };

        const dataService = getDataService();
        // Force title 'debug recipe' and private
        const id = await dataService.saveRecipe(graph, undefined, userId, 'private', 'System');
        
        return { recipeId: id };
    } catch (e: any) {
        console.error('createDebugRecipeAction failed:', e);
        return { error: e.message };
    }
}

export async function addIngredientNodeAction(recipeId: string, ingredientName: string) {
    try {
        const stdName = standardizeIngredientName(ingredientName);
        const nodeId = 'node-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        
        const recipeRef = db.collection(DB_COLLECTION_RECIPES).doc(recipeId);
        
        // Add node transactionally
        await db.runTransaction(async (t) => {
             const doc = await t.get(recipeRef);
             if (!doc.exists) throw new Error("Recipe not found");
             const data = doc.data();
             const graph = data?.graph;
             
             const newNode = {
                id: nodeId,
                laneId: 'lane-1',
                text: stdName,
                visualDescription: stdName,
                type: 'ingredient',
                x: 0, y: 0
            };
            
            const newNodes = [...(graph.nodes || []), newNode];
            t.update(recipeRef, { "graph.nodes": newNodes });
        });
        
        // Resolve Icons (Fire and forget-ish, or await completion but don't return values)
        await resolveIcons(recipeId);
        
        return { success: true, nodeId };

    } catch (e: any) {
         console.error('addIngredientNodeAction failed:', e);
        return { error: e.message };
    }
}

/* TODO: REPLACE these with just calling resolveIcons when we make a new recipe instead of relying on the cloud function */

// // Automatic Trigger on New Recipe Creation
// export const processNewRecipe = onDocumentCreated({ document: "recipes/{recipeId}", timeoutSeconds: 60, memory: "256MiB" }, async (event) => {
//     await resolveIcons(event.params.recipeId);
// });


// // Manual Callable Function (Debug / Force Retry)
// export const backfillRecipeIcons = onCall({ timeoutSeconds: 60, memory: "256MiB" }, async (request) => {
//     await resolveIcons(request.data.recipeId);
//     return { success: true, message: "Queued icon generation." };
// });


// New Action for "Optimistic Return + Background Trigger"
export async function createVisualRecipeAction(recipeText: string, currentId?: string): Promise<{ id?: string; error?: string }> {
    try {
        console.log('[createVisualRecipeAction] 🚀 Starting...');
        
        // 1. Parse Text
        const prompt = generateRecipePrompt(recipeText);
        // TODO move this to a cloud function.
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

        // 3. Save to Firestore (Initial)
        const session = await getAuthService().verifyAuth();
        const userId = session?.uid;
        
        let targetId = undefined;
        let visibility: 'unlisted' | 'public' | 'private' = 'unlisted';

        // If the user has updated the recipe, save over it or fork it if it's not theirs.
        if (currentId && userId) {
            // Don't trust the graph provided, get the id from the db to get the real owner.
            const original = await getDataService().getRecipe(currentId);
            if (original) {
                if (original.ownerId === userId) {
                    targetId = currentId;
                    visibility = (original.visibility as any) || 'unlisted';
                    // Keep the title the same.
                    if (original.graph.title) graph.title = original.graph.title;
                }
                else {
                    // Forking logic.
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

        console.log('[createVisualRecipeAction] Resolving icons');
        await resolveIcons(id);
        
        console.log(`[createVisualRecipeAction] ✅ Complete. ID: ${id}`);
        return {id} ;

    } catch (e: any) {
        console.error('[createVisualRecipeAction] Failed:', e);
        return { error: e.message || 'Failed to process recipe.' };
    }
}




/* Old code below here */

export async function getPagedIconsAction(page: number = 1, limit: number = 20, query?: string) {
    // Public access allowed for gallery
    return getDataService().getPagedIcons(page, limit, query);
}

export async function getAllStorageFilesAction() {
    const session = await getAuthService().verifyAuth();
    // if (!session?.isAdmin) return null; // Removed Admin check
    return getDataService().listDebugFiles();
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
    const ownerName = session?.name;
    
    const dataService = getDataService();
    const id = await dataService.saveRecipe(graph, existingId, userId, visibility, ownerName);
    return { id };
  } catch (e: any) {
    return { error: e.message };
  }
}

/* TODO: These can probably be moved to firestore rules at some point */

// This needs to be server action to access auth.
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
// This could maybe be replaced with firestore rules and direct client access?
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

export async function retryIconGenerationAction(ingredientName: string) {
    try {
        await getDataService().retryIconGeneration(ingredientName);
        return { success: true };
    } catch (e: any) {
        return { error: e.message };
    }
}

export async function debugLogAction(message: string) {
    console.log(`[CLIENT-LOG] ${message}`);
}
/* ^ Triaged ^ */


// this is for the shared gallery on '/'.
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