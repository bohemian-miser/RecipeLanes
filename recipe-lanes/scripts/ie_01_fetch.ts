/**
 * Fetch all action node data from Firestore, download raw icon PNGs, write JSON index.
 *
 * Usage:
 *   npx tsx scripts/ie_01_fetch.ts [--staging]
 *
 * Output:
 *   scripts/ie_data/action-icons.json  — array of IconItem, sorted by count desc, top 2000
 *   scripts/ie_data/icons/raw/{id}.png — raw downloaded PNGs
 */

import 'dotenv/config';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { standardizeIngredientName } from '../lib/utils';

const args = process.argv.slice(2);
if (args.includes('--staging')) {
    console.log('✨ Switching to STAGING environment (.env.staging)...');
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
    dotenv.config({ path: '.env.staging', override: true });
}

interface IconItem {
    idx: number;
    id: string;
    desc: string;
    count: number;
    iconUrl: string | null;
    rawFile: string | null;
}

function computeId(desc: string): string {
    return createHash('md5').update(desc).digest('hex').slice(0, 8);
}

async function main() {
    const { db } = await import('../lib/firebase-admin');

    // --- Collect desc counts and best icon URLs from recipes ---
    console.log('Fetching recipes...');
    const snapshot = await db.collection('recipes').get();
    console.log(`${snapshot.size} recipes found.`);

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

    console.log(`${descData.size} unique action descriptions found.`);

    // --- Also check ingredients collection for better icon URLs ---
    console.log('Fetching ingredients for icon URLs...');
    const ingSnap = await db.collection('ingredients').get();
    let ingIconsFilled = 0;
    ingSnap.forEach(doc => {
        const name = doc.id; // already standardized
        const data = descData.get(name);
        if (!data) return;
        const icons: any[] = doc.data().icons ?? [];
        if (icons.length === 0) return;
        const best = icons
            .filter(i => i.url && i.status !== 'failed')
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
        if (best?.url && (!data.iconUrl || (best.score ?? 0) > data.iconScore)) {
            data.iconUrl = best.url;
            data.iconScore = best.score ?? 0;
            ingIconsFilled++;
        }
    });
    console.log(`Filled ${ingIconsFilled} icon URLs from ingredients collection.`);

    // --- Sort by count desc, take top 2000 ---
    const sorted = [...descData.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 2000);

    console.log(`Processing top ${sorted.length} descriptions.`);

    // --- Build items array (rawFile filled in after downloads) ---
    const items: IconItem[] = sorted.map(([desc, { count, iconUrl }], idx) => ({
        idx,
        id: computeId(desc),
        desc,
        count,
        iconUrl,
        rawFile: null,
    }));

    // --- Download icons ---
    const ieDataDir = path.join(__dirname, 'ie_data');
    const rawDir = path.join(ieDataDir, 'icons', 'raw');

    const toDownload = items.filter(item => item.iconUrl !== null);
    console.log(`\nDownloading icons: ${toDownload.length} items have URLs (${items.length - toDownload.length} have none).`);

    const BATCH_SIZE = 20;
    let downloaded = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < toDownload.length; i += BATCH_SIZE) {
        const batch = toDownload.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
            batch.map(async item => {
                const filePath = path.join(rawDir, `${item.id}.png`);
                // Skip if already exists
                try {
                    await fs.promises.access(filePath);
                    item.rawFile = `icons/raw/${item.id}.png`;
                    skipped++;
                    return;
                } catch {
                    // File does not exist, proceed with download
                }

                const response = await fetch(item.iconUrl!);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status} for ${item.iconUrl}`);
                }
                const buffer = Buffer.from(await response.arrayBuffer());
                await fs.promises.writeFile(filePath, buffer);
                item.rawFile = `icons/raw/${item.id}.png`;
                downloaded++;
            })
        );

        for (const result of results) {
            if (result.status === 'rejected') {
                failed++;
            }
        }

        const done = Math.min(i + BATCH_SIZE, toDownload.length);
        process.stdout.write(
            `\r  Progress: ${done}/${toDownload.length}  (downloaded: ${downloaded}, skipped: ${skipped}, failed: ${failed})`
        );
    }

    console.log(`\nDownload complete: ${downloaded} new, ${skipped} already existed, ${failed} failed.`);

    // --- Write JSON index ---
    const outPath = path.join(ieDataDir, 'action-icons.json');
    await fs.promises.writeFile(outPath, JSON.stringify(items, null, 2), 'utf8');
    console.log(`\nWritten: ${outPath}`);
    console.log(`Total items: ${items.length}, with rawFile: ${items.filter(i => i.rawFile).length}`);
}

main().catch(console.error);
