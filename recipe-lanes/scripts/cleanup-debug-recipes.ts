
import 'dotenv/config';
import dotenv from 'dotenv';
import { db } from '../lib/firebase-admin';

const DB_COLLECTION_RECIPES = 'recipes';

async function cleanupDebugRecipes() {
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

    console.log(`Cleaning up debug recipes from ${DB_COLLECTION_RECIPES}...`);

    try {
        const snapshot = await db.collection(DB_COLLECTION_RECIPES)
            .where('title', '==', 'debug recipe')
            .get();
        
        if (snapshot.empty) {
            console.log('No debug recipes found.');
            return;
        }

        console.log(`Found ${snapshot.size} debug recipes.`);

        for (const doc of snapshot.docs) {
            console.log(` - Deleting ID: ${doc.id}`);
            if (!isDryRun) {
                await doc.ref.delete();
            }
        }

        if (!isDryRun) {
            console.log(`✅ Successfully deleted ${snapshot.size} recipes.`);
        } else {
            console.log('🧪 Dry run complete. No deletions performed.');
        }

    } catch (e: any) {
        console.error('Failed to cleanup debug recipes:', e);
    }
}

cleanupDebugRecipes();
