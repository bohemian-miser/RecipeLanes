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

import dotenv from 'dotenv';
import { standardizeIngredientName } from '../lib/utils';

async function checkIcon() {
    dotenv.config(); // Uses .env (Prod)
    const { db, storage } = await import('../lib/firebase-admin');

    const iconId = process.argv[2];
    if (!iconId) {
        console.error('Usage: npx tsx scripts/check-icon.ts <ICON_ID>');
        process.exit(1);
    }

    console.log(`Checking Icon ID: ${iconId}`);

    // 1. Search in Ingredients
    const snapshot = await db.collection('ingredients').get();
    let found = false;
    let foundUrl = '';
    let foundPath = '';

    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.icons) {
            const match = data.icons.find((i: any) => i.id === iconId);
            if (match) {
                console.log(`✅ Found in Ingredient: "${doc.id}"`);
                console.log('  Data:', JSON.stringify(match, null, 2));
                found = true;
                foundUrl = match.url;
                foundPath = match.path;
            }
        }
    });

    if (!found) {
        console.error('❌ Icon NOT found in Firestore (ingredients collection).');
    }

    // 2. Check Storage
    if (foundPath) {
        console.log(`Checking Storage Path: ${foundPath}`);
        const bucket = storage.bucket(); // Default bucket
        const file = bucket.file(foundPath);
        const [exists] = await file.exists();
        
        if (exists) {
            console.log('✅ File EXISTS in Storage.');
            const [metadata] = await file.getMetadata();
            console.log('  ContentType:', metadata.contentType);
            console.log('  Size:', metadata.size);
            console.log('  Public:', metadata.acl ? 'ACL Found' : 'No ACL info');
        } else {
            console.error('❌ File MISSING in Storage.');
            
            // Check case sensitivity?
            // Try lowercase path
            const lowerPath = foundPath.toLowerCase();
            if (lowerPath !== foundPath) {
                 console.log(`Checking lowercase path: ${lowerPath}`);
                 const [existsLower] = await bucket.file(lowerPath).exists();
                 if (existsLower) console.log('  ✅ Found at lowercase path! Case mismatch.');
            }
        }
    } else if (foundUrl) {
        console.log(`Cannot check storage: No 'path' in DB record, only URL: ${foundUrl}`);
    }
}

checkIcon().catch(console.error);