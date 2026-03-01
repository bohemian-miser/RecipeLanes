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

import * as fs from 'fs';
import * as path from 'path';
import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';
import 'dotenv/config';

const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'local-project-id.firebasestorage.app';

// Initialize Admin SDK if not already
if (!admin.apps.length) {
    admin.initializeApp({
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "local-project-id",
        storageBucket: bucketName
    });
}

const db = admin.firestore();
const storage = admin.storage();

export async function seedCommonIngredients() {
    console.log('Seeding common ingredients (Eggs, Flour) from local assets...');
    
    // map names to filenames
    const assets: Record<string, string> = {
        'Egg': 'Egg.png',
        'Flour': 'Flour.png'
    };
    
    for (const [name, filename] of Object.entries(assets)) {
        // Unified Schema: Document ID is the Name (Title Case)
        const docId = name;
        const docRef = db.collection('ingredients_new').doc(docId);
        const doc = await docRef.get();
        
        const existingData = doc.data() || {};
        const existingIcons = existingData.icons || [];
        
        // Check if seeded icon already exists
        const hasSeeded = existingIcons.some((i: any) => i.url && i.url.includes('seed-'));
        
        if (!hasSeeded) {
            console.log(`Uploading local icon for ${name}...`);
            
            const filePath = path.join(process.cwd(), 'e2e/test_data/icons/', filename);
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
            
            const publicUrl = `http://127.0.0.1:9199/v0/b/${bucketName}/o/${encodeURIComponent(fileName)}?alt=media&token=${token}`;
            
            const newIcon = {
                id: `seed-${name}-${token.substring(0, 8)}`,
                url: publicUrl,
                fullPrompt: `Seeded icon for ${name}`,
                visualDescription: name,
                popularity_score: 10.0,
                score: 10.0,
                impressions: 0,
                rejections: 0,
                created_at: new Date(),
                marked_for_deletion: false
            };

            await docRef.set({
                name: name.toLowerCase(),
                created_at: existingData.created_at || new Date(),
                icons: admin.firestore.FieldValue.arrayUnion(newIcon)
            }, { merge: true });
            
            console.log(`Seeded ${name} icon: ${publicUrl}`);
        }
    }
}