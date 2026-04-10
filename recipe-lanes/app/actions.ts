/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

'use server';

import { after } from 'next/server';
import { getAIService } from '@/lib/ai-service';
import { getDataService } from '@/lib/data-service';
import { getAuthService } from '@/lib/auth-service';
import { z } from 'zod';
import { generateRecipePrompt, parseRecipeGraph, extractServes, generateHydeQueriesPrompt, parseHydeQueries } from '@/lib/recipe-lanes/parser';
import { generateAdjustmentPrompt } from '@/lib/recipe-lanes/adjuster';
import type { RecipeGraph, IconStats } from '@/lib/recipe-lanes/types';
import { standardizeIngredientName } from '@/lib/utils';
import { cosineSimilarity, getIconThumbUrl, getNodeIconUrl, getShortlistIconAt, preserveNodeShortlist } from '@/lib/recipe-lanes/model-utils';
import { db } from '@/lib/firebase-admin';
import { DB_COLLECTION_RECIPES, DB_COLLECTION_QUEUE } from '@/lib/config';
import { unifiedIconSearch, batchIconSearch } from '@/lib/search-orchestrator';

// Input Validation Schemas
const IngredientSchema = z.string().min(1).max(100);
const SeenUrlsSchema = z.array(z.string().url()).default([]);
/* New code */

// --- Cloud Functions ---

/**
 * Server Action for clients to reject an icon.
 * Records the rejection, clears the icon from the node, and triggers a refill.
 */
// icon_overview only
export async function rejectIcon(recipeId: string, ingredientName: string, currentIconId?: string) {
    try {
        const session = await getAuthService().verifyAuth();
        const userId = session?.uid;
        return getDataService().rejectRecipeIcon(recipeId, ingredientName, currentIconId, userId, batchIconSearch);
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function forgeIconAction(recipeId: string, ingredientName: string, currentIconId?: string) {
    try {
        const session = await getAuthService().verifyAuth();
        const userId = session?.uid;
        // Forge: reject current and queue brand-new generation (no index search — skip embedFn)
        return getDataService().rejectRecipeIcon(recipeId, ingredientName, currentIconId, userId);
    } catch (e: any) {
        return { success: false, error: e.message };
    }
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
        const id = await dataService.saveRecipe(graph, undefined, userId, 'unlisted', 'System');
        
        return { recipeId: id };
    } catch (e: any) {
        console.error('createDebugRecipeAction failed:', e);
        return { error: e.message };
    }
}
// icon_overview and tests only.
export async function addIngredientNodeAction(recipeId: string, ingredientName: string) {
    // Generate HyDE queries so the icon_index entry gets rich search terms
    let hydeQueries: string[] = [];
    try {
        const raw = await getAIService().generateText(generateHydeQueriesPrompt(ingredientName));
        hydeQueries = parseHydeQueries(raw);
    } catch (e) {
        console.warn('[addIngredientNodeAction] HyDE query generation failed (non-fatal):', e);
    }
    const result = await getDataService().addNodeToRecipe(recipeId, ingredientName, undefined, hydeQueries);
    if (result.success) {
        // 5. Trigger icon resolution in background (or foreground if preferred)
        try {
            if (process.env.NODE_ENV === 'test') {
                await getDataService().resolveRecipeIcons(recipeId, batchIconSearch);
            } else {
                after(() => getDataService().resolveRecipeIcons(recipeId, batchIconSearch));
            }
        } catch (e) {
            // Fallback for environments where 'after' is not supported (like some older Next.js versions or non-request contexts)
            console.log("[addIngredientNodeAction] 'after' not supported or outside request scope, running sync");
            await getDataService().resolveRecipeIcons(recipeId, batchIconSearch);
        }
    }
    return result;
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

        // Return the ID immediately — the client's snapshot listener will pick up
        // icon shortlists as resolveRecipeIcons writes them to Firestore.
        // Falls back to awaiting directly when outside a Next.js request context (tests).
        const embedFn = getAIService().embedTexts.bind(getAIService());
        try {
            if (process.env.NODE_ENV === 'test') {
                await getDataService().resolveRecipeIcons(id, batchIconSearch);
            } else {
                after(() => getDataService().resolveRecipeIcons(id, batchIconSearch));
            }
        } catch (e) {
            console.log("[createVisualRecipeAction] 'after' not supported or outside request scope, running sync", e);
            await getDataService().resolveRecipeIcons(id, batchIconSearch);
        }

        console.log(`[createVisualRecipeAction] ✅ Saved. ID: ${id} (icons resolving in background)`);
        return {id};

    } catch (e: any) {
        console.error('[createVisualRecipeAction] Failed:', e);
        return { error: e.message || 'Failed to process recipe.' };
    }
}



// TODO: Why is this needed for a test??
// export async function getOrCreateIconAction(
//     rawIngredient: string,
//     rawSessionRejections = 0,
//     rawSeenUrls: string[] = []
// ) {
//     try {
//         const ingredient = standardizeIngredientName(rawIngredient);
//         const service = getDataService();
        
//         const hits = await service.queueIcons([{ ingredientName: ingredient }]);
        
//         if (hits.has(ingredient)) {
//             const hit = hits.get(ingredient)!;
//             return {
//                 id: hit.id,
//                 url: getIconThumbUrl(hit.id, ingredient),
//                 isNew: false,
//                 popularityScore: hit.score || 0,
//                 visualDescription: ingredient
//             };
//         }

//         const completion = await service.waitForQueue(ingredient);
//         if (completion) {
//              return {
//                 id: completion.id,
//                 url: getIconThumbUrl(completion.id, ingredient),
//                 isNew: true,
//                 popularityScore: 0,
//                 visualDescription: ingredient
//             };
//         }
        
//         return { error: 'Generation timed out' };
//     } catch (e: any) {
//         return { error: e.message };
//     }
// }

export async function getAllIconsAction() {
    const session = await getAuthService().verifyAuth();
    if (!session?.isAdmin) return [];
    return getDataService().getAllIcons();
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
            const name = icon.ingredient_name || icon.ingredient;
            if (!grouped[name]) grouped[name] = [];
            grouped[name].push(icon);
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

export async function updateIconMetadataAction(iconUrl: string, ingredientName: string, updates: { ingredientName?: string, visualDescription?: string }) {
    const session = await getAuthService().verifyAuth();
    if (!session?.isAdmin) return { error: 'Admin required' };

    try {
        // Not implemented in DataService interface yet, skipping implementation for now or need to add to interface.
        // The original code had a direct DB call or a method on the service.
        // Let's stub it for now or rely on what's there.
        // The interface doesn't have updateIconMetadata.
        return { error: 'Not implemented' };
    } catch (e: any) {
        return { error: e.message };
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
    newGraph.nodes = newGraph.nodes.map(n => {
        if (getNodeIconUrl(n)) return n;
        const old = currentGraph.nodes.find(o => o.id === n.id);
        return old ? preserveNodeShortlist(n, old) : n;
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

export async function clearIconQueueAction(): Promise<{ success: boolean; deleted: number; error?: string }> {
    const session = await getAuthService().verifyAuth();
    if (!session) return { success: false, deleted: 0, error: 'Login required' };
    const userDoc = await db.collection('users').doc(session.uid).get();
    if (!userDoc.data()?.isAdmin) return { success: false, deleted: 0, error: 'Admin required' };

    try {
        const snap = await db.collection(DB_COLLECTION_QUEUE).get();
        const docs = snap.docs;
        // Batch delete in chunks of 500
        let deleted = 0;
        for (let i = 0; i < docs.length; i += 500) {
            const batch = db.batch();
            docs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
            await batch.commit();
            deleted += Math.min(500, docs.length - i);
        }
        console.log(`[clearIconQueue] Deleted ${deleted} queue docs`);
        return { success: true, deleted };
    } catch (e: any) {
        return { success: false, deleted: 0, error: e.message };
    }
}

/* ^ Triaged ^ */


// this is for the shared gallery on '/icon_overview'.
export async function deleteIconByIdAction(iconId: string, ingredientName?: string): Promise<{ success: boolean; error?: string }> {
    const session = await getAuthService().verifyAuth();
    if (!session) return { success: false, error: 'Login required' };

    // Explicit DB lookup for security
    const userDoc = await db.collection('users').doc(session.uid).get();
    if (!userDoc.data()?.isAdmin) return { success: false, error: 'Admin required' };

     try {
        await getDataService().deleteIcon(iconId, ingredientName);
        return { success: true };
    } catch (e: any) {
        console.error('deleteIconByIdAction failed:', e);
        return { success: false, error: e.message };
    }
}

// export async function recordRejectionAction(iconId: string, ingredientName: string) {
//     const session = await getAuthService().verifyAuth();
//     if (!session?.isAdmin) return { error: 'Admin required' };
//     try {
//         const stdName = standardizeIngredientName(ingredientName);
//         await getDataService().recordRejection(iconId, ingredientName, stdName);
//         return { success: true };
//     } catch (e: any) {
//         console.error('recordRejectionAction failed:', e);
//         return { error: e.message };
//     }
// }

export async function submitFeedbackAction(data: { message: string, url: string, email?: string, graphJson?: string }) {
    try {
        const session = await getAuthService().verifyAuth();
        const userId = session?.uid;
        
        if (!data.message || !data.message.trim()) {
            return { error: 'Message is required' };
        }

        await getDataService().submitFeedback({
            ...data,
            userId
        });
        return { success: true };
    } catch (e: any) {
        console.error('submitFeedbackAction failed:', e);
        return { error: e.message };
    }
}

export async function vetRecipeAction(recipeId: string, isVetted: boolean) {
    const session = await getAuthService().verifyAuth();
    if (!session?.isAdmin) return { error: 'Admin required' };

    try {
        await getDataService().vetRecipe(recipeId, isVetted);
        return { success: true };
    } catch (e: any) {
        return { error: e.message };
    }
}


export async function getLegacyEmbeddingAction(query: string): Promise<number[]> {
  if (!query.trim()) return [];
  try {
    console.log(`[getLegacyEmbeddingAction] getting Vertex embedding for "${query}"`);
    return await getAIService().embedTexts([query]);
  } catch (e: any) {
    console.error('[getLegacyEmbeddingAction] failed:', e);
    throw new Error(e.message || 'Failed to generate embedding');
  }
}

export async function searchIconCandidatesAction(query: string): Promise<{ candidates: IconStats[], matchScores: Record<string, number>, error?: string }> {
  if (!query.trim()) return { candidates: [], matchScores: {} };
  try {
    console.log(`[searchIconCandidatesAction] query="${query}"`);
    const embedding = await getAIService().embedTexts([query]);
    console.log(`[searchIconCandidatesAction] embedding dim=${embedding.length}`);
    const candidates = await getDataService().searchIconsByEmbedding(embedding, 12);
    console.log(`[searchIconCandidatesAction] got ${candidates.length} candidates`);
    const embeddings = await getDataService().getIconEmbeddings(candidates.map(c => c.id));
    const matchScores: Record<string, number> = {};
    for (const c of candidates) {
      const vec = embeddings.get(c.id);
      if (vec) matchScores[c.id] = cosineSimilarity(embedding, vec);
    }
    return { candidates, matchScores };
  } catch (e: any) {
    console.error('[searchIconCandidatesAction] failed:', e);
    return { candidates: [], matchScores: {}, error: e.message };
  }
}

export async function getUnvettedRecipesAction(limit: number = 20) {
    const session = await getAuthService().verifyAuth();
    if (!session?.isAdmin) return { error: 'Admin required' };

    try {
        const recipes = await getDataService().getUnvettedRecipes(limit);
        return { recipes };
    } catch (e: any) {
        return { error: e.message };
    }
}