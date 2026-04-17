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

/**
 * Finds an icon by ID across ingredients_new and icon_index collections.
 * Useful for diagnosing missing/malformed icon data.
 *
 * Usage:
 *   npx tsx scripts/find-icon.ts <icon-id-prefix>            # production
 *   npx tsx scripts/find-icon.ts <icon-id-prefix> --staging  # staging
 *
 * Example:
 *   npx tsx scripts/find-icon.ts c2a6acb4
 */

import dotenv from 'dotenv';
import { DB_COLLECTION_INGREDIENTS, DB_COLLECTION_ICON_INDEX } from '../lib/config';

const args = process.argv.slice(2);
const stagingFlag = args.includes('--staging');
const searchId = args.find(a => !a.startsWith('--'));

if (!searchId) {
    console.error('Usage: npx tsx scripts/find-icon.ts <icon-id-prefix> [--staging]');
    process.exit(1);
}

if (stagingFlag) {
    console.log('✨ Switching to STAGING environment (.env.staging)...');
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    dotenv.config({ path: '.env.staging', override: true });
} else {
    dotenv.config();
}

console.log(`Searching for icon matching: "${searchId}"\n`);

async function main() {
    const { db } = await import('../lib/firebase-admin');

    // 1. Check icon_index (fast — keyed by icon_id)
    console.log('=== icon_index ===');
    const indexDoc = await db.collection(DB_COLLECTION_ICON_INDEX).doc(searchId).get();
    if (indexDoc.exists) {
        console.log('Found exact match in icon_index:');
        console.log(JSON.stringify(indexDoc.data(), null, 2));
    } else {
        // Partial prefix match
        const indexSnap = await db.collection(DB_COLLECTION_ICON_INDEX).get();
        const matches = indexSnap.docs.filter(d => d.id.startsWith(searchId));
        if (matches.length > 0) {
            console.log(`Found ${matches.length} prefix match(es) in icon_index:`);
            matches.forEach(d => {
                console.log(`  doc_id: ${d.id}`);
                console.log(JSON.stringify(d.data(), null, 2));
            });
        } else {
            console.log('No match found in icon_index.');
        }
    }

    // 2. Scan ingredients_new for any icon with matching id
    console.log('\n=== ingredients_new ===');
    let found = false;
    let pageQuery = db.collection(DB_COLLECTION_INGREDIENTS).limit(200);
    let lastDoc: FirebaseFirestore.DocumentSnapshot | null = null;

    while (true) {
        const snap = lastDoc ? await pageQuery.startAfter(lastDoc).get() : await pageQuery.get();
        if (snap.empty) break;

        for (const doc of snap.docs) {
            const data = doc.data();
            const icons: any[] = data.icons || [];
            const hit = icons.find((ic: any) => ic.id && ic.id.startsWith(searchId));
            if (hit) {
                found = true;
                console.log(`Found in ingredient doc: "${doc.id}"`);
                console.log('  Icon entry:');
                console.log(JSON.stringify(hit, null, 2));
                console.log('  Ingredient doc (icons omitted for brevity):');
                console.log(JSON.stringify({ ...data, icons: `[${icons.length} icons]` }, null, 2));
            }
        }

        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.size < 200) break;
    }

    if (!found) {
        console.log('No match found in ingredients_new.');
    }

    // 3. Check if any recipe nodes reference this icon
    console.log('\n=== recipes (shortlist scan) ===');
    let recipeFound = false;
    let recipeQuery = db.collection('recipes').limit(200);
    let recipeLastDoc: FirebaseFirestore.DocumentSnapshot | null = null;

    while (true) {
        const snap = recipeLastDoc ? await recipeQuery.startAfter(recipeLastDoc).get() : await recipeQuery.get();
        if (snap.empty) break;

        for (const doc of snap.docs) {
            const graph = doc.data()?.graph;
            const nodes: any[] = graph?.nodes || [];
            for (const node of nodes) {
                const shortlist: any[] = node.iconShortlist || [];
                const hit = shortlist.find((entry: any) => entry.icon?.id?.startsWith(searchId));
                if (hit) {
                    recipeFound = true;
                    console.log(`Found in recipe "${doc.id}", node "${node.id}" (visualDescription: ${node.visualDescription}):`);
                    console.log('  Shortlist entry:');
                    console.log(JSON.stringify(hit, null, 2));
                }
            }
        }

        recipeLastDoc = snap.docs[snap.docs.length - 1];
        if (snap.size < 200) break;
    }

    if (!recipeFound) {
        console.log('No recipe nodes reference this icon in their shortlist.');
    }
}

main().catch(e => {
    console.error('Script failed:', e);
    process.exit(1);
});
