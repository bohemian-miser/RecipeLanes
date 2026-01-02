import { db, storage } from '../lib/firebase-admin';
import { processIcon } from '../functions/src/image-processing';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';

async function reprocessIcons() {
    const args = process.argv.slice(2);
    const nIndex = args.indexOf('-n');
    let limit = 0;
    if (nIndex !== -1 && args[nIndex + 1]) {
        limit = parseInt(args[nIndex + 1], 10);
    }
    const isDryRun = args.includes('--dry-run');

    console.log(`Starting icon reprocessing... ${limit > 0 ? `(Limit: ${limit} random)` : '(All)'} ${isDryRun ? '(Dry Run)' : ''}`);
    
    // Create debug directory
    const debugDir = path.join(process.cwd(), 'debug', 'reprocess-examples');
    await fs.mkdir(debugDir, { recursive: true });
    console.log(`Saving examples to: ${debugDir}`);

    // 1. Get all icons
    const snapshot = await db.collectionGroup('icons').get();
    let docs = snapshot.docs;
    console.log(`Found ${docs.length} total icons.`);

    if (limit > 0) {
        // Shuffle
        for (let i = docs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [docs[i], docs[j]] = [docs[j], docs[i]];
        }
        docs = docs.slice(0, limit);
        console.log(`Selected ${docs.length} random icons.`);
    }

    for (const doc of docs) {
        const data = doc.data();
        const url = data.url;
        
        if (!url) {
            console.log(`Skipping ${doc.id} (no url)`);
            continue;
        }

        // Optional: Skip if already processed, unless force checking
        // if (data.processed_transparent) { ... }
        
        console.log(`Processing ${doc.id} (${data.ingredient_name || 'unknown'})...`);

        try {
            // 2. Download
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            
            // Save Original
            await fs.writeFile(path.join(debugDir, `${doc.id}_original.png`), buffer);

            // 3. Process with Shared Logic
            // Note: processIcon expects ArrayBuffer, Buffer is compatible-ish or we convert
            const newBuffer = await processIcon(buffer);

            // Save Processed
            await fs.writeFile(path.join(debugDir, `${doc.id}_processed.png`), newBuffer);

            // 4. Upload (Overwrite)
            if (!isDryRun) {
                // Extract path from URL
                // https://firebasestorage.googleapis.com/v0/b/BUCKET/o/PATH?alt=media&token=TOKEN
                const matches = url.match(/\/o\/([^?]+)/);
                if (!matches) {
                    console.warn('Could not parse path from URL', url);
                    continue;
                }
                
                const filePath = decodeURIComponent(matches[1]);
                const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'recipe-lanes.firebasestorage.app';
                const bucket = storage.bucket(bucketName);
                const file = bucket.file(filePath);

                await file.save(newBuffer, {
                    metadata: { contentType: 'image/png' }
                });
                
                // Mark as processed
                await doc.ref.update({ processed_transparent: true });
                console.log(`Done ${doc.id} (Uploaded)`);
            } else {
                console.log(`Done ${doc.id} (Saved local only)`);
            }

        } catch (e) {
            console.error(`Failed to process ${doc.id}:`, e);
        }
    }
    console.log('Reprocessing complete.');
}

// Run
reprocessIcons().catch(console.error);
