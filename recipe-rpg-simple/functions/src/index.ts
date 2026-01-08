import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAIService } from '../../lib/ai-service';
import { getDataService } from '../../lib/data-service';
import { processIcon } from './image-processing';
import { generateAndStoreIcon } from './icon-generator';
import { DB_COLLECTION_INGREDIENTS, DB_COLLECTION_QUEUE, DB_COLLECTION_RECIPES } from '../../lib/config';
import { standardizeIngredientName } from '../../lib/utils';
import { db } from '../../lib/firebase-admin';

// --- Helper Functions ---

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
 * Callable function for clients to reject an icon.
 * Records the rejection, clears the icon from the node, and triggers a refill.
 */
export const rejectIcon = onCall(async (request) => {
    const { recipeId, nodeId, ingredientName, currentIconId } = request.data;
    console.log('[rejectIcon] Invoked with data:', request.data);
    console.log(`[rejectIcon] ${currentIconId} =? ${nodeId} icon`);
    
    if (!recipeId || !nodeId || !ingredientName) {
        throw new HttpsError('invalid-argument', 'Missing recipeId, nodeId, or ingredientName');
    }

    console.log(`[rejectIcon] Request: Recipe ${recipeId}, Node ${nodeId}, Ingredient ${ingredientName}`);

    const recipeRef = db.collection(DB_COLLECTION_RECIPES).doc(recipeId);
    let iconIdToReject = currentIconId;

    await db.runTransaction(async (t) => {
        const doc = await t.get(recipeRef);
        if (!doc.exists) throw new HttpsError('not-found', 'Recipe not found');
        
        const data = doc.data()!;
        // Optional: Check ownership here if needed
        
        const graph = data.graph;
        const nodes = graph.nodes || [];
        const nodeIndex = nodes.findIndex((n: any) => n.id === nodeId);
        
        if (nodeIndex === -1) throw new HttpsError('not-found', 'Node not found in graph');
        
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
});

/**
 * Worker Function (Queue Processor)
 * Processes items in 'icon_queue' collection.
 */
export const processIconQueue = onDocumentWritten({ 
    document: "icon_queue/{ingredientName}", 
    timeoutSeconds: 300, 
    memory: "1GiB",
    maxInstances: 1 
}, async (event) => {
    if (!event.data || !event.data.after) return;
    const data = event.data.after.data();
    
    // Only process if status is 'pending'
    if (!data || data.status !== 'pending') return;

    const ingredientName = event.params.ingredientName;
    const recipeIds: string[] = data.recipes || [];

    console.log(`[Queue] Processing: "${ingredientName}" for recipes: ${recipeIds.join(', ')}`);

    try {
        await event.data.after.ref.update({ status: 'processing' });
        console.log(`[Queue] Generating new icon for "${ingredientName}"...`);
        
        const result = await generateAndStoreIcon({ ingredientName });
        
        // Update all linked recipes
        console.log(`[Queue] Updating ${recipeIds.length} recipes...`);
        for (const rId of recipeIds) {
            const recipeRef = db.collection(DB_COLLECTION_RECIPES).doc(rId);
            await db.runTransaction(async (t) => {
                const doc = await t.get(recipeRef);
                if (!doc.exists) return;
                const recipeData = doc.data();
                if (!recipeData?.graph?.nodes) return;
                
                const nodes = recipeData.graph.nodes;
                let changed = false;
                
                nodes.forEach((n: any) => {
                    if (n.visualDescription && !n.iconId) {
                         const nName = standardizeIngredientName(String(n.visualDescription));
                        if (nName === ingredientName) {
                            // Update node with new icon details
                            n.iconId = result.id;
                            n.iconUrl = result.url;
                            changed = true;
                        }
                    }
                });
                
                if (changed) {
                    t.update(recipeRef, { "graph.nodes": nodes });
                }
            });
        }

        //TODO: Delete the record. Any in flight recipes that would be added 
        // to the backlog, will instead have their reject list checked and find
        // the new icon in the cache.
        await event.data.after.ref.update({ 
            status: 'completed',
            iconId: result.id,
            iconUrl: result.url,
            updated_at: FieldValue.serverTimestamp()
        });

        console.log(`[Queue] Completed "${ingredientName}"`);

    } catch (e: any) {
        console.error(`[Queue] Failed "${ingredientName}":`, e);
        await event.data.after.ref.update({ 
            status: 'failed', 
            error: e.message, 
            updated_at: FieldValue.serverTimestamp() 
        });
    }
});

// Automatic Trigger on New Recipe Creation
export const processNewRecipe = onDocumentCreated({ document: "recipes/{recipeId}", timeoutSeconds: 60, memory: "256MiB" }, async (event) => {
    await resolveIcons(event.params.recipeId);
});

// Manual Callable Function (Debug / Force Retry)
export const backfillRecipeIcons = onCall({ timeoutSeconds: 60, memory: "256MiB" }, async (request) => {
    await resolveIcons(request.data.recipeId);
    return { success: true, message: "Queued icon generation." };
});