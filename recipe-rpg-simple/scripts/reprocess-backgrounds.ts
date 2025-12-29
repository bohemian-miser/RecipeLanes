import { db, storage } from '../lib/firebase-admin';
import sharp from 'sharp';
import fetch from 'node-fetch';

async function reprocessIcons() {
    console.log('Starting icon reprocessing...');
    
    // 1. Get all icons
    const snapshot = await db.collectionGroup('icons').get();
    console.log(`Found ${snapshot.size} icons.`);

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const url = data.url;
        
        if (!url || data.processed_transparent) {
            console.log(`Skipping ${doc.id} (already processed or no url)`);
            continue;
        }
        
        console.log(`Processing ${doc.id} (${data.ingredient_name})...`);

        try {
            // 2. Download
            const response = await fetch(url);
            const buffer = await response.arrayBuffer();
            
            // 3. Process with Sharp
            const { data: rawData, info } = await sharp(Buffer.from(buffer))
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });

            // Replace white with transparent
            // Threshold for "White": > 240
            for (let i = 0; i < rawData.length; i += 4) {
                const r = rawData[i];
                const g = rawData[i + 1];
                const b = rawData[i + 2];
                
                if (r > 240 && g > 240 && b > 240) {
                    rawData[i + 3] = 0; // Alpha
                }
            }
            
            const newBuffer = await sharp(rawData, { 
                raw: { width: info.width, height: info.height, channels: 4 } 
            })
            .png()
            .toBuffer();

            // 4. Upload (Overwrite or New?)
            // We overwrite to keep URL valid if token allows, otherwise we update URL.
            // Firebase Storage URLs are persistent if we don't change the token, but upload usually resets it?
            // Actually, if we upload to the same path, the "downloadURL" might change token if we don't manage it.
            // But we can get a new signed URL or public URL.
            
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
            console.log(`Done ${doc.id}`);

        } catch (e) {
            console.error(`Failed to process ${doc.id}:`, e);
        }
    }
    console.log('Reprocessing complete.');
}

// Run
reprocessIcons().catch(console.error);
