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
import { db } from '../lib/firebase-admin';

async function backfillNames() {
    const args = process.argv.slice(2);
    const stagingIndex = args.indexOf('--staging');
    const isDryRun = args.includes('--dry-run');
    
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

    console.log(`Starting Owner Name Backfill... ${isDryRun ? '(DRY RUN)' : ''}`);
    
    const recipesSnapshot = await db.collection('recipes').get();
    console.log(`Found ${recipesSnapshot.size} recipes.`);

    let updatedCount = 0;
    let skippedCount = 0;
    let missingUserCount = 0;
    
    // Cache user names to avoid repeated lookups
    const userCache = new Map<string, string | null>();

    console.log('Fetching all users...');
    const usersSnapshot = await db.collection('users').get();
    console.log(`Found ${usersSnapshot.size} users.`);
    
    usersSnapshot.forEach(doc => {
        const data = doc.data();
        const name = data.name || data.displayName || null;
        userCache.set(doc.id, name);
    });

    console.log('User Map:', Object.fromEntries(userCache));

    const batchSize = 400;
    let batch = db.batch();
    let opCount = 0;

    const missingIds = new Set<string>();

    for (const doc of recipesSnapshot.docs) {
        const data = doc.data();
        
        // Skip if already has name or no owner
        if (data.ownerName || !data.ownerId) {
            skippedCount++;
            continue;
        }

        const ownerId = data.ownerId;
        const ownerName = userCache.get(ownerId);

        if (ownerName) {
            console.log(`[Update] Recipe ${doc.id}: ownerId ${ownerId} -> "${ownerName}"`);
            if (!isDryRun) {
                batch.update(doc.ref, { ownerName: ownerName });
                opCount++;
            }
            updatedCount++;
        } else {
            console.log(`[MissingUser] Recipe ${doc.id}: User ${ownerId} not found in user map.`);
            missingUserCount++;
            missingIds.add(ownerId);
        }

        if (!isDryRun && opCount >= batchSize) {
            console.log(`Committing batch of ${opCount}...`);
            await batch.commit();
            batch = db.batch();
            opCount = 0;
        }
    }

    if (!isDryRun && opCount > 0) {
        console.log(`Committing final batch of ${opCount}...`);
        await batch.commit();
    }

    console.log(`-----------------------------------`);
    console.log(`Backfill Complete.`);
    console.log(`Updated: ${updatedCount}`);
    console.log(`Skipped (Already Set/No Owner): ${skippedCount}`);
    console.log(`Missing User Data: ${missingUserCount}`);
    console.log(`Unique Missing Owner IDs:`, Array.from(missingIds));
    console.log(`-----------------------------------`);
}

backfillNames().catch(console.error);