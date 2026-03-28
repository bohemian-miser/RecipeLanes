/**
 * Export action node data for visualization.
 *
 * Usage:
 *   npx tsx scripts/export-action-icon-data.ts [--staging]
 *
 * Output: scripts/action-icon-data.json
 *   Array of { desc, count, iconUrl } for all unique action node descriptions.
 *   iconUrl is the best available icon for that description across all recipes,
 *   or null if no recipe has generated an icon for it yet.
 */

import 'dotenv/config';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { standardizeIngredientName } from '../lib/utils';

const args = process.argv.slice(2);
if (args.includes('--staging')) {
    console.log('✨ Switching to STAGING...');
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    dotenv.config({ path: '.env.staging', override: true });
}

async function main() {
    const { db } = await import('../lib/firebase-admin');

    console.log('Fetching recipes...');
    const snapshot = await db.collection('recipes').get();
    console.log(`${snapshot.size} recipes found.`);

    // For each unique standardized description, collect:
    //   - total count across all recipes
    //   - best icon URL (prefer scored icons; fall back to any non-null URL)
    const descData = new Map<string, { count: number; iconUrl: string | null; iconScore: number }>();

    snapshot.forEach(doc => {
        const graph = doc.data().graph;
        if (!graph?.nodes?.length) return;
        for (const node of graph.nodes) {
            if (node.type !== 'action' || !node.visualDescription) continue;
            const desc = standardizeIngredientName(String(node.visualDescription));
            const existing = descData.get(desc) ?? { count: 0, iconUrl: null, iconScore: -1 };
            existing.count++;

            const icon = node.icon;
            if (icon?.url) {
                const score = icon.score ?? 0;
                if (!existing.iconUrl || score > existing.iconScore) {
                    existing.iconUrl = icon.url;
                    existing.iconScore = score;
                }
            }
            descData.set(desc, existing);
        }
    });

    // Also check the ingredients collection for icons we might have missed
    console.log('Fetching ingredients for icon URLs...');
    const ingSnap = await db.collection('ingredients').get();
    let ingIconsFilled = 0;
    ingSnap.forEach(doc => {
        const name = doc.id; // already standardized
        const data = descData.get(name);
        if (!data) return;
        const icons: any[] = doc.data().icons ?? [];
        if (icons.length === 0) return;
        // Pick the best icon
        const best = icons.filter(i => i.url && i.status !== 'failed')
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
        if (best?.url && (!data.iconUrl || (best.score ?? 0) > data.iconScore)) {
            data.iconUrl = best.url;
            data.iconScore = best.score ?? 0;
            ingIconsFilled++;
        }
    });
    console.log(`Filled ${ingIconsFilled} icon URLs from ingredients collection.`);

    const output = [...descData.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .map(([desc, { count, iconUrl }]) => ({ desc, count, iconUrl }));

    const withIcons = output.filter(d => d.iconUrl).length;
    console.log(`\n${output.length} unique descriptions, ${withIcons} have icon URLs (${((withIcons / output.length) * 100).toFixed(1)}%).`);

    const outPath = path.join(__dirname, 'action-icon-data.json');
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
    console.log(`Written to ${outPath}`);
}

main().catch(console.error);
