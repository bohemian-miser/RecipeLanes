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
import type { RecipeGraph } from '../lib/recipe-lanes/types';

async function analyzeRecipeIngredients() {
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

    console.log('Fetching all recipes...');
    const snapshot = await db.collection('recipes').get();
    console.log(`Found ${snapshot.size} recipes.`);

    const ingredientMap = new Map<string, { count: number; recipes: { id: string; title: string }[] }>();

    let recipeCount = 0;
    snapshot.forEach(doc => {
        const data = doc.data();
        const graph = data.graph as RecipeGraph;
        const title = data.title || graph?.title || 'Untitled';

        if (graph && Array.isArray(graph.nodes)) {
            const seenIngredientsInRecipe = new Set<string>();

            graph.nodes.forEach(node => {
                if (node.type === 'ingredient') {
                    // Prefer visualDescription as it's usually the cleanest name used for icon generation
                    // If not available, parse from text or use text directly
                    let rawName = node.visualDescription || node.canonicalName || node.text;
                    
                    if (rawName) {
                        // Clean up quantity prefixes if still present in text/visualDescription (heuristic)
                        // e.g. "2 Eggs" -> "Eggs" if canonicalName wasn't set
                        // But standardizeIngredientName just does Title Case. 
                        // Let's assume visualDescription is relatively clean or rely on standardization.
                        
                        const name = standardizeIngredientName(rawName);
                        
                        if (!seenIngredientsInRecipe.has(name)) {
                            seenIngredientsInRecipe.add(name);
                            
                            if (!ingredientMap.has(name)) {
                                ingredientMap.set(name, { count: 0, recipes: [] });
                            }
                            
                            const entry = ingredientMap.get(name)!;
                            entry.count++;
                            entry.recipes.push({ id: doc.id, title });
                        }
                    }
                }
            });
        }
        recipeCount++;
    });

    // Sort by count descending
    const sortedIngredients = Array.from(ingredientMap.entries())
        .sort((a, b) => b[1].count - a[1].count);

    console.log('=== Top Ingredients by Recipe Count ===');

    // Display Top 50?
    const limit = 50;
    
    sortedIngredients.slice(0, limit).forEach(([name, data], index) => {
        console.log(`${index + 1}. ${name} (${data.count} recipes)`);
        // List top 5 recipes for context
        data.recipes.slice(0, 5).forEach(r => {
            console.log(`   - ${r.title} (${r.id})`);
        });
        if (data.recipes.length > 5) {
            console.log(`   - ... and ${data.recipes.length - 5} more`);
        }
        console.log('');
    });

    console.log(`Total unique ingredients found: ${sortedIngredients.length}`);
}

analyzeRecipeIngredients().catch(console.error);