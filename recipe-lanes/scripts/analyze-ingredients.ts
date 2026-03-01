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

import 'dotenv/config';
import type { RecipeGraph } from '../lib/recipe-lanes/types';

import dotenv from 'dotenv';

// Helper matching the one in minimal-node-modern.tsx
const parseNodeText = (text: string) => {
    // Regex for: "Number(maybe fraction) Unit(optional) Name"
    const match = text.match(/^([\d./\u00BC-\u00BE]+)\s*([a-zA-Z]*)\s+(.*)$/);
    if (match) {
        return { qty: match[1], unit: match[2], name: match[3], matched: true };
    }
    return { qty: '', unit: '', name: text, matched: false };
};

async function analyzeIngredients() {

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
    console.log('Fetching recipes...');
    const snapshot = await db.collection('recipes').get();
    
    let total = 0;
    let matched = 0;
    const failures: string[] = [];
    const successes: string[] = [];

    snapshot.forEach(doc => {
        const data = doc.data();
        const graph = data.graph as RecipeGraph;
        if (graph && graph.nodes) {
            graph.nodes.forEach(node => {
                if (node.type === 'ingredient') {
                    total++;
                    const res = parseNodeText(node.text);
                    if (res.matched) {
                        matched++;
                        if (successes.length < 10) successes.push(`${node.text} -> [${res.qty}] [${res.unit}] [${res.name}]`);
                    } else {
                        if (failures.length < 20) failures.push(node.text);
                    }
                }
            });
        }
    });

    console.log(`
Analysis Complete.`);
    console.log(`Total Ingredients: ${total}`);
    console.log(`Matched: ${matched} (${((matched/total)*100).toFixed(1)}%)`);
    
    console.log(`
Sample Matches:`);
    successes.forEach(s => console.log('  ' + s));
    
    console.log(`
Sample Failures:`);
    failures.forEach(f => console.log('  ' + f));
}

analyzeIngredients().catch(console.error);