
import 'dotenv/config';
import dotenv from 'dotenv';
import { db } from '../lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

const DB_COLLECTION_QUEUE = 'icon_queue';
const DB_COLLECTION_RECIPES = 'recipes';

async function repairQueue() {
    const args = process.argv.slice(2);
    const isStaging = args.includes('--staging');
    const isDryRun = args.includes('--dry-run');

    if (isStaging) {
        console.log('✨ Switching to STAGING environment (.env.staging)...');
        dotenv.config({ path: '.env.staging', override: true });
    }

    if (isDryRun) {
        console.log('🧪 DRY RUN MODE - No changes will be persisted.');
    }

    console.log(`Checking all items in ${DB_COLLECTION_QUEUE} for non-existent recipes...`);

    try {
        const snapshot = await db.collection(DB_COLLECTION_QUEUE).get();
        
        if (snapshot.empty) {
            console.log('Queue is empty.');
            return;
        }

        for (const queueDoc of snapshot.docs) {
            const data = queueDoc.data();
            const recipes = data.recipes || [];
            
            if (recipes.length === 0) {
                console.log(`[${queueDoc.id}] 🗑️ No recipes listed. ${isDryRun ? '[DRY RUN] Would delete' : 'Deleting queue item...'}`);
                if (!isDryRun) await queueDoc.ref.delete();
                continue;
            }

            const toRemove: string[] = [];
            for (const rId of recipes) {
                const rDoc = await db.collection(DB_COLLECTION_RECIPES).doc(rId).get();
                if (!rDoc.exists) {
                    toRemove.push(rId);
                }
            }

            const remainingCount = recipes.length - toRemove.length;

            if (remainingCount === 0) {
                console.log(`[${queueDoc.id}] 🗑️ All ${recipes.length} recipes non-existent. ${isDryRun ? '[DRY RUN] Would delete' : 'Deleting queue item...'}`);
                if (!isDryRun) await queueDoc.ref.delete();
            } else if (toRemove.length > 0) {
                console.log(`[${queueDoc.id}] 🔧 Found ${toRemove.length} non-existent recipes. ${isDryRun ? '[DRY RUN] Would update' : 'Updating queue item...'}`);
                if (!isDryRun) {
                    await queueDoc.ref.update({
                        recipes: FieldValue.arrayRemove(...toRemove),
                        recipeCount: remainingCount,
                        error: data.error // keep existing error if any
                    });
                }
            }
        }

        console.log('Repair process complete.');
    } catch (e: any) {
        console.error('Failed to repair queue:', e);
    }
}

repairQueue();
