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
 * Backfills missing visualDescription on IconStats entries in ingredients_new.
 * The doc ID is the canonical ingredient name, so visualDescription = doc.id.
 *
 * Usage:
 *   npx tsx scripts/backfill-icon-visual-description.ts [--staging] [--dry-run]
 */

import dotenv from 'dotenv';
import { DB_COLLECTION_INGREDIENTS } from '../lib/config';

const args = process.argv.slice(2);
const staging = args.includes('--staging');
const dryRun = args.includes('--dry-run');

if (staging) {
    console.log('✨ Switching to STAGING environment (.env.staging)...');
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    dotenv.config({ path: '.env.staging', override: true });
} else {
    dotenv.config();
}

if (dryRun) console.log('DRY RUN — no writes will be made.\n');

async function main() {
    const { db } = await import('../lib/firebase-admin');

    let docsScanned = 0;
    let docsUpdated = 0;
    let iconsFixed = 0;

    let query = db.collection(DB_COLLECTION_INGREDIENTS).limit(200);
    let lastDoc: FirebaseFirestore.DocumentSnapshot | null = null;

    while (true) {
        const snap = lastDoc ? await query.startAfter(lastDoc).get() : await query.get();
        if (snap.empty) break;

        for (const doc of snap.docs) {
            docsScanned++;
            const icons: any[] = doc.data()?.icons || [];
            let changed = false;

            const updated = icons.map(icon => {
                if (!icon.visualDescription) {
                    console.log(`  Fixing: "${doc.id}" icon ${icon.id}`);
                    iconsFixed++;
                    changed = true;
                    return { ...icon, visualDescription: doc.id };
                }
                return icon;
            });

            if (changed && !dryRun) {
                await doc.ref.update({ icons: updated });
                docsUpdated++;
            } else if (changed) {
                docsUpdated++;
            }
        }

        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.size < 200) break;
    }

    console.log(`\nScanned ${docsScanned} docs. Fixed ${iconsFixed} icons across ${docsUpdated} docs.${dryRun ? ' (dry run)' : ''}`);
}

main().catch(e => {
    console.error('Script failed:', e);
    process.exit(1);
});
