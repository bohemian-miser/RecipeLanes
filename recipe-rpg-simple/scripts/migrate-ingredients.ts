import dotenv from 'dotenv';
import { FieldValue } from 'firebase-admin/firestore';

async function migrateIngredients() {
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

    const { db, storage } = await import('../lib/firebase-admin');
    const isDryRun = args.includes('--dry-run');
    const isForce = args.includes('--force');
    
    // Bucket configuration
    const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'recipe-lanes.firebasestorage.app';
    const bucket = storage.bucket(bucketName);

    console.log(`Starting Ingredient Migration... ${isDryRun ? '(Dry Run)' : ''} ${isForce ? '(Force)' : ''}`);

    const snapshot = await db.collection('ingredients').get();
    console.log(`Found ${snapshot.size} ingredient documents.`);

    let migratedCount = 0;
    const batchSize = 50; // Reduced to avoid limit (50 ingredients * ~5 icons + writes)
    let batch = db.batch();
    let opCount = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        if (!isForce && (data.cache || data.migrated_to)) {
            continue;
        }

        const rawName = data.name || 'Unknown';
        const stdName = rawName.trim().split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        
        const iconsSnap = await doc.ref.collection('icons').get();
        const icons = iconsSnap.docs.map(d => ({
            id: d.id,
            ...d.data()
        }));

        const cache = [];
        for (const i of icons) {
            // Target: icons/Title-Kebab-Case-ShortID.png
            const kebabName = stdName.replace(/\s+/g, '-');
            const shortId = i.id.substring(0, 8);
            const destPath = `icons/${kebabName}-${shortId}.png`;
            
            let srcPath = '';
            
            if (i.url) {
                // Try Standard Firebase /o/ pattern
                let match = i.url.match(/\/o\/([^?]+)/);
                if (match) {
                    srcPath = decodeURIComponent(match[1]);
                } else {
                    // Try matching known folder "icons/" encoded
                    match = i.url.match(/(icons%2F[^?]+)/);
                    if (match) {
                        srcPath = decodeURIComponent(match[1]);
                    } else {
                        // Try matching known folder "icons/" unencoded?
                        match = i.url.match(/(icons\/[^?]+)/);
                        if (match) {
                            srcPath = match[1];
                        } else {
                            console.warn(`[ParseError] Could not extract path from: ${i.url}`);
                        }
                    }
                }
            }

            if (!srcPath) {
                console.warn(`Skipping icon ${i.id} - Could not parse URL: ${i.url}`);
                continue;
            }

            if (srcPath && srcPath !== destPath) {
                if (isDryRun) {
                    console.log(`[DryRun] Would copy ${srcPath} -> ${destPath}`);
                } else {
                    try {
                        const file = bucket.file(srcPath);
                        const [exists] = await file.exists();
                        if (exists) {
                            await file.copy(bucket.file(destPath));
                        } else {
                            console.warn(`Source file missing: ${srcPath} for icon ${i.id}`);
                        }
                    } catch (e) {
                        console.error(`Failed to copy ${srcPath}:`, e);
                    }
                }
            }

            cache.push({
                id: i.id,
                path: destPath, // Storing path allows reconstruction
                shortId: shortId, // Explicitly store shortId if needed
                score: i.popularity_score || 0,
                impressions: i.impressions || 0,
                rejections: i.rejections || 0,
                visualDescription: i.visualDescription || i.ingredient_name,
                created_at: i.created_at,
                fullPrompt: i.fullPrompt
            });
        }

        const newDocData = {
            name: stdName,
            created_at: data.created_at || FieldValue.serverTimestamp(),
            updated_at: FieldValue.serverTimestamp(),
            migrated_from: doc.id,
            cache: cache
        };

        if (isDryRun) {
            console.log(`[DryRun] Would migrate "${rawName}" -> "ingredients_new/${stdName}" (${doc.id}) with ${cache.length} icons.`);
        } else {
            const newRef = db.collection('ingredients_new').doc(stdName);
            batch.set(newRef, newDocData, { merge: true });
            opCount++;
            
            // Also populate feed_icons
            for (const icon of cache) {
                 const feedRef = db.collection('feed_icons').doc(icon.id);
                 batch.set(feedRef, {
                     ...icon,
                     ingredientId: stdName
                 }, { merge: true });
                 opCount++;
            }

            batch.update(doc.ref, { migrated_to: stdName, migrated_at: FieldValue.serverTimestamp() });
            opCount++;

            if (opCount >= 400) { // Limit is 500
                await batch.commit();
                console.log(`Committed batch of ${opCount} operations.`);
                batch = db.batch();
                opCount = 0;
            }
        }
        migratedCount++;
    }

    if (!isDryRun && opCount > 0) {
        await batch.commit();
        console.log(`Committed final batch of ${opCount} operations.`);
    }

    console.log(`Migration Complete. Processed ${migratedCount} ingredients.`);
}

migrateIngredients().catch(console.error);
