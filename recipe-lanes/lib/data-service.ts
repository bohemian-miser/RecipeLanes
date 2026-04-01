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

import { db, storage, isFirebaseEnabled } from './firebase-admin';
import { memoryStore, IconData, IngredientData } from './store';
import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import type { RecipeGraph, IconStats, ShortlistEntry } from './recipe-lanes/types';
import { DB_COLLECTION_INGREDIENTS, DB_COLLECTION_ICON_INDEX, DB_COLLECTION_QUEUE, DB_COLLECTION_RECIPES } from './config';
import { standardizeIngredientName, removeUndefined, calculateWilsonLCB } from './utils';
import { applyIconToNode, buildShortlistEntry, clearNodeIcon, getEntryIcon, getNodeIconId, getNodeIconUrl, hasNodeIcon, prependToShortlist } from './recipe-lanes/model-utils';

export interface DataService {
  getIngredientByName(name: string): Promise<{ id: string; data: any } | null>;
  createIngredient(name: string): Promise<string>;
  
  getIconsForIngredient(ingredientId: string): Promise<any[]>;
  getAllIcons(): Promise<any[]>;
  
  uploadIcon(
      ingredientName: string, 
      buffer: ArrayBuffer | Buffer, 
      metadata: any
  ): Promise<{ url: string, path: string, iconId: string }>;

  publishIcon(
      ingredientId: string, 
      ingredientName: string, 
      iconData: any,
      transaction?: any
  ): Promise<IconStats>;

  
  saveRecipe(graph: RecipeGraph, existingId?: string, userId?: string, visibility?: 'private' | 'unlisted' | 'public', ownerName?: string): Promise<string>;
  getRecipe(id: string): Promise<{ graph: RecipeGraph, ownerId?: string, ownerName?: string, visibility?: string, stats?: any } | null>;

  voteRecipe(recipeId: string, userId: string, vote: 'like' | 'dislike' | 'none'): Promise<void>;
  toggleStar(recipeId: string, userId: string): Promise<boolean>;
  copyRecipe(recipeId: string, userId: string): Promise<string>;
  deleteRecipe(recipeId: string, userId: string): Promise<void>;

  searchPublicRecipes(query: string): Promise<any[]>;
  getUserRecipes(userId: string): Promise<any[]>;
  getStarredRecipes(userId: string): Promise<any[]>;
  getPublicRecipes(limit: number): Promise<any[]>;

  recordRejection(iconId: string, ingredientName: string, ingredientId: string): Promise<void>;
  recordImpression(ingredientId: string, iconId: string): Promise<void>;

  deleteIcon(iconId: string, ingredientName?: string): Promise<void>;
  
  listDebugFiles(): Promise<any[]>;
  checkExistingCopies(originalId: string, userId: string): Promise<any[]>;
  getPagedIcons(page: number, limit: number, query?: string): Promise<{ icons: any[], total: number }>;
  retryIconGeneration(ingredientName: string): Promise<void>;
  queueIcons(items: { ingredientName: string, recipeId?: string, rejectedIds?: string[] }[]): Promise<Map<string, IconStats>>;
  waitForQueue(ingredientName: string, timeoutMs?: number): Promise<IconStats | null>;
  
  // New Methods for Refactor
  resolveRecipeIcons(recipeId: string, embedFn?: (texts: string[]) => Promise<number[]>): Promise<void>;
  addNodeToRecipe(recipeId: string, ingredientName: string, laneId?: string, hydeQueries?: string[]): Promise<{ success: boolean, nodeId?: string, error?: string }>;
  rejectRecipeIcon(recipeId: string, ingredientName: string, currentIconId?: string, userId?: string, embedFn?: (texts: string[]) => Promise<number[]>): Promise<{ success: boolean, error?: string }>;
  imagineRecipeWithIcon(recipeId: string, ingredientName: string, icon: IconStats, transaction?: any): Promise<any>;
  setRecipeWithIcon(data: any, transaction?: any): Promise<void>;
  assignIconToRecipe(recipeId: string, ingredientName: string, icon: IconStats, transaction?: any): Promise<void>;
  
  imagineIngredientWithIcon(ingredientId: string, ingredientName: string, iconData: any, transaction?: any): Promise<any>;
  setIngredientWithIcon(data: any, transaction?: any): Promise<void>;
  
  submitFeedback(data: { message: string, url: string, email?: string, graphJson?: string, userId?: string }): Promise<void>;
  
  vetRecipe(recipeId: string, isVetted: boolean): Promise<void>;
  getUnvettedRecipes(limit: number): Promise<any[]>;
  
  failRecipeIcon(recipeId: string, ingredientName: string, errorMsg: string): Promise<void>;

  searchIconsByEmbedding(queryVec: number[], limit: number): Promise<IconStats[]>;
  writeIconToIndex(iconId: string, ingredientName: string, url: string, embedding: number[]): Promise<void>;
}

// --- Firebase Implementation ---
export class FirebaseDataService implements DataService {
  _db = db; // allows test patching

  async searchIconsByEmbedding(queryVec: number[], limit: number): Promise<IconStats[]> {
    const snap = await this._db.collection('icon_index')
      .findNearest('embedding', FieldValue.vector(queryVec), { limit, distanceMeasure: 'COSINE' as const })
      .get();
    console.log(`[searchIconsByEmbedding] findNearest returned ${snap.docs.length} docs`);
    return snap.docs.map((doc: any) => {
      const d = doc.data();
      return { id: d.icon_id, url: d.url, prompt: d.ingredient_name } as IconStats;
    });
  }

  async writeIconToIndex(iconId: string, ingredientName: string, url: string, embedding: number[]): Promise<void> {
    await db.collection(DB_COLLECTION_ICON_INDEX).doc(iconId).set({
      icon_id: iconId,
      ingredient_name: ingredientName,
      url,
      embedding: FieldValue.vector(embedding),
      created_at: FieldValue.serverTimestamp()
    });
    console.log(`[writeIconToIndex] wrote ${iconId} (${ingredientName}), dim=${embedding.length}`);
  }

  async vetRecipe(recipeId: string, isVetted: boolean): Promise<void> {
      await db.collection(DB_COLLECTION_RECIPES).doc(recipeId).update({
          isVetted: isVetted
      });
  }
  
  async getUnvettedRecipes(limit: number): Promise<any[]> {
      const snapshot = await db.collection(DB_COLLECTION_RECIPES)
          .where('visibility', '==', 'public')
          .where('isVetted', '==', false) // Note: Need index or handle missing field
          .orderBy('created_at', 'desc')
          .limit(limit)
          .get();
      return this.mapRecipes(snapshot);
  }

  async submitFeedback(data: { message: string, url: string, email?: string, graphJson?: string, userId?: string }): Promise<void> {
      try {
          // Use DB_COLLECTION_FEEDBACK if imported, else string literal 'feedback'
          // Since I updated config.ts but not the import in this file yet (wait, I should check imports)
          // I'll rely on the literal or add the import if needed.
          // Let's use 'feedback' string literal here or assume config updated.
          // Wait, I updated config.ts, but I need to import it.
          // Actually, let's just use 'feedback' string to be safe/quick or update import.
          // I'll update the import in a separate step or just use 'feedback'.
          await db.collection('feedback').add({
              ...data,
              created_at: FieldValue.serverTimestamp()
          });
      } catch (e: any) {
          console.error("Failed to submit feedback:", e);
          throw new Error("Failed to save feedback");
      }
  }

  async imagineRecipeWithIcon(recipeId: string, ingredientName: string, icon: IconStats, transaction?: any) {
      const stdName = standardizeIngredientName(ingredientName);
      const recipeRef = db.collection(DB_COLLECTION_RECIPES).doc(recipeId);
      const ingRef = db.collection(DB_COLLECTION_INGREDIENTS).doc(stdName);

      let recipeDoc, ingDoc;
      if (transaction) {
          [recipeDoc, ingDoc] = await transaction.getAll(recipeRef, ingRef);
      } else {
          [recipeDoc, ingDoc] = await db.getAll(recipeRef, ingRef);
      }
      
      if (!recipeDoc.exists) throw new Error("Recipe not found");
      const recipeData = recipeDoc.data();
      const nodes = recipeData?.graph?.nodes || [];
      
      let recipeChanged = false;
      let ingredientChanged = false;
      let icons = [];

      const generatedEntry: ShortlistEntry = buildShortlistEntry(icon, 'generated');
      nodes.forEach((n: any) => {
          if (n.visualDescription) {
              const nName = standardizeIngredientName(String(n.visualDescription));
              if (nName === stdName) {
                  applyIconToNode(n, icon);
                  // Prepend generated icon to shortlist (no cap)
                  const existingShortlist: ShortlistEntry[] = n.iconShortlist || [];
                  n.iconShortlist = prependToShortlist(existingShortlist, generatedEntry);
                  n.shortlistIndex = 0;
                  recipeChanged = true;
              }
          }
      });
      
      if (recipeChanged) {
          // Update Impressions (Once per recipe update)
          if (ingDoc.exists) {
              icons = ingDoc.data()?.icons || [];
              const iconIndex = icons.findIndex((i: any) => i.id === icon.id);
              
              if (iconIndex !== -1) {
                  icons[iconIndex].impressions = (icons[iconIndex].impressions || 0) + 1;
                  const n = icons[iconIndex].impressions;
                  const r = icons[iconIndex].rejections || 0;
                  icons[iconIndex].score = calculateWilsonLCB(n, r);
                  icons.sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
                  
                  ingredientChanged = true;
              }
          }
      }

      return { recipeRef, ingRef, nodes, icons, recipeChanged, ingredientChanged };
  }

  async setRecipeWithIcon(data: any, transaction?: any): Promise<void> {
      const { recipeRef, ingRef, nodes, icons, recipeChanged, ingredientChanged } = data;
      
      if (transaction) {
          if (recipeChanged) transaction.update(recipeRef, { "graph.nodes": nodes });
          if (ingredientChanged) transaction.update(ingRef, { icons });
      } else {
          const batch = db.batch();
          if (recipeChanged) batch.update(recipeRef, { "graph.nodes": nodes });
          if (ingredientChanged) batch.update(ingRef, { icons });
          await batch.commit();
      }
  }

  async assignIconToRecipe(recipeId: string, ingredientName: string, icon: IconStats, transaction?: any): Promise<void> {
      const operation = async (t: any) => {
          const data = await this.imagineRecipeWithIcon(recipeId, ingredientName, icon, t);
          await this.setRecipeWithIcon(data, t);
      };

      if (transaction) {
          await operation(transaction);
      } else {
          await db.runTransaction(operation);
      }
  }

  // TEST ONLY.
  async waitForQueue(ingredientName: string, timeoutMs: number = 15000): Promise<IconStats | null> {

      const stdName = standardizeIngredientName(ingredientName);
      const docRef = db.collection(DB_COLLECTION_QUEUE).doc(stdName);
      
      const start = Date.now();
      
      while (Date.now() - start < timeoutMs) {
          const snap = await docRef.get();
          
          // 1. Check Queue Status
          if (snap.exists) {
              const data = snap.data();
              // Legacy support: if 'completed' status still used
              if (data?.status === 'completed' && data.id && data.url) {
                  return { id: data.id, url: data.url };
              }
              if (data?.status === 'failed') {
                  throw new Error(data.error || 'Generation failed');
              }
              // If pending/processing, keep waiting
          } else {
              console.log(`[FIREBASEDATASERVICE] WAITFORQUEUE: NO QUEUE DOCUMENT FOR "${stdName}", CHECKING INGREDIENTS...`);
              // 2. Queue item missing? It might be completed and deleted.
              // Check the Ingredients collection.
              const ingDoc = await db.collection(DB_COLLECTION_INGREDIENTS).doc(stdName).get();
              if (ingDoc.exists) {
                  const data = ingDoc.data();
                  if (data && data.icons && Array.isArray(data.icons) && data.icons.length > 0) {
                      // Return the newest/best icon
                      // Assuming icons are sorted or we take first
                      // DataService.saveIcon sorts by score, so first is best
                      const best = data.icons[0]; 
                      return { id: best.id, url: best.url };
                  }
              }
              // If neither queue nor ingredient exists, it might not be queued yet or deleted entirely.
              // We continue waiting until timeout in case it's about to be created.
          }
          
          await new Promise(r => setTimeout(r, 1000));
      }
      return null;
  }
        
    /**
     * Helper to determine if a single node requires icon processing.
     */
    private nodeNeedsProcessing(node: any): boolean {
        if (!node.visualDescription) return false;
        if (!node.icon || !node.icon.id) return true;
        return false;
    }

    /**
     * Merges new hydeQueries into the searchTerms of an icon stored inside the ingredient doc's icons[] array.
     * Skips any text already present. Writes the full updated icons[] array back.
     */
    private async mergeSearchTermsIntoIcon(stdName: string, iconId: string, hydeQueries: string[]): Promise<void> {
        const docRef = db.collection(DB_COLLECTION_INGREDIENTS).doc(stdName);
        await db.runTransaction(async (t) => {
            const doc = await t.get(docRef);
            if (!doc.exists) return;
            const icons: any[] = doc.data()?.icons || [];
            const idx = icons.findIndex((i: any) => i.id === iconId);
            if (idx === -1) return;

            const icon = icons[idx];
            const existingTexts = new Set<string>((icon.searchTerms || []).map((st: any) => st.text));
            const newTerms = hydeQueries
                .filter(q => !existingTexts.has(q))
                .map(q => ({ text: q, source: 'hyde_from_img' as const, addedAt: Date.now() }));

            if (newTerms.length === 0) return;

            icons[idx] = { ...icon, searchTerms: [...(icon.searchTerms || []), ...newTerms] };
            t.update(docRef, { icons });
        });
    }
        /**
     * Safely adds an ingredient to the queue via a transaction.
     */
    private async queueIconForGeneration(recipeId: string, stdName: string, hydeQueries?: string[]): Promise<void> {
        const recipeRef = db.collection(DB_COLLECTION_RECIPES).doc(recipeId);
        const queueRef = db.collection(DB_COLLECTION_QUEUE).doc(stdName);

        const shouldEnqueue = await db.runTransaction(async (transaction) => {
            let doEnqueue = false;
            const [recipeDoc, queueDoc] = await transaction.getAll(recipeRef, queueRef);

            if (!recipeDoc.exists) {
                console.log(`THIS SHOULD NOT HAPPEN or if it does we should be fine? - [Transaction] Recipe ${recipeId} not found. Exiting.`);
                return; // Recipe deleted mid-process
            }

            // 1. "Check again": Validate if this node still needs processing
            const recipeData = recipeDoc.data();
            const freshNode = recipeData?.graph?.nodes?.find(
                (n: any) => standardizeIngredientName(n.visualDescription) === stdName
            );

            if (!freshNode || !this.nodeNeedsProcessing(freshNode)) {
                console.log(`[Transaction] "${stdName}" no longer needs processing. Exiting.`);
                return;
            }

            // 2. Handle Queue Document Creation / Updating
            if (!queueDoc.exists) {
                // Create new pending entry
                const newQueueDoc: any = {
                    status: 'pending',
                    created_at: FieldValue.serverTimestamp(),
                    recipes: [recipeId],
                    recipeCount: 1
                };
                if (hydeQueries && hydeQueries.length > 0) {
                    newQueueDoc.hydeQueries = hydeQueries;
                }
                transaction.set(queueRef, newQueueDoc);
                doEnqueue = true;
                console.log(`[Transaction] Created new queue entry for "${stdName}"`);
            } else {
                // Update existing entry
                // TODO: handle failed icon.
                const existingData = queueDoc.data();
                const existingRecipes = existingData?.recipes || [];

                const updatePayload: any = {};
                if (!existingRecipes.includes(recipeId)) {
                    updatePayload.recipes = FieldValue.arrayUnion(recipeId);
                    updatePayload.recipeCount = FieldValue.increment(1);
                    console.log(`[Transaction] Added recipe ${recipeId} to existing queue for "${stdName}"`);
                }
                if (hydeQueries && hydeQueries.length > 0) {
                    updatePayload.hydeQueries = FieldValue.arrayUnion(...hydeQueries);
                }
                if (Object.keys(updatePayload).length > 0) {
                    transaction.update(queueRef, updatePayload);
                }
            }

            // 3. Mark Node as Pending in Recipe (Optimistic UI)
            // recipeData is already defined above
            const nodes = recipeData?.graph?.nodes || [];
            let changed = false;
            nodes.forEach((n: any) => {
                 if (n.visualDescription && standardizeIngredientName(n.visualDescription) === stdName) {
                     // Only update if not already set to avoid unnecessary writes? 
                     // Or just force it to pending/processing if it was failed/missing.
                     if (n.icon?.status !== 'pending' && n.icon?.status !== 'processing') {
                         n.icon = {
                             ...(n.icon || {}),
                             status: 'pending'
                         };
                         changed = true;
                     }
                 }
            });
            
            if (changed) {
                transaction.update(recipeRef, { "graph.nodes": nodes });
            }
            
            return doEnqueue;
        });

        if (shouldEnqueue) {
            try {
                const { getFunctions } = require('firebase-admin/functions');
                const queue = getFunctions().taskQueue('processIconTask');
                await queue.enqueue({ ingredientName: stdName });
                console.log(`[queueIconForGeneration] 🚀 Enqueued task for "${stdName}"`);
            } catch (error) {
                console.error(`[queueIconForGeneration] 💥 Failed to enqueue task for "${stdName}":`, error);
                // Revert to failed state to avoid "Stuck pending" if enqueue fails
                await queueRef.set({ status: 'failed', error: 'System Enqueue Error' }, { merge: true });
            }
        }
    }

    async retryIconGeneration(ingredientName: string): Promise<void> {
        try {
            const stdName = standardizeIngredientName(ingredientName);
            const queueRef = db.collection(DB_COLLECTION_QUEUE).doc(stdName);
            
            await queueRef.set({
                status: 'pending',
                error: FieldValue.delete(),
                created_at: FieldValue.serverTimestamp()
            }, { merge: true });

            // Always enqueue on retry
            const { getFunctions } = require('firebase-admin/functions');
            const queue = getFunctions().taskQueue('processIconTask');
            await queue.enqueue({ ingredientName: stdName });
            console.log(`[retryIconGeneration] 🚀 Re-enqueued task for "${stdName}"`);

        } catch (e: any) {
            console.warn('retryIconGeneration failed:', e.message);
            throw e;
        }
    }

    async failRecipeIcon(recipeId: string, ingredientName: string, errorMsg: string): Promise<void> {
        const stdName = standardizeIngredientName(ingredientName);
        const recipeRef = db.collection(DB_COLLECTION_RECIPES).doc(recipeId);

        await db.runTransaction(async (t) => {
            const doc = await t.get(recipeRef);
            if (!doc.exists) return;
            
            const data = doc.data();
            const nodes = data?.graph?.nodes || [];
            let changed = false;

            nodes.forEach((n: any) => {
                if (n.visualDescription) {
                     const nName = standardizeIngredientName(String(n.visualDescription));
                     if (nName === stdName) {
                         // Preserve existing icon data if any, but mark as failed
                         n.icon = {
                             ...(n.icon || {}),
                             status: 'failed',
                             // error: errorMsg // valid to add if we add to type
                         };
                         changed = true;
                     }
                }
            });

            if (changed) {
                t.update(recipeRef, { "graph.nodes": nodes });
            } //for the diff. pls remove.
        });
    }

    /**
     * Search icon_index for matches and assign icon + shortlist to matching recipe nodes.
     * Returns names that had no search results (still need generation).
     */
    private async resolveFromIndex(
        recipeId: string,
        unresolvedNames: string[],
        hydeQueriesMap: Map<string, string[]>,
        embedFn: (texts: string[]) => Promise<number[]>
    ): Promise<string[]> {
        const stillUnresolved: string[] = [];
        for (const stdName of unresolvedNames) {
            try {
                const queries = hydeQueriesMap.get(stdName);
                const textsToEmbed = queries && queries.length > 0 ? queries : [stdName];
                const vec = await embedFn(textsToEmbed);
                const results = await this.searchIconsByEmbedding(vec, 12);
                if (results.length > 0) {
                    await this.assignShortlistToRecipe(recipeId, stdName, results.slice(0, 8));
                    console.log(`[resolveFromIndex] "${stdName}" → ${results.length} candidates`);
                } else {
                    stillUnresolved.push(stdName);
                }
            } catch (e) {
                console.warn(`[resolveFromIndex] search failed for "${stdName}":`, e);
                stillUnresolved.push(stdName);
            }
        }
        return stillUnresolved;
    }

    /**
     * Writes the first search result as the node's icon and the full results as its shortlist.
     */
    private async assignShortlistToRecipe(recipeId: string, stdName: string, results: IconStats[]): Promise<void> {
        const recipeRef = db.collection(DB_COLLECTION_RECIPES).doc(recipeId);
        // Wrap each search result in a ShortlistEntry
        const shortlistEntries: ShortlistEntry[] = results.map(r => buildShortlistEntry(r, 'search'));
        await db.runTransaction(async (t) => {
            const doc = await t.get(recipeRef);
            if (!doc.exists) return;
            const nodes: any[] = doc.data()?.graph?.nodes || [];
            let changed = false;
            nodes.forEach((n: any) => {
                if (n.visualDescription && standardizeIngredientName(String(n.visualDescription)) === stdName) {
                    applyIconToNode(n, getEntryIcon(shortlistEntries[0]));
                    n.iconShortlist = shortlistEntries;
                    n.shortlistIndex = 0;
                    changed = true;
                }
            });
            if (changed) t.update(recipeRef, { 'graph.nodes': nodes });
        });
    }

    async resolveRecipeIcons(recipeId: string, embedFn?: (texts: string[]) => Promise<number[]>): Promise<void> {
        console.log(`[FirebaseDataService] resolveRecipeIcons: ${recipeId}`);
        const recipeRef = db.collection(DB_COLLECTION_RECIPES).doc(recipeId);
        const doc = await recipeRef.get();

        if (!doc.exists) {
            console.error(`Recipe ${recipeId} not found.`);
            return;
        }

        const data = doc.data();
        if (!data?.graph || !Array.isArray(data.graph.nodes)) return;

        // 1. Initial check: Filter nodes that need processing
        const nodesToProcess = data.graph.nodes.filter((n: any) =>
            this.nodeNeedsProcessing(n)
        );

        if (nodesToProcess.length === 0) return;
        console.log(`Processing ${nodesToProcess.length} nodes for recipe ${recipeId}`);

        // Build merged hydeQueries map: stdName -> string[]
        const hydeQueriesMap = new Map<string, string[]>();
        for (const node of nodesToProcess) {
            if (!node.visualDescription) continue;
            const stdName = standardizeIngredientName(String(node.visualDescription));
            const nodeQueries: string[] = node.hydeQueries || [];
            const existing = hydeQueriesMap.get(stdName) || [];
            const merged = Array.from(new Set([...existing, ...nodeQueries]));
            hydeQueriesMap.set(stdName, merged);
        }

        // Collect unresolved names (all nodes without icons go directly to index search + generation)
        const unresolvedNames = Array.from(hydeQueriesMap.keys());

        // 2. Try to resolve from index via embedding search (optimistic: show shortlist immediately)
        if (embedFn) {
            await this.resolveFromIndex(recipeId, unresolvedNames, hydeQueriesMap, embedFn);
        }

        // 3. Queue ALL unresolved ingredients for generation regardless of index results.
        // resolveFromIndex provides an optimistic shortlist, but we still need a canonical
        // generated icon stored in ingredients_new for gallery display and stats tracking.
        console.log(`Queueing ${unresolvedNames.length} ingredients for generation...`);
        await Promise.all(unresolvedNames.map(stdName =>
            this.queueIconForGeneration(recipeId, stdName, hydeQueriesMap.get(stdName))
        ));
    }

  async addNodeToRecipe(recipeId: string, ingredientName: string, laneId: string = 'lane-1', hydeQueries?: string[]): Promise<{ success: boolean, nodeId?: string, error?: string }> {
      try {
        const stdName = standardizeIngredientName(ingredientName);
        const nodeId = 'node-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

        const recipeRef = db.collection(DB_COLLECTION_RECIPES).doc(recipeId);

        await db.runTransaction(async (t) => {
             const doc = await t.get(recipeRef);
             if (!doc.exists) throw new Error("Recipe not found");
             const data = doc.data();
             const graph = data?.graph;

             const newNode: any = {
                id: nodeId,
                laneId: laneId,
                text: stdName,
                visualDescription: stdName,
                type: 'ingredient',
                x: 0, y: 0
            };
            if (hydeQueries && hydeQueries.length > 0) {
                newNode.hydeQueries = hydeQueries;
            }

            const newNodes = [...(graph.nodes || []), newNode];
            t.update(recipeRef, { "graph.nodes": newNodes });
        });
        
        await this.resolveRecipeIcons(recipeId);
        
        return { success: true, nodeId };
      } catch (e: any) {
          return { success: false, error: e.message };
      }
  }

  async rejectRecipeIcon(recipeId: string, ingredientName: string, currentIconId?: string, userId?: string, embedFn?: (texts: string[]) => Promise<number[]>): Promise<{ success: boolean, error?: string }> {
      try {
        const recipeRef = db.collection(DB_COLLECTION_RECIPES).doc(recipeId);
        let iconIdToReject = currentIconId;

        await db.runTransaction(async (t) => {
            const doc = await t.get(recipeRef);
            if (!doc.exists) throw new Error('Recipe not found');
            
            const data = doc.data()!;

            // Ownership check
            if (data.ownerId && data.ownerId !== userId) {
                // TODO: UI should pop up a message "save a copy to reroll"
                throw new Error("Unauthorized: Save a copy to reroll icons in this recipe.");
            }

            const graph = data.graph;
            const nodes = graph.nodes || [];

            const stdName = standardizeIngredientName(String(ingredientName));

            // Clear ALL nodes matching this ingredient
            nodes.forEach((n: any) => {
                if (n.visualDescription && standardizeIngredientName(n.visualDescription) === stdName) {
                    clearNodeIcon(n);
                }
            });

            t.update(recipeRef, {
                "graph.nodes": nodes
            });
        });

        if (iconIdToReject) {
            const stdName = standardizeIngredientName(ingredientName);
            // Best effort
            this.recordRejection(iconIdToReject, ingredientName, stdName).catch(console.error);
        }

        await this.resolveRecipeIcons(recipeId, embedFn);
        return { success: true };
      } catch (e: any) {
          return { success: false, error: e.message };
      }
  }

    // I don't think this should work bc it'll be a write not create..
    // aaand it doesn't work...
    // Removed duplicate retryIconGeneration

  async getPagedIcons(page: number, limit: number, query?: string): Promise<{ icons: any[], total: number }> {
      try {
          // Pagination Strategy: Page through INGREDIENTS, not icons.
          // Page 1 = Ingredients 1-50. We return ALL icons in those ingredients.
          // This ensures full coverage of the DB.
          
          const INGREDIENTS_PER_PAGE = 50;
          const offset = (page - 1) * INGREDIENTS_PER_PAGE;

          let q: FirebaseFirestore.Query = db.collection(DB_COLLECTION_INGREDIENTS)
              .orderBy('updated_at', 'desc');
          
          if (!query) {
              q = q.offset(offset).limit(INGREDIENTS_PER_PAGE);
          } else {
              // Search is still limited to recent/scan for now
              q = q.limit(1000); 
          }

          const snapshot = await q.get();
          let allIcons: any[] = [];
          
          snapshot.forEach(doc => {
              const data = doc.data();
              if (data.icons && Array.isArray(data.icons)) {
                  const safeIcons = data.icons.map((icon: any) => ({
                      ...icon,
                      // Ensure created_at is serialized
                      created_at: icon.created_at?.toDate ? icon.created_at.toDate().toISOString() : (icon.created_at || null)
                  }));
                  allIcons.push(...safeIcons);
              }
          });

          // Sort by creation time within this batch
          allIcons.sort((a, b) => {
              const tA = new Date(a.created_at).getTime();
              const tB = new Date(b.created_at).getTime();
              return tB - tA;
          });

          if (query && query.trim()) {
              const term = query.toLowerCase().trim();
              allIcons = allIcons.filter((i: any) => 
                  i.visualDescription?.toLowerCase().includes(term) || 
                  i.ingredient?.toLowerCase().includes(term)
              );
              // For search, we handle manual pagination if needed, or just return all hits
          }

          // Approximation for total: We don't know total icons without scanning all.
          // We return a high number to keep "Next" button enabled if we found results.
          // If current batch is empty, we assume end.
          const totalEstimate = allIcons.length > 0 ? (page * limit) + allIcons.length : (page - 1) * limit;

          return { icons: allIcons, total: totalEstimate };
      } catch (e: any) {
          console.warn('getPagedIcons failed:', e.message);
          return { icons: [], total: 0 };
      }
  }

  async checkExistingCopies(originalId: string, userId: string): Promise<any[]> {
      try {
          const snapshot = await db.collection(DB_COLLECTION_RECIPES)
              .where('ownerId', '==', userId)
              .where('sourceId', '==', originalId)
              .orderBy('created_at', 'desc')
              .get();
          return this.mapRecipes(snapshot);
      } catch (e: any) {
          console.warn('checkExistingCopies failed:', e.message);
          return [];
      }
  }

  async getPublicRecipes(limit: number = 50): Promise<any[]> {
      try {
          const snapshot = await db.collection(DB_COLLECTION_RECIPES)
              .where('visibility', '==', 'public')
              .where('isVetted', '==', true)
              .orderBy('created_at', 'desc')
              .limit(limit)
              .get();
          return this.mapRecipes(snapshot);
      } catch (e: any) {
          console.warn('getPublicRecipes failed:', e.message);
          return [];
      }
  }

  async searchPublicRecipes(query: string): Promise<any[]> {
      const term = query.toLowerCase();
      try {
          const snapshot = await db.collection(DB_COLLECTION_RECIPES)
              .where('visibility', '==', 'public')
              .where('isVetted', '==', true)
              .orderBy('created_at', 'desc')
              .limit(100)
              .get();
          
          return snapshot.docs
            .filter(doc => {
                const data = doc.data();
                const title = (data.title || data.graph?.title || '').toLowerCase();
                const content = (data.graph?.originalText || '').toLowerCase();
                const nodes = data.graph?.nodes || [];
                const nodeText = nodes.some((n: any) => n.text?.toLowerCase().includes(term) || n.visualDescription?.toLowerCase().includes(term));
                
                return title.includes(term) || content.includes(term) || nodeText;
            })
            .map(doc => this.mapRecipeDoc(doc));
      } catch (e: any) {
          console.error('[DataService] Search failed:', e);
          return [];
      }
  }

  async getUserRecipes(userId: string): Promise<any[]> {
      const snapshot = await db.collection(DB_COLLECTION_RECIPES)
          .where('ownerId', '==', userId)
          .orderBy('created_at', 'desc')
          .get();
      return this.mapRecipes(snapshot);
  }

  async getStarredRecipes(userId: string): Promise<any[]> {
      const starSnap = await db.collection('users').doc(userId).collection('stars').get();
      if (starSnap.empty) return [];
      
      const ids = starSnap.docs.map(d => d.id);
      const recipes = [];
      for (const id of ids) {
          const doc = await db.collection(DB_COLLECTION_RECIPES).doc(id).get();
          if (doc.exists) {
              recipes.push(this.mapRecipeDoc(doc));
          }
      }
      return recipes;
  }

  async saveRecipe(graph: RecipeGraph, existingId?: string, userId?: string, visibility: 'private' | 'unlisted' | 'public' = 'unlisted', ownerName?: string): Promise<string> {
      const data: any = {
          graph, // TODO add last_updated to graph.
          updated_at: FieldValue.serverTimestamp()
      };
      
      if (userId) data.ownerId = userId;
      if (ownerName) data.ownerName = ownerName;
      if (visibility) data.visibility = visibility;
      
      // Ensure title is synced both at top level and inside graph
      if (graph.title) {
          data.title = graph.title;
      } else if (data.title) {
          graph.title = data.title;
      }

      if (graph.sourceId) data.sourceId = graph.sourceId;

      if (existingId) {
          const existingDoc = await db.collection(DB_COLLECTION_RECIPES).doc(existingId).get();
          if (existingDoc.exists) {
              const existingData = existingDoc.data();
              // TODO: Consider just saving under a new ID if not owner?
              if (existingData?.ownerId && existingData.ownerId !== userId) {
                  throw new Error("You are not the owner of this recipe.");
              }
          }
          // Maybe allow a non-merging option?
          await db.collection(DB_COLLECTION_RECIPES).doc(existingId).set(removeUndefined(data), { merge: true });
          return existingId;
      }

      data.created_at = FieldValue.serverTimestamp();
      data.likes = 0;
      data.dislikes = 0;
      data.isVetted = false;
      
      const doc = await db.collection(DB_COLLECTION_RECIPES).add(removeUndefined(data));
      return doc.id;
  }

    async getRecipe(id: string) {
        const doc = await db.collection(DB_COLLECTION_RECIPES).doc(id).get();
        if (!doc.exists) return null;
        const data = doc.data()!;
        const graph = data.graph as RecipeGraph;
        if (data.visibility) graph.visibility = data.visibility as any; 
        
        // Ensure title is bridged
        if (data.title && !graph.title) graph.title = data.title;
        if (graph.title && !data.title) data.title = graph.title;
  
        let ownerName = data.ownerName;
        
        // Fallback: Fetch from user profile if not cached on recipe
        if (!ownerName && data.ownerId) {
            try {
                const userSnap = await db.collection('users').doc(data.ownerId).get();
                if (userSnap.exists) {
                    const userData = userSnap.data();
                    ownerName = userData?.name || userData?.displayName;
                }
            } catch (e) { /* Ignore fetch error */ }
        }

        return { 
            graph, 
            ownerId: data.ownerId, 
            ownerName,
            visibility: data.visibility, 
            stats: { likes: data.likes || 0, dislikes: data.dislikes || 0 }
        };
    }
  async voteRecipe(recipeId: string, userId: string, vote: 'like' | 'dislike' | 'none') {
      const userRef = db.collection('users').doc(userId);
      const recipeRef = db.collection(DB_COLLECTION_RECIPES).doc(recipeId);
      
      await db.runTransaction(async (t) => {
          const userDoc = await t.get(userRef);
          const userData = userDoc.data() || {};
          const currentLikes = new Set(userData.likedRecipes || []);
          const currentDislikes = new Set(userData.dislikedRecipes || []);
          // TODO: i don't like the logic here but it works... i think ..
          let likeChange = 0;
          let dislikeChange = 0;
          
          if (currentLikes.has(recipeId)) {
              currentLikes.delete(recipeId);
              likeChange = -1;
          }
          if (currentDislikes.has(recipeId)) {
              currentDislikes.delete(recipeId);
              dislikeChange = -1;
          }
          
          if (vote === 'like') {
              currentLikes.add(recipeId);
              likeChange += 1;
          } else if (vote === 'dislike') {
              currentDislikes.add(recipeId);
              dislikeChange += 1;
          }
          
          t.set(userRef, { 
              likedRecipes: Array.from(currentLikes),
              dislikedRecipes: Array.from(currentDislikes)
          }, { merge: true });
          
          t.update(recipeRef, {
              likes: FieldValue.increment(likeChange),
              dislikes: FieldValue.increment(dislikeChange)
          });
      });
  }

  async toggleStar(recipeId: string, userId: string): Promise<boolean> {
      const starRef = db.collection('users').doc(userId).collection('stars').doc(recipeId);
      const doc = await starRef.get();
      if (doc.exists) {
          await starRef.delete();
          return false;
      } else {
          await starRef.set({ created_at: FieldValue.serverTimestamp() });
          return true;
      }
  }

  async copyRecipe(recipeId: string, userId: string): Promise<string> {
      const source = await this.getRecipe(recipeId);
      if (!source) throw new Error("Recipe not found");
      
      const newGraph = JSON.parse(JSON.stringify(source.graph));
      if (newGraph.title) newGraph.title = `${newGraph.title} (Copy)`;
      
      return this.saveRecipe(newGraph, undefined, userId, 'unlisted');
  }

  async deleteRecipe(recipeId: string, userId: string): Promise<void> {
      const docRef = db.collection(DB_COLLECTION_RECIPES).doc(recipeId);
      const doc = await docRef.get();
      if (!doc.exists) throw new Error("Recipe not found");
      const data = doc.data();
      if (data?.ownerId !== userId) throw new Error("Unauthorized");
      await docRef.delete();
  }

  private mapRecipes(snapshot: FirebaseFirestore.QuerySnapshot) {
      return snapshot.docs.map(doc => this.mapRecipeDoc(doc));
  }
  
  private mapRecipeDoc(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot) {
      const data = doc.data()!;
      let title = data.title || 'Untitled Recipe';
      
      if (!data.title) {
          if (data.graph?.title) title = data.graph.title;
          else if (data.graph?.originalText) {
              title = data.graph.originalText.split('\n')[0].trim().substring(0, 50);
          } else if (data.graph?.nodes?.length > 0) {
              title = data.graph.nodes[0].text || 'Recipe';
          }
      }

      return {
          id: doc.id,
          title,
          createdAt: data.created_at?.toDate?.()?.toISOString() || null,
          nodeCount: data.graph?.nodes?.length || 0,
          previewIcon: (data.graph?.nodes || []).map(getNodeIconUrl).findLast((u: string | undefined) => !!u),
          ownerId: data.ownerId,
          ownerName: data.ownerName,
          visibility: data.visibility || 'unlisted',
          isVetted: data.isVetted || false,
          likes: data.likes || 0,
          dislikes: data.dislikes || 0
      };
  }

  async getIngredientByName(name: string) {
    const stdName = standardizeIngredientName(name);
    console.log(`[FirebaseDataService] getIngredientByName: ${stdName}`);
    
    const doc = await db.collection(DB_COLLECTION_INGREDIENTS).doc(stdName).get();
    
    if (doc.exists) {
        return { id: doc.id, data: doc.data() };
    }
    return null;
  }

  async createIngredient(name: string) {
    const stdName = standardizeIngredientName(name);
    const docRef = db.collection(DB_COLLECTION_INGREDIENTS).doc(stdName);
    // Initialize if needed
    await docRef.set({ name: stdName, created_at: FieldValue.serverTimestamp(), icons: [] }, { merge: true });
    return stdName;
  }

  async recordImpression(ingredientId: string, iconId: string) {
      // ingredientId is StdName
      const docRef = db.collection(DB_COLLECTION_INGREDIENTS).doc(ingredientId);
      
      await db.runTransaction(async (t) => {
          const doc = await t.get(docRef);
          if (!doc.exists) return;
          const data = doc.data() || {};
          const icons = data.icons || [];
          
          const index = icons.findIndex((i: any) => i.id === iconId);
          if (index !== -1) {
              const currentImpressions = icons[index].impressions || 0;
              const currentRejections = icons[index].rejections || 0;
              
              icons[index].impressions = currentImpressions + 1;
              icons[index].score = calculateWilsonLCB(icons[index].impressions, currentRejections);
              
              // Keep sorted
              icons.sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
              t.update(docRef, { icons });
          }
      });
  }

  async getIconsForIngredient(ingredientId: string) {
    // ingredientId is StdName
    const doc = await db.collection(DB_COLLECTION_INGREDIENTS).doc(ingredientId).get();
    if (!doc.exists) return [];
    return doc.data()?.icons || [];
  }

  async getAllIcons() {
     try {
         const snapshot = await db.collection(DB_COLLECTION_INGREDIENTS).limit(100).get();
         let all: any[] = [];
         snapshot.forEach(doc => {
             const data = doc.data();
             if (data.icons) all.push(...data.icons);
         });
         return all;
     } catch (e: any) { return []; }
  }

  async uploadIcon(ingredientName: string, buffer: ArrayBuffer | Buffer, metadata: any): Promise<{ url: string, path: string, iconId: string }> {
      const isEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true' || process.env.FUNCTIONS_EMULATOR === 'true';
      
      // Filename: icons/Kebab-ShortID.png
      const iconId = randomUUID();
      const shortId = iconId.substring(0, 8);
      const kebabName = ingredientName.trim().replace(/\s+/g, '-');
      const fileName = `icons/${kebabName}-${shortId}.png`;

      const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'recipe-lanes.firebasestorage.app';
      const bucket = storage.bucket(bucketName);
      const file = bucket.file(fileName);
      const bufferToSave = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as ArrayBuffer);
      
      await file.save(bufferToSave, {
          metadata: { contentType: 'image/png', metadata: { ...metadata, iconId } }
      });
      
      await file.makePublic();
      return { url: file.publicUrl(), path: fileName, iconId };
  }

  async imagineIngredientWithIcon(ingredientId: string, ingredientName: string, iconData: any, transaction?: any): Promise<any> {
      const docRef = db.collection(DB_COLLECTION_INGREDIENTS).doc(ingredientId);
      
      let doc;
      if (transaction) {
          doc = await transaction.get(docRef);
      } else {
          doc = await docRef.get();
      }

      let icons = [];
      let isNew = false;

      if (doc.exists) {
          icons = doc.data()?.icons || [];
      } else {
          isNew = true;
      }
      
      icons.push(iconData);
      icons.sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
      if (icons.length > 50) icons = icons.slice(0, 50);

      return { docRef, icons, isNew, ingredientName };
  }

  async setIngredientWithIcon(data: any, transaction?: any): Promise<void> {
      const { docRef, icons, isNew, ingredientName } = data;
      
      if (transaction) {
          if (isNew) {
              transaction.set(docRef, { 
                  name: ingredientName, 
                  icons,
                  created_at: FieldValue.serverTimestamp(),
                  updated_at: FieldValue.serverTimestamp() 
              });
          } else {
              transaction.update(docRef, { icons, updated_at: FieldValue.serverTimestamp() });
          }
      } else {
          if (isNew) {
              await docRef.set({ 
                  name: ingredientName, 
                  icons,
                  created_at: FieldValue.serverTimestamp(),
                  updated_at: FieldValue.serverTimestamp() 
              });
          } else {
              await docRef.update({ icons, updated_at: FieldValue.serverTimestamp() });
          }
      }
  }

  async publishIcon(ingredientId: string, ingredientName: string, iconData: any, transaction?: any): Promise<IconStats> {
      const operation = async (t: any) => {
          const data = await this.imagineIngredientWithIcon(ingredientId, ingredientName, iconData, t);
          await this.setIngredientWithIcon(data, t);
      };

      if (transaction) {
          await operation(transaction);
      } else {
          await db.runTransaction(operation);
      }

      return { 
          id: iconData.id, 
          url: iconData.url, 
          metadata: iconData.metadata 
      };
  }



  async recordRejection(iconId: string, ingredientName: string, ingredientId: string) {
    const docRef = db.collection(DB_COLLECTION_INGREDIENTS).doc(ingredientId);
    
    await db.runTransaction(async (t) => {
        const doc = await t.get(docRef);
        if (!doc.exists) return;
        const icons = doc.data()?.icons || [];
        
        // Find by ID primarily, fallback to URL/Path for legacy support
        const index = icons.findIndex((i: any) => i.id === iconId || i.url === iconId || i.path === iconId);
        if (index !== -1) {
            const icon = icons[index];
            icon.rejections = (icon.rejections || 0) + 1;
            if (icon.impressions === undefined || icon.impressions < icon.rejections) {
                console.warn(`[recordRejection] MORE REJECTIONS THAN IMPRESSIONS`);
            }
            // Recalculate Score using Wilson LCB
            icon.score = calculateWilsonLCB(icon.impressions, icon.rejections);
            
            icons.sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
            t.update(docRef, { icons });
        }
    });
  }

  async deleteIcon(iconId: string, ingredientName?: string) {
      if (!ingredientName) return; 
      const stdName = standardizeIngredientName(ingredientName);
      const docRef = db.collection(DB_COLLECTION_INGREDIENTS).doc(stdName);
      
      const deletedPath = await db.runTransaction(async (t) => {
          const doc = await t.get(docRef);
          if (!doc.exists) return null;
          const icons = doc.data()?.icons || [];
          const iconToDelete = icons.find((i: any) => i.id === iconId || i.url === iconId || i.path === iconId);
          
          if (iconToDelete) {
              const deletedId = iconToDelete.id;
              const path = iconToDelete.path || iconToDelete.url || null;
              const newIcons = icons.filter((i: any) => i.id !== deletedId);
              t.update(docRef, { icons: newIcons });
              return path;
          }
          return null;
      });
      
      if (typeof deletedPath === 'string' && process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) {
          let path: string = deletedPath;
          if (deletedPath.includes('/o/')) {
              const match = deletedPath.match(new RegExp('/o/([^?]+)'));
              if (match) path = decodeURIComponent(match[1]);
          }
          if (path) {
              const bucket = storage.bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
              await bucket.file(path).delete().catch(() => {});
          }
      }
  }


  async listDebugFiles(): Promise<any[]> {
      const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'recipe-lanes.firebasestorage.app';
      const bucket = storage.bucket(bucketName);
      const [files] = await bucket.getFiles({ prefix: 'icons/', maxResults: 1000 });
      return files.map(file => ({
          name: file.name,
          updated: file.metadata.updated || null,
          contentType: file.metadata.contentType || null,
          size: file.metadata.size || '0',
          popularityScore: file.metadata.metadata?.lcb || '0',
          impressions: file.metadata.metadata?.impressions || '0',
          rejections: file.metadata.metadata?.rejections || '0',
          mediaLink: file.metadata.mediaLink || null,
          publicUrl: `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(file.name)}?alt=media`
      }));
  }

    // queueIcons is test only! It's no longer used.
  async queueIcons(items: { ingredientName: string, recipeId?: string, rejectedIds?: string[] }[]): Promise<Map<string, IconStats>> {
      const immediateHits = new Map<string, IconStats>();
      if (items.length === 0) return immediateHits;
      
      const batch = db.batch();
      let queuedCount = 0;
      
      const uniqueNames = Array.from(new Set(items.map(i => standardizeIngredientName(i.ingredientName))));
      const refs = uniqueNames.map(name => db.collection(DB_COLLECTION_INGREDIENTS).doc(name));
      const snapshots = await db.getAll(...refs);
      
      const cacheMap = new Map<string, any>();
      snapshots.forEach(snap => {
          if (snap.exists) cacheMap.set(snap.id, snap.data());
      });

      const updatesByRecipe = new Map<string, Map<string, { id: string, url?: string, path?: string, metadata?: any }>>();

      for (const item of items) {
          const name = standardizeIngredientName(item.ingredientName);
          const rejected = new Set(item.rejectedIds || []);
          
          let foundIcon: IconStats | null = null;

          const ingData = cacheMap.get(name);
          if (ingData && ingData.icons && Array.isArray(ingData.icons)) {
              for (const icon of ingData.icons) {
                  const isRejected = rejected.has(icon.id) || rejected.has('url:' + icon.url);
                  if (!isRejected) {
                      foundIcon = { 
                          id: icon.id, 
                          url: icon.url || null,
                          score: icon.score,
                          impressions: icon.impressions,
                          rejections: icon.rejections,
                          metadata: icon.metadata
                      };
                      break;
                  }
              }
          }

          if (!foundIcon) {
              const docRef = db.collection(DB_COLLECTION_QUEUE).doc(name);
              const docSnap = await docRef.get();
              const existingData = docSnap.data();

              if (existingData?.status === 'completed' && existingData.id) {
                  if (!rejected.has(existingData.id)) {
                      foundIcon = { id: existingData.id, url: existingData.url || null, metadata: existingData.metadata };
                  }
              }
              
              if (!foundIcon) {
                  const update: any = {
                      created_at: existingData?.created_at || FieldValue.serverTimestamp()
                  };
                  
                  if (item.recipeId) {
                      update.recipes = FieldValue.arrayUnion(item.recipeId);
                      // Best-effort count update (ignoring race conditions for performance)
                      const currentCount = existingData?.recipes?.length || 0;
                      const alreadyHas = existingData?.recipes?.includes(item.recipeId);
                      update.recipeCount = alreadyHas ? currentCount : currentCount + 1;
                  }
                  
                  if (!existingData || existingData.status === 'completed' || existingData.status === 'failed') {
                       update.status = 'pending';
                       update.error = FieldValue.delete();
                  }
                  
                  batch.set(docRef, update, { merge: true });
                  queuedCount++;
              }
          }

          if (foundIcon) {
              immediateHits.set(name, foundIcon);
              if (item.recipeId) {
                  if (!updatesByRecipe.has(item.recipeId)) {
                      updatesByRecipe.set(item.recipeId, new Map());
                  }
                  updatesByRecipe.get(item.recipeId)!.set(name, { id: foundIcon.id, url: foundIcon.url, path: foundIcon.path, metadata: foundIcon.metadata });
              }
          }
      }

      console.log(`[queueIcons] Prepared updates for ${updatesByRecipe.size} recipes. Queuing ${queuedCount} items.`);

      for (const [recipeId, updates] of updatesByRecipe.entries()) {
          console.log(`[queueIcons] Updating recipe ${recipeId}...`);
          await db.runTransaction(async (t) => {
              const recipeRef = db.collection(DB_COLLECTION_RECIPES).doc(recipeId);
              const doc = await t.get(recipeRef);
              if (!doc.exists) return;
              const data = doc.data();
              if (!data?.graph?.nodes) return;
              
              const nodes = data.graph.nodes;
              let changed = false;
              
              nodes.forEach((n: any) => {
                  if (n.visualDescription) {
                      const nName = standardizeIngredientName(n.visualDescription);
                      if (updates.has(nName)) {
                          const update = updates.get(nName)!;
                          if (getNodeIconId(n) !== update.id) {
                              applyIconToNode(n, update);
                              changed = true;
                          }
                      }
                  }
              });
              
              if (changed) {
                  t.update(recipeRef, { "graph.nodes": removeUndefined(nodes) });
              }
          });
          console.log(`[queueIcons] Recipe ${recipeId} updated.`);
      }

      if (queuedCount > 0) {
          console.log('[queueIcons] Committing batch...');
          await batch.commit();
          console.log(`[DataService] Enqueued ${queuedCount} icons.`);
      }
      
      return immediateHits;
  }
  
  // ... (private helpers)
  private async updateStorageMetadata(iconUrl: string, updates: any) {
      if (!process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) return;
      try {
          const matches = iconUrl.match(new RegExp('/o/([^?]+)'));
          if (matches && matches[1]) {
              const bucket = storage.bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
              const file = bucket.file(decodeURIComponent(matches[1]));
              const [existing] = await file.getMetadata();
              const metadata = { ...(existing.metadata || {}), ...updates };
              for (const k in metadata) metadata[k] = String(metadata[k]);
              await file.setMetadata({ metadata });
          }
      } catch (e) { console.warn('Meta update failed', e); }
  }
}

export class MemoryDataService implements DataService {
    private recipes = new Map<string, {
        graph: RecipeGraph;
        ownerId?: string;
        ownerName?: string;
        sourceId?: string;
        visibility: string;
        isVetted?: boolean;
        stats: { likes: number; dislikes: number };
        created_at: number;
    }>();
    
    private userVotes = new Map<string, { liked: Set<string>; disliked: Set<string> }>();
    private userStars = new Map<string, Set<string>>();

    async queueIcons(items: { ingredientName: string, recipeId?: string, rejectedIds?: string[] }[]): Promise<Map<string, IconStats>> {
        console.log(`[MemoryDataService] Queuing icons (Synchronous Mock)`);
        const hits = new Map<string, IconStats>();
        
        for (const item of items) {
            const stdName = standardizeIngredientName(item.ingredientName);
            const rejected = new Set(item.rejectedIds || []);
            
            // Check cache first in memory
            const existingIcons = memoryStore.getIconsByName(stdName);
            const bestIcon = existingIcons.find(i => !rejected.has(i.id));

            if (bestIcon) {
                hits.set(stdName, { 
                    id: bestIcon.id, 
                    url: bestIcon.url, 
                    score: bestIcon.popularity_score, 
                    impressions: bestIcon.impressions, 
                    rejections: bestIcon.rejections, 
                    metadata: bestIcon.metadata 
                });
                continue;
            }

            // Fallback to generating new mock
            // Ensure ingredient exists for lookup
            const existingIng = memoryStore.getIngredients().find(i => i.name === stdName);
            if (!existingIng) {
                memoryStore.addIngredient({ name: stdName, created_at: Date.now() });
            }

            const mockUrl = `https://placehold.co/64x64/png?text=${encodeURIComponent(stdName)}&uuid=${randomUUID().substring(0, 6)}`;
            const dummyMeta = { center: { x: 0.5, y: 0.5 }, bbox: { x: 0, y: 0, w: 1, h: 1 } };
            const iconId = memoryStore.addIcon({
                url: mockUrl,
                ingredient: stdName,
                ingredientId: stdName,
                created_at: Date.now(),
                marked_for_deletion: false,
                popularity_score: 0,
                metadata: dummyMeta
            });
            
            hits.set(stdName, { id: iconId, url: mockUrl, score: 0, impressions: 0, rejections: 0, metadata: dummyMeta });
        }
        return hits;
    }

    async resolveRecipeIcons(recipeId: string, _embedFn?: (texts: string[]) => Promise<number[]>): Promise<void> {
        const recipe = this.recipes.get(recipeId);
        if (!recipe) return;
        
        const nodesToProcess = recipe.graph.nodes.filter(n => {
            if (!n.visualDescription) return false;
            // In memory, we just force update or check if missing
            const id = getNodeIconId(n);
            const url = getNodeIconUrl(n);
            return !id && !url;
        });

        if (nodesToProcess.length === 0) return;

        const items = nodesToProcess.map(n => ({
            ingredientName: n.visualDescription!,
            recipeId
        }));

        const hits = await this.queueIcons(items);
        
        recipe.graph.nodes.forEach(n => {
            if (n.visualDescription) {
                const stdName = standardizeIngredientName(String(n.visualDescription));
                if (hits.has(stdName)) {
                    const bestIcon = hits.get(stdName)!;
                    applyIconToNode(n, bestIcon);
                }
            }
        });
    }

    async addNodeToRecipe(recipeId: string, ingredientName: string, laneId: string = 'lane-1', _hydeQueries?: string[]): Promise<{ success: boolean, nodeId?: string, error?: string }> {
        const recipe = this.recipes.get(recipeId);
        if (!recipe) return { success: false, error: 'Recipe not found' };
        
        const stdName = standardizeIngredientName(ingredientName);
        const nodeId = 'node-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        
        recipe.graph.nodes.push({
            id: nodeId,
            laneId,
            text: stdName,
            visualDescription: stdName,
            type: 'ingredient',
            x: 0, y: 0
        });
        
        await this.resolveRecipeIcons(recipeId);
        return { success: true, nodeId };
    }

    async rejectRecipeIcon(recipeId: string, ingredientName: string, currentIconId?: string, userId?: string, _embedFn?: (texts: string[]) => Promise<number[]>): Promise<{ success: boolean, error?: string }> {
        const recipe = this.recipes.get(recipeId);
        if (!recipe) return { success: false, error: 'Recipe not found' };
        
        // Ownership check
        if (recipe.ownerId && recipe.ownerId !== userId) {
            return { success: false, error: "Unauthorized: Save a copy to reroll icons in this recipe." };
        }

        const stdName = standardizeIngredientName(ingredientName);
        
        if (!recipe.graph.rejections) recipe.graph.rejections = {};
        if (!recipe.graph.rejections[stdName]) recipe.graph.rejections[stdName] = [];
        
        if (currentIconId) {
            recipe.graph.rejections[stdName].push(currentIconId);
            this.recordRejection(currentIconId, ingredientName, stdName);
        }
        
        // Clear all nodes matching ingredient
        recipe.graph.nodes.forEach(n => {
            if (n.visualDescription && standardizeIngredientName(n.visualDescription) === stdName) {
                                    clearNodeIcon(n);
            }
        });
        
        await this.resolveRecipeIcons(recipeId);
        return { success: true };
    }
    
    async recordImpression(ingredientId: string, iconId: string): Promise<void> {
        // Simple increment for memory store
        const icons = memoryStore.getIconsForIngredient(ingredientId);
        const icon = icons.find(i => i.id === iconId);
        if (icon) {
            const n = (icon.impressions || 0) + 1;
            const r = (icon.rejections || 0);
            const score = 1.0; // Mock score
            memoryStore.updateIcon(iconId, { impressions: n, popularity_score: score });
        }
    }

    async incrementImpressions(ingredientId: string, iconId: string, iconUrl: string, newScore: number, newImpressions: number) {
        // Legacy support - can be removed or alias to recordImpression if needed
        await this.recordImpression(ingredientId, iconId);
    }

    async waitForQueue(ingredientName: string, timeoutMs?: number): Promise<IconStats | null> {
        return null;
    }
    
    // ... (rest of methods)
    async getPagedIcons(page: number, limit: number, query?: string): Promise<{ icons: any[], total: number }> {
        let icons = memoryStore.getAllIcons().filter(i => !i.marked_for_deletion);
        
        if (query) {
            const term = query.toLowerCase();
            icons = icons.filter(i => i.ingredient.toLowerCase().includes(term));
        } else {
             icons.sort((a, b) => b.created_at - a.created_at);
        }

        const total = icons.length;
        const paginated = icons.slice((page - 1) * limit, page * limit);
        return { icons: paginated, total };
    }

    async checkExistingCopies(originalId: string, userId: string): Promise<any[]> {
        return Array.from(this.recipes.entries())
            .filter(([_, r]) => r.ownerId === userId && r.sourceId === originalId)
            .sort((a, b) => b[1].created_at - a[1].created_at)
            .map(([id, r]) => this.mapMemoryRecipe(id, r));
    }

    async getPublicRecipes(limit: number): Promise<any[]> {
        return Array.from(this.recipes.entries())
            .filter(([_, r]) => r.visibility === 'public' && r.isVetted)
            .sort((a, b) => b[1].created_at - a[1].created_at)
            .map(([id, r]) => this.mapMemoryRecipe(id, r))
            .slice(0, limit);
    }

    async searchPublicRecipes(query: string): Promise<any[]> {
        const term = query.toLowerCase();
        return Array.from(this.recipes.entries())
            .filter(([_, r]) => {
                if (r.visibility !== 'public' || !r.isVetted) return false;
                const title = (r.graph.title || '').toLowerCase();
                const content = (r.graph.originalText || '').toLowerCase();
                const nodes = r.graph.nodes || [];
                const nodeText = nodes.some(n => n.text?.toLowerCase().includes(term) || n.visualDescription?.toLowerCase().includes(term));
                return title.includes(term) || content.includes(term) || nodeText;
            })
            .map(([id, r]) => this.mapMemoryRecipe(id, r));
    }
    
    async vetRecipe(recipeId: string, isVetted: boolean): Promise<void> {
        const r = this.recipes.get(recipeId);
        if (r) r.isVetted = isVetted;
    }
    
    async getUnvettedRecipes(limit: number): Promise<any[]> {
        return Array.from(this.recipes.entries())
            .filter(([_, r]) => r.visibility === 'public' && !r.isVetted)
            .sort((a, b) => b[1].created_at - a[1].created_at)
            .map(([id, r]) => this.mapMemoryRecipe(id, r))
            .slice(0, limit);
    }

    async getUserRecipes(userId: string): Promise<any[]> {
        return Array.from(this.recipes.entries())
            .filter(([_, r]) => r.ownerId === userId)
            .sort((a, b) => b[1].created_at - a[1].created_at)
            .map(([id, r]) => this.mapMemoryRecipe(id, r));
    }

    async getStarredRecipes(userId: string): Promise<any[]> {
        const starredIds = this.userStars.get(userId) || new Set();
        return Array.from(starredIds)
            .map(id => {
                const r = this.recipes.get(id);
                return r ? this.mapMemoryRecipe(id, r) : null;
            })
            .filter(Boolean);
    }

    async voteRecipe(recipeId: string, userId: string, vote: 'like' | 'dislike' | 'none'): Promise<void> {
        if (!this.recipes.has(recipeId)) return;
        
        let userVote = this.userVotes.get(userId);
        if (!userVote) {
            userVote = { liked: new Set(), disliked: new Set() };
            this.userVotes.set(userId, userVote);
        }

        const recipe = this.recipes.get(recipeId)!;
        
        // Remove existing vote
        if (userVote.liked.has(recipeId)) {
            userVote.liked.delete(recipeId);
            recipe.stats.likes--;
        }
        if (userVote.disliked.has(recipeId)) {
            userVote.disliked.delete(recipeId);
            recipe.stats.dislikes--;
        }

        // Add new vote
        if (vote === 'like') {
            userVote.liked.add(recipeId);
            recipe.stats.likes++;
        } else if (vote === 'dislike') {
            userVote.disliked.add(recipeId);
            recipe.stats.dislikes++;
        }
    }

    async toggleStar(recipeId: string, userId: string): Promise<boolean> {
        if (!this.recipes.has(recipeId)) return false;
        
        let stars = this.userStars.get(userId);
        if (!stars) {
            stars = new Set();
            this.userStars.set(userId, stars);
        }

        if (stars.has(recipeId)) {
            stars.delete(recipeId);
            return false;
        } else {
            stars.add(recipeId);
            return true;
        }
    }

    async copyRecipe(recipeId: string, userId: string): Promise<string> {
        const original = this.recipes.get(recipeId);
        if (!original) throw new Error("Recipe not found");
        
        const newGraph = JSON.parse(JSON.stringify(original.graph));
        if (newGraph.title) newGraph.title = `${newGraph.title} (Copy)`;
        
        return this.saveRecipe(newGraph, undefined, userId, 'unlisted');
    }

    async deleteRecipe(recipeId: string, userId: string): Promise<void> {
        const r = this.recipes.get(recipeId);
        if (!r) throw new Error("Recipe not found");
        if (r.ownerId !== userId) throw new Error("Unauthorized");
        this.recipes.delete(recipeId);
    }
    
    async saveRecipe(graph: RecipeGraph, existingId?: string, userId?: string, visibility: 'private' | 'unlisted' | 'public' = 'unlisted', ownerName?: string): Promise<string> {
        const id = existingId || randomUUID();
        const existing = this.recipes.get(id);
        
        if (existing && existing.ownerId && existing.ownerId !== userId) {
            throw new Error("You are not the owner of this recipe.");
        }

        const stats = existing?.stats || { likes: 0, dislikes: 0 };
        const created_at = existing?.created_at || Date.now();
        const ownerId = existing?.ownerId || userId; // Keep original owner if update
        const finalOwnerName = existing?.ownerName || ownerName;
        
        this.recipes.set(id, {
            graph,
            ownerId,
            ownerName: finalOwnerName,
            sourceId: graph.sourceId,
            visibility,
            stats,
            created_at
        });
        return id;
    }
    
    async getRecipe(id: string): Promise<{ graph: RecipeGraph, ownerId?: string, ownerName?: string, visibility?: string, stats?: any } | null> { 
        const r = this.recipes.get(id);
        if (!r) return null;
        const graph = r.graph;
        if (r.visibility) graph.visibility = r.visibility as any;

        // Mock lookup if needed, but for now just use ownerId as fallback or assume name is not stored in memory recipes unless we expand schema
        const ownerName = r.ownerId ? `User ${r.ownerId}` : undefined;

        return { 
            graph, 
            ownerId: r.ownerId, 
            ownerName,
            visibility: r.visibility, 
            stats: r.stats 
        }; 
    } 

    private mapMemoryRecipe(id: string, r: any) {
        let title = r.graph.title || 'Untitled Recipe';
        if (!title && r.graph.nodes.length > 0) title = r.graph.nodes[0].text;

        return {
            id,
            title,
            createdAt: new Date(r.created_at).toISOString(),
            nodeCount: r.graph.nodes.length,
            previewIcon: r.graph.nodes.map(getNodeIconUrl).findLast((u: string | undefined) => !!u),
            ownerId: r.ownerId,
            ownerName: r.ownerName,
            visibility: r.visibility,
            isVetted: r.isVetted || false,
            likes: r.stats.likes,
            dislikes: r.stats.dislikes
        };
    }

    async getIngredientByName(name: string) {
        const ingredients = memoryStore.getIngredients();
        const match = ingredients.find(i => i.name.toLowerCase() === name.toLowerCase());
        return match ? { id: match.id, data: match } : null;
    }

    async createIngredient(name: string) {
        return memoryStore.addIngredient({ name, created_at: Date.now() });
    }

    async getIconsForIngredient(ingredientId: string) {
        return memoryStore.getIconsForIngredient(ingredientId);
    }

    async getAllIcons() {
        return memoryStore.getAllIcons().sort((a, b) => b.popularity_score - a.popularity_score);
    }

    async uploadIcon(ingredientName: string, buffer: ArrayBuffer | Buffer, metadata: any): Promise<{ url: string, path: string, iconId: string }> {
        const iconId = metadata.iconId || randomUUID();
        return {
            url: `https://placehold.co/64x64/png?text=Memory&uuid=${iconId}`,
            path: `icons/${ingredientName}-${iconId}.png`,
            iconId
        };
    }

    async publishIcon(ingredientId: string, ingredientName: string, iconData: any): Promise<IconStats> {
        // Ensure ingredient exists
        const existing = memoryStore.getIngredients().find(i => i.name === ingredientId);
        if (!existing) {
            memoryStore.addIngredient({ name: ingredientId, created_at: Date.now() });
        }

        const id = memoryStore.addIcon({
            ...iconData,
            ingredient: ingredientName,
            ingredientId: ingredientId,
            popularity_score: iconData.score || 0,
            marked_for_deletion: false
        });
        
        return { id: id, url: iconData.url, metadata: iconData.metadata };
    }


    async recordRejection(iconId: string, ingredientName: string, ingredientId: string) {
        const icons = memoryStore.getAllIcons().filter(i => i.id === iconId || i.url === iconId);
        for (const icon of icons) {
            const n = (icon.impressions || 0);
            const r = (icon.rejections || 0) + 1;
            const newLcb = 0; // Simplified
            memoryStore.updateIcon(icon.id, { rejections: r, popularity_score: newLcb });
        }
    }

    async deleteIcon(iconId: string, ingredientName?: string) {
        memoryStore.deleteIcon(iconId);
    }


    async imagineRecipeWithIcon(recipeId: string, ingredientName: string, icon: IconStats, transaction?: any) {
        const recipe = this.recipes.get(recipeId);
        if (!recipe) throw new Error("Recipe not found");
        
        const stdName = standardizeIngredientName(ingredientName);
        // Clone nodes to avoid mutating state in 'imagine' phase
        const nodes = recipe.graph.nodes.map(n => ({ ...n, icon: n.icon ? { ...n.icon } : undefined }));
        let changed = false;
        
        nodes.forEach(n => {
            if (n.visualDescription && standardizeIngredientName(n.visualDescription) === stdName) {
                applyIconToNode(n, icon);
                changed = true;
            }
        });
        
        return { recipeId, nodes, changed, icon, ingredientName };
    }

    async setRecipeWithIcon(data: any, transaction?: any) {
        const { recipeId, nodes, changed, icon, ingredientName } = data;
        if (changed) {
            const recipe = this.recipes.get(recipeId);
            if (recipe) {
                recipe.graph.nodes = nodes;
                // In memory, we simulate the side effects
                await this.recordImpression(ingredientName, icon.iconId);
            }
        }
    }

    async assignIconToRecipe(recipeId: string, ingredientName: string, icon: IconStats, transaction?: any): Promise<void> {
        const data = await this.imagineRecipeWithIcon(recipeId, ingredientName, icon, transaction);
        await this.setRecipeWithIcon(data, transaction);
    }

    async retryIconGeneration(ingredientName: string) {
        console.log(`[MemoryDataService] Retry requested for ${ingredientName} (No-op in memory mode)`);
    }

    async failRecipeIcon(recipeId: string, ingredientName: string, errorMsg: string): Promise<void> {
        console.log(`[MemoryDataService] Fail icon requested for ${ingredientName}: ${errorMsg}`);
    }

    async submitFeedback(data: { message: string, url: string, email?: string, graphJson?: string, userId?: string }): Promise<void> {
        console.log('[MemoryDataService] Feedback submitted:', data);
    }

    async imagineIngredientWithIcon(ingredientId: string, ingredientName: string, iconData: any, transaction?: any): Promise<any> {
        return { ingredientId, ingredientName, iconData };
    }

    async setIngredientWithIcon(data: any, transaction?: any): Promise<void> {
        console.log(`[MemoryDataService] setIngredientWithIcon: ${data.ingredientName}`);
    }
    
    async listDebugFiles(): Promise<any[]> {
        const icons = await this.getAllIcons();
        return icons.map((icon: any) => ({
          name: `icons/${icon.ingredient_name || icon.ingredient}-${icon.id}.png`,
          updated: new Date(icon.created_at).toISOString(),
          contentType: 'image/png',
          size: 0,
          popularityScore: String(icon.popularity_score),
          impressions: String(icon.impressions || 0),
          rejections: String(icon.rejections || 0),
          mediaLink: icon.url,
          publicUrl: icon.url
      }));
    }

    async searchIconsByEmbedding(_queryVec: number[], _limit: number): Promise<IconStats[]> {
        return [];
    }

    async writeIconToIndex(_iconId: string, _ingredientName: string, _url: string, _embedding: number[]): Promise<void> {
        // no-op in memory mode
    }
}

let currentDataService: DataService | null = null;
export function getDataService(): DataService {
  if (currentDataService) return currentDataService;
  
  if (process.env.FORCE_MEMORY_DB === 'true' || !isFirebaseEnabled) {
      if (process.env.FORCE_MEMORY_DB === 'true') console.warn("Forcing MemoryDataService");
      else console.warn("Firebase not enabled, using MemoryDataService");
      currentDataService = new MemoryDataService();
  } else {
      currentDataService = new FirebaseDataService();
  }
  return currentDataService;
}
export function setDataService(service: DataService) { currentDataService = service; }