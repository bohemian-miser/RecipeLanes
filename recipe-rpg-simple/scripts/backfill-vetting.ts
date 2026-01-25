import dotenv from 'dotenv';
import { FieldValue } from 'firebase-admin/firestore';

async function backfillVetting() {
    const args = process.argv.slice(2);
    const stagingIndex = args.indexOf('--staging');
    
    if (stagingIndex !== -1) {
        console.log('✨ Switching to STAGING environment (.env.staging)...');
        // Clear conflicting env vars if any
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        dotenv.config({ path: '.env.staging', override: true });
    } else {
        dotenv.config();
    }

    // Import after env vars are set
    const { db } = await import('../lib/firebase-admin');
    const isDryRun = args.includes('--dry-run');

    console.log(`Starting Vetting Backfill... ${isDryRun ? '(Dry Run)' : ''}`);

    const snapshot = await db.collection('recipes').get();
    console.log(`Found ${snapshot.size} recipes.`);

    let batch = db.batch();
    let opCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        
        // Check if isVetted is missing (undefined)
        // Note: In Firestore data, missing field is undefined.
        if (data.isVetted === undefined) {
            if (isDryRun) {
                console.log(`[DryRun] Would set isVetted=false for ${doc.id} (${data.title})`);
            } else {
                batch.update(doc.ref, { isVetted: false });
                opCount++;
            }
            updatedCount++;
        } else {
            skippedCount++;
        }

        if (opCount >= 400) {
            await batch.commit();
            console.log(`Committed batch...`);
            batch = db.batch();
            opCount = 0;
        }
    }

    if (!isDryRun && opCount > 0) {
        await batch.commit();
        console.log(`Committed final batch.`);
    }

    console.log(`-----------------------------------`);
    console.log(`Backfill Complete.`);
    console.log(`Updated: ${updatedCount}`);
    console.log(`Skipped (Already set): ${skippedCount}`);
    console.log(`-----------------------------------`);
}

backfillVetting().catch(console.error);
