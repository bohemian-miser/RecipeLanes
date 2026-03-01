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
import readline from 'readline';

async function reprocessRecipes() {
    const args = process.argv.slice(2);
    const stagingIndex = args.indexOf('--staging');
    
    if (stagingIndex !== -1) {
        console.log('✨ Switching to STAGING environment (.env.staging)...');
        dotenv.config({ path: '.env.staging', override: true });
    } else {
        dotenv.config();
    }
    const { db } = await import('../lib/firebase-admin');
    const { getDataService } = await import('../lib/data-service');

    const service = getDataService();

    console.log('--- Recipe Reprocessor ---');
    console.log('Scanning recipes...');

    const snapshot = await db.collection('recipes').get();
    const recipes = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    console.log(`Found ${recipes.length} recipes.`);
    
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const ask = (query: string) => new Promise<string>((resolve) => rl.question(query, resolve));

    console.log('\nStarting Interactive Reprocessing (y/n/q/a)...');
    let run_all = false;
    for (const recipe of recipes) {
        const title = (recipe as any).graph?.title || (recipe as any).title || 'Untitled';
        const id = (recipe as any).id;
        
        // Quick check if it looks broken (optional, but helpful context)
        const nodeCount = (recipe as any).graph?.nodes?.length || 0;
        const iconCount = (recipe as any).graph?.nodes?.filter((n: any) => n.icon || n.iconId).length || 0;
        
        if (!run_all) {
            const answer = await ask(`\nProcess "${title}" (${id})? [Nodes: ${nodeCount}, Icons: ${iconCount}] (y/n/q/a): `);
        
            if (answer.toLowerCase() === 'q') {
                console.log('Quitting.');
                break;
            }
        
            if (answer.toLowerCase() === 'a') {
                console.log('Processing all.');
                run_all = true;
            }
        
            if (answer.toLowerCase() === 'y' || answer === '' || answer === 'a') {
                process.stdout.write(`  Processing... `);
                try {
                    await service.resolveRecipeIcons(id);
                    console.log('✅ Done');
                } catch (e: any) {
                    console.log('❌ Failed:', e.message);
                }
            } else {
                console.log('  Skipped.');
            }
        } else {

            process.stdout.write(`  Processing all ... `);
            try {
                await service.resolveRecipeIcons(id);
                console.log('✅ Done');
            } catch (e: any) {
                console.log('❌ Failed:', e.message);
            }
        }
        
    }

    console.log('\n--- Complete ---');
    rl.close();
    process.exit(0);
}

reprocessRecipes().catch(console.error);