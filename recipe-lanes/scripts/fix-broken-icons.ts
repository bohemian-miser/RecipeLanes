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
import { standardizeIngredientName } from '../lib/utils';

async function fixBrokenIcons() {
    dotenv.config();
    const { db } = await import('../lib/firebase-admin');

    console.log('--- Fixing Broken Icons ---');

    // 1. Build Cache of Valid Icon IDs
    console.log('Loading valid icons from Ingredients...');
    const ingSnapshot = await db.collection('ingredients_new').get();
    const validIconIds = new Set<string>();
    
    ingSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.icons && Array.isArray(data.icons)) {
            data.icons.forEach((i: any) => validIconIds.add(i.id));
        }
    });
    console.log(`Loaded ${validIconIds.size} valid icon IDs.`);

    // 2. Scan Recipes
    console.log('Scanning Recipes...');
    const recSnapshot = await db.collection('recipes').get();
    
    let fixedCount = 0;
    const batch = db.batch();
    let opCount = 0;

    for (const doc of recSnapshot.docs) {
        const data = doc.data();
        const graph = data.graph;
        if (!graph || !Array.isArray(graph.nodes)) continue;

        let changed = false;
        const newNodes = graph.nodes.map((n: any) => {
            if (n.iconId) {
                if (!validIconIds.has(n.iconId)) {
                    console.log(`[Broken] Recipe "${doc.id}" Node "${n.text}": Icon ${n.iconId} not found in DB. Removing.`);
                    // Clear icon
                    const { icon, iconId, iconUrl, ...rest } = n;
                    changed = true;
                    return rest;
                }
            }
            return n;
        });

        if (changed) {
            batch.update(doc.ref, { "graph.nodes": newNodes });
            fixedCount++;
            opCount++;
            if (opCount >= 400) {
                await batch.commit();
                opCount = 0;
            }
        }
    }

    if (opCount > 0) {
        await batch.commit();
    }

    console.log('--- Complete ---');
    console.log(`Fixed ${fixedCount} recipes.`);
}

fixBrokenIcons().catch(console.error);