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
dotenv.config();

async function run() {
  const args = process.argv.slice(2);
  const stagingIndex = args.indexOf('--staging');
  
  if (stagingIndex !== -1) {
      console.log('✨ Switching to STAGING environment (.env.staging)...');
      dotenv.config({ path: '.env.staging', override: true });
  }

  // Dynamic import
  const { db } = await import('../lib/firebase-admin');

  async function cleanup() {
    console.log('Starting cleanup of placeholder icons...');
    
    const badPatterns = [
        'placehold.co',
        '127.0.0.1',
        'localhost',
        // 'firebasestorage.app/o/icons%2Fseed', // Also clean seeded data if it leaked,
        // 'https://storage.googleapis.com/recipe-lanes-staging.firebasestorage.app/icons%2F'
    ];

    // 1. Clean Icons
    const ingredients = await db.collection('ingredients').get();
    console.log(`Scanning ${ingredients.size} ingredients...`);
    
    let deletedCount = 0;
    
    for (const ingDoc of ingredients.docs) {
        const icons = await ingDoc.ref.collection('icons').get();
        const batch = db.batch();
        let batchCount = 0;
        
        for (const iconDoc of icons.docs) {
            const data = iconDoc.data();
            const url = data.url || '';
            console.log(`Checking icon: ${url}`);   
            if (badPatterns.some(p => url.includes(p))) {
                console.log(`Deleting bad icon: ${url}`);
                batch.delete(iconDoc.ref);
                batchCount++;
                deletedCount++;
            }
        }
        
        if (batchCount > 0) {
            await batch.commit();
        }
    }
    
    console.log(`Deleted ${deletedCount} bad icons.`);

    // 2. Clean Recipes
    const recipes = await db.collection('recipes').get();
    console.log(`Scanning ${recipes.size} recipes...`);
    
    let recipeUpdateCount = 0;

    for (const recipeDoc of recipes.docs) {
        const data = recipeDoc.data();
        const graph = data.graph;
        
        if (graph && graph.nodes) {
            let modified = false;
            const newNodes = graph.nodes.map((n: any) => {
              //   console.log(`Checking recipe node icon: ${n.iconUrl}`);
                if (n.iconUrl && badPatterns.some(p => n.iconUrl.includes(p))) {
                    console.log(`Clearing bad icon from recipe ${recipeDoc.id} node ${n.text}`);
                    modified = true;
                    return { ...n, iconUrl: null, iconId: null };
                }
                return n;
            });
            
            if (modified) {
                await recipeDoc.ref.update({ 'graph.nodes': newNodes });
                recipeUpdateCount++;
            }
        }
    }

    console.log(`Updated ${recipeUpdateCount} recipes.`);
    console.log('Cleanup complete.');
  }

  await cleanup().catch(console.error);
}

run();