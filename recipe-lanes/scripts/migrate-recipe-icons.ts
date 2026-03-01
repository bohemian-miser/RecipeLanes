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

import dotenv from 'dotenv';
import { FieldValue } from 'firebase-admin/firestore';
import { standardizeIngredientName, removeUndefined } from '../lib/utils';

async function migrateRecipeIcons() {
    const args = process.argv.slice(2);
    const stagingIndex = args.indexOf('--staging');
    
    if (stagingIndex !== -1) {
        console.log('✨ Switching to STAGING environment (.env.staging)...');
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            console.log('⚠️  Unsetting GOOGLE_APPLICATION_CREDENTIALS to avoid Prod conflict.');
            delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        }
        dotenv.config({ path: '.env.staging', override: true });
    } else {
        dotenv.config();
    }

    const { db } = await import('../lib/firebase-admin');
    
    const isDryRun = args.includes('--dry-run');
    const isRevert = args.includes('--revert');
    const isForce = args.includes('--force');

    console.log(`Starting Recipe Icon Migration...`);
    console.log(`-----------------------------------`);
    console.log(`Mode: ${isRevert ? 'REVERT' : 'MIGRATE'}`);
    console.log(`Dry Run: ${isDryRun}`);
    console.log(`Force: ${isForce}`);
    console.log(`-----------------------------------`);

    // Cache for ingredients_new lookups
    const ingredientCache = new Map<string, any>();

    // Helper to get ingredient data
    async function getIngredient(name: string) {
        const stdName = standardizeIngredientName(name);
        if (ingredientCache.has(stdName)) {
            // console.log(`[Cache] Hit for "${stdName}"`);
            return ingredientCache.get(stdName);
        }
        
        console.log(`[Cache] Miss for "${stdName}". Fetching...`);
        const doc = await db.collection('ingredients_new').doc(stdName).get();
        if (doc.exists) {
            const data = doc.data();
            console.log(`[Cache] Found "${stdName}" with ${data?.icons?.length || 0} icons.`);
            ingredientCache.set(stdName, data);
            return data;
        }
        console.log(`       [ERROR] "${stdName}" NOT FOUND in 'ingredients_new'.`);
        return null;
    }

    const snapshot = await db.collection('recipes').get();
    console.log(`Found ${snapshot.size} recipes in 'recipes' collection.`);

    let batch = db.batch();
    let opCount = 0;
    let recipesProcessed = 0;
    let nodesUpdated = 0;
    let skippedRecipes = 0;

    let diffCount = 0;
    const MAX_DIFFS = 5;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const graph = data.graph;
        
        if (!graph || !Array.isArray(graph.nodes)) {
            // console.log(`[Skip] Recipe ${doc.id}: Invalid graph or no nodes.`);
            skippedRecipes++;
            continue;
        }

        let changed = false;
        const nodes = graph.nodes;

        // --- REVERT LOGIC ---
        if (isRevert) {
            // Check if this recipe was migrated
            if (!data.migrated_icon_version && !isForce) {
                // console.log(`[Skip] Recipe ${doc.id}: Not marked as migrated (migrated_icon_version missing).`);
                continue;
            }

            // console.log(`[Revert] Checking Recipe ${doc.id} ("${data.title || 'Untitled'}")...`);

            for (const node of nodes) {
                if (node._backupIconUrl) {
                    if (isDryRun && diffCount < MAX_DIFFS) {
                         console.log(`\n[DIFF] Recipe ${doc.id} ("${data.title || 'Untitled'}") - Node: "${node.text}"`);
                         console.log(`  OLD (Restoring): ${node._backupIconUrl}`);
                         console.log(`  CURRENT:         ${node.iconUrl}`);
                         diffCount++;
                    }
                    
                    node.iconUrl = node._backupIconUrl;
                    delete node._backupIconUrl;
                    changed = true;
                    nodesUpdated++;
                }
            }

            if (changed || data.migrated_icon_version) {
                if (isDryRun) {
                    // console.log(`[DryRun] Would save recipe ${doc.id} (Reverted)`);
                } else {
                    const update: any = { "graph.nodes": nodes };
                    update.migrated_icon_version = FieldValue.delete();
                    update.migrated_icon_at = FieldValue.delete();
                    
                    batch.update(doc.ref, update);
                    opCount++;
                    // console.log(`[Revert] Queued update for Recipe ${doc.id}`);
                }
            }

        } else {
            // --- MIGRATE LOGIC ---
            if (data.migrated_icon_version && !isForce) {
                // Already migrated
                // console.log(`[Skip] Recipe ${doc.id}: Already migrated (v${data.migrated_icon_version}).`);
                continue;
            }

            // console.log(`[Migrate] Checking Recipe ${doc.id} ("${data.title || 'Untitled'}")...`);

            for (const node of nodes) {
                // Skip nodes without icons
                if (!node.iconUrl && !node.iconId) {
                    continue;
                }
                
                // Skip if we already have a backup (partially migrated?)
                if (node._backupIconUrl && !isForce) {
                    console.log(`  [Skip] Node "${node.text}": Already has backup (Partial migration?).`);
                    continue;
                }

                // Identify Ingredient
                const ingredientName = node.visualDescription || node.text;
                if (!ingredientName) {
                    continue;
                }

                const ingData = await getIngredient(ingredientName);
                if (!ingData || !ingData.icons || ingData.icons.length === 0) {
                    console.warn(`  [Warn] No new ingredient/icons found for "${ingredientName}" (Recipe ${doc.id})`);
                    continue;
                }

                // Find matching icon
                let bestIcon = null;
                let matchMethod = '';
                
                // 1. Try matching by ID
                if (node.iconId) {
                    bestIcon = ingData.icons.find((i: any) => i.id === node.iconId);
                    if (bestIcon) matchMethod = 'ID Match';
                }

                // 2. Fallback: If no ID match (or no node.iconId), pick the best scoring one?
                if (!bestIcon && !node.iconId) {
                     // Assign top icon
                     bestIcon = ingData.icons[0];
                     matchMethod = 'Fallback (Top Score)';
                }

                if (bestIcon) {
                    const newUrl = bestIcon.url;
                    
                    // Only update if URL is different
                    if (newUrl !== node.iconUrl) {
                         if (isDryRun && diffCount < MAX_DIFFS) {
                             console.log(`\n[DIFF] Recipe ${doc.id} ("${data.title || 'Untitled'}") - Node: "${node.text}" (${matchMethod})`);
                             console.log(`  OLD: ${node.iconId} ${node.iconUrl}`);
                             console.log(`  NEW: ${bestIcon.id} ${newUrl}`);
                             diffCount++;
                         }
                         
                         node._backupIconUrl = node.iconUrl; // Backup old
                         node.iconUrl = newUrl;
                         node.iconId = bestIcon.id; // Ensure ID is synced
                         changed = true;
                         nodesUpdated++;
                    }
                }
            }

            if (changed) {
                if (isDryRun) {
                    console.log(`[DryRun] Would save recipe ${doc.id} (Migrated)`);
                } else {
                    batch.update(doc.ref, { 
                        "graph.nodes": removeUndefined(nodes),
                        migrated_icon_version: 1,
                        migrated_icon_at: FieldValue.serverTimestamp()
                    });
                    opCount++;
                    console.log(`[Migrate] Queued update for Recipe ${doc.id}`);
                }
            }
        }

        if (changed) recipesProcessed++;

        if (opCount >= 400) {
            console.log(`Committing batch of ${opCount} operations...`);
            await batch.commit();
            console.log(`Batch Committed.`);
            batch = db.batch();
            opCount = 0;
        }
    }

    if (!isDryRun && opCount > 0) {
        console.log(`Committing final batch of ${opCount} operations...`);
        await batch.commit();
        console.log(`Final Batch Committed.`);
    }

    console.log(`-----------------------------------`);
    console.log(`Migration Complete.`);
    console.log(`Recipes Processed (Changed): ${recipesProcessed}`);
    console.log(`Nodes Updated: ${nodesUpdated}`);
    console.log(`Skipped Recipes (Invalid): ${skippedRecipes}`);
    console.log(`-----------------------------------`);
}

migrateRecipeIcons().catch(console.error);