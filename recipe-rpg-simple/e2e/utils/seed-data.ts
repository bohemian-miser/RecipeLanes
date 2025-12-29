import * as fs from 'fs';
import * as path from 'path';
import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';
import 'dotenv/config';

const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'recipe-lanes.firebasestorage.app';

// Initialize Admin SDK if not already
if (!admin.apps.length) {
    admin.initializeApp({
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'recipe-lanes',
        storageBucket: bucketName
    });
}

const db = admin.firestore();
const storage = admin.storage();

export async function seedCommonIngredients() {
    console.log('Seeding common ingredients (Eggs, Flour) from local assets...');
    
    // map names to filenames
    const assets: Record<string, string> = {
        'Eggs': 'egg.png',
        'Flour': 'flour.png'
    };
    
    for (const [name, filename] of Object.entries(assets)) {
        // 1. Create Ingredient Group
        const ingRef = db.collection('ingredients');
        const q = await ingRef.where('name', '==', name.toLowerCase()).get();
        let docId;
        
        if (q.empty) {
            const doc = await ingRef.add({ name: name.toLowerCase(), created_at: new Date() });
            docId = doc.id;
        } else {
            docId = q.docs[0].id;
        }
        
        // 2. Check/Create Icon
        const iconsRef = db.collection(`ingredients/${docId}/icons`);
        const iconSnap = await iconsRef.get();
        
        if (iconSnap.empty) {
            console.log(`Uploading local icon for ${name}...`);
            
            const filePath = path.join(process.cwd(), 'e2e/data', filename);
            const buffer = fs.readFileSync(filePath);
            
            const bucket = storage.bucket(bucketName);
            const fileName = `icons/seed-${name}-${Date.now()}.png`;
            const file = bucket.file(fileName);
            const token = randomUUID();
            
            const metadata = {
                lcb: '10',
                impressions: '0',
                rejections: '0',
                firebaseStorageDownloadTokens: token
            };

            await file.save(buffer, {
                metadata: { 
                    contentType: 'image/png',
                    metadata: metadata
                }
            });
            
            // Construct URL manually to ensure it uses the emulator host and token if applicable, 
            // or standard Firebase format which the emulator intercepts.
            // Using the standard format with token is safest for "real" simulation.
            // const bucketName = bucket.name; // Use the const we defined
            const publicUrl = `http://127.0.0.1:9199/v0/b/${bucketName}/o/${encodeURIComponent(fileName)}?alt=media&token=${token}`;
            
            await iconsRef.add({
                url: publicUrl,
                fullPrompt: `Seeded icon for ${name}`,
                visualDescription: name,
                popularity_score: 10.0, 
                created_at: new Date(),
                marked_for_deletion: false
            });
            console.log(`Seeded ${name} icon: ${publicUrl}`);
        }
    }
}