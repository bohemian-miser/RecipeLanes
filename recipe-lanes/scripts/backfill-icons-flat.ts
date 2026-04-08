/**
 * Backfill script to flatten icons from `ingredients_new` into `icon_index`.
 * 
 * Usage:
 *   npx tsx scripts/backfill-icons-flat.ts [--dry-run]
 */

import dotenv from 'dotenv';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { DB_COLLECTION_INGREDIENTS, DB_COLLECTION_ICON_INDEX } from '../lib/config';
import { createAuditor } from './lib/db-tools';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const STAGING = args.includes('--staging');

if (STAGING) {
    console.log('✨ Switching to STAGING environment (.env.staging)...');
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    dotenv.config({ path: '.env.staging', override: true });
} else {
    dotenv.config();
}

async function main() {
    if (!admin.apps.length) {
        admin.initializeApp();
    }
    const db = admin.firestore();

    console.log(`Starting Flat Icon Migration... ${DRY_RUN ? '(DRY RUN)' : ''}`);

    const ingredientsSnap = await db.collection(DB_COLLECTION_INGREDIENTS).get();
    console.log(`Found ${ingredientsSnap.size} ingredients.`);

    const auditor = createAuditor('IngredientDoc icons[]', {
        'id': (v) => typeof v === 'string' || 'missing id',
        'visualDescription': (v) => typeof v === 'string' || 'missing visualDescription',
    });

    let opCount = 0;
    let batch = db.batch();
    const BATCH_SIZE = 400;

    for (const doc of ingredientsSnap.docs) {
        const data = doc.data();
        const icons: any[] = data.icons || [];
        
        for (const icon of icons) {
            if (!icon.id) continue;
            
            auditor.check(icon.id, icon);

            // We want to write this to icon_index
            const iconRef = db.collection(DB_COLLECTION_ICON_INDEX).doc(icon.id);
            
            if (DRY_RUN) {
                console.log(`[DryRun] Would write icon ${icon.id} for ${data.name || doc.id}`);
                continue;
            }

            // We are keeping the existing embedding if it's there, so we use merge: true
            // Ensure all icon stats are placed at the root level of the doc
            batch.set(iconRef, {
                ...icon, // id, visualDescription, score, impressions, rejections, metadata, searchTerms
                created_at: icon.created_at || FieldValue.serverTimestamp(),
                updated_at: FieldValue.serverTimestamp()
            }, { merge: true });

            opCount++;

            if (opCount >= BATCH_SIZE) {
                await batch.commit();
                console.log(`Committed ${opCount} icons...`);
                batch = db.batch();
                opCount = 0;
            }
        }
    }

    if (!DRY_RUN && opCount > 0) {
        await batch.commit();
        console.log(`Committed final ${opCount} icons.`);
    }

    auditor.report();
    console.log('Done.');
    process.exit(0);
}

main().catch(console.error);