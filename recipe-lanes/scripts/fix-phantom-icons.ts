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

async function fixPhantomIcons() {
    const args = process.argv.slice(2);
    const stagingIndex = args.indexOf('--staging');
    
    if (stagingIndex !== -1) {
        console.log('✨ Switching to STAGING environment (.env.staging)...');
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        }
        dotenv.config({ path: '.env.staging', override: true });
    } else {
        dotenv.config();
    }

    const { db } = await import('../lib/firebase-admin');
    const isDryRun = args.includes('--dry-run');

    console.log(`Starting Phantom Icon Fix... ${isDryRun ? '(Dry Run)' : ''}`);

    // 1. Build Index of Valid Icons: Map<StandardName, Set<IconId>>
    console.log('Indexing ingredients_new...');
    const ingredientsSnapshot = await db.collection('ingredients_new').get();
    const validIconsIndex = new Map<string, Set<string>>();
    let totalIcons = 0;

    ingredientsSnapshot.forEach(doc => {
        const data = doc.data();
        // The doc ID *should* be the standardized name, but let's trust the ID for lookup
        const name = doc.id; 
        const iconSet = new Set<string>();
        
        if (data.icons && Array.isArray(data.icons)) {
            data.icons.forEach((i: any) => {
                if (i.id) iconSet.add(i.id);
            });
        }
        
        validIconsIndex.set(name, iconSet);
        totalIcons += iconSet.size;
    });

    console.log(`Indexed ${ingredientsSnapshot.size} ingredients with ${totalIcons} valid icons.`);

    // 2. Scan Recipes
    console.log('Scanning recipes...');
    const recipesSnapshot = await db.collection('recipes').get();
    
    let fixedRecipes = 0;
    let totalPhantoms = 0;
    const batch = db.batch();
    let opCount = 0;

    for (const doc of recipesSnapshot.docs) {
        const data = doc.data();
        const graph = data.graph;
        
        if (!graph || !Array.isArray(graph.nodes)) continue;

        let changed = false;
        const newNodes = graph.nodes.map((node: any) => {
            // Only check nodes that HAVE an iconId assigned
            const iconId = node.icon?.iconId || node.iconId;
            
            if (iconId) {
                // Determine which ingredient bucket this node SHOULD belong to
                const rawName = node.visualDescription || node.canonicalName || node.text;
                if (!rawName) return node; // Can't validate without name

                const stdName = standardizeIngredientName(rawName);
                if (stdName != 'Butter') return node;
                
                // Check validity
                const validSet = validIconsIndex.get(stdName);
                
                let isPhantom = false;
                if (!validSet) {
                    // Ingredient document completely missing
                    isPhantom = true;
                    // console.log(`[Phantom] Recipe ${doc.id} ("${stdName}"): Ingredient doc missing.`);
                } else if (!validSet.has(iconId)) {
                    // Icon missing from ingredient doc
                    isPhantom = true;
                    // console.log(`[Phantom] Recipe ${doc.id} ("${stdName}"): Icon ${iconId} missing from valid set.`);
                }

                if (isPhantom) {
                    console.log(`[Fixing] Recipe ${doc.id} node "${node.text}" -> Phantom Icon ${iconId} (Expected in "${stdName}")`);
                    
                    // Clear the icon data to force re-resolution
                    if (node.icon) delete node.icon;
                    if (node.iconId) delete node.iconId;
                    if (node.iconUrl) delete node.iconUrl;
                    if (node.iconMetadata) delete node.iconMetadata;
                    
                    changed = true;
                    totalPhantoms++;
                }
            }
            return node;
        });

        if (changed) {
            if (!isDryRun) {
                batch.update(doc.ref, { 
                    "graph.nodes": removeUndefined(newNodes),
                    updated_at: FieldValue.serverTimestamp()
                });
                opCount++;
                if (opCount >= 400) {
                    await batch.commit();
                    opCount = 0;
                    console.log('Committed batch...');
                }
            }
            fixedRecipes++;
        }
    }

    if (!isDryRun && opCount > 0) {
        await batch.commit();
    }

    console.log(`\nScan Complete.`);
    console.log(`Found and cleared ${totalPhantoms} phantom icons across ${fixedRecipes} recipes.`);
    if (isDryRun) console.log(`(Dry Run - no changes written)`);
}

fixPhantomIcons().catch(console.error);