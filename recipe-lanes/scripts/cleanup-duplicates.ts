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
dotenv.config();

async function run() {
  const args = process.argv.slice(2);
  const stagingIndex = args.indexOf('--staging');
  
  if (stagingIndex !== -1) {
      console.log('✨ Switching to STAGING environment (.env.staging)...');
      dotenv.config({ path: '.env.staging', override: true });
      // Remove flag
      args.splice(stagingIndex, 1);
  }

  // Dynamic import to ensure env vars are set first
  const { db } = await import('../lib/firebase-admin');

  async function cleanupDuplicates() {
    const targetTitle = args[0]; // Use filtered args
    if (!targetTitle || targetTitle.startsWith('--')) {
        console.error("Usage: npx tsx scripts/cleanup-duplicates.ts \"Recipe Title\" [--force] [--staging]");
        process.exit(1);
    }
    
    const isDryRun = !args.includes('--force');

    console.log(`=== Scanning for duplicate recipes with title: "${targetTitle}" ===`);
    if (isDryRun) console.log("DRY RUN MODE. Use --force to actually delete.");

    try {
        const snapshot = await db.collection('recipes').get();
        const matches: any[] = [];

        for (const doc of snapshot.docs) {
            const data = doc.data();
            // Check top-level title and graph title
            const topTitle = data.title || '';
            const graphTitle = data.graph?.title || '';
            
            if (topTitle.trim().toLowerCase() === targetTitle.trim().toLowerCase() || 
                graphTitle.trim().toLowerCase() === targetTitle.trim().toLowerCase()) {
                
                matches.push({ 
                    id: doc.id, 
                    created_at: data.created_at?.toDate ? data.created_at.toDate() : new Date(0), 
                    title: topTitle || graphTitle 
                });
            }
        }

        console.log(`Found ${matches.length} recipes matching "${targetTitle}".`);

        if (matches.length <= 1) {
            console.log("No duplicates found.");
            return;
        }

        // Sort by creation time (oldest first)
        matches.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());

        // Keep the oldest one
        const toKeep = matches[0];
        const toDelete = matches.slice(1);

        console.log(`Keeping original: ${toKeep.id} (Title: "${toKeep.title}", Created: ${toKeep.created_at})`);
        console.log(`Found ${toDelete.length} duplicates to delete.`);

        if (!isDryRun) {
            console.log("Deleting...");
        }

        for (const doc of toDelete) {
            console.log(` - ${isDryRun ? '[DRY RUN] Would delete' : 'Deleting'} ${doc.id} (Created: ${doc.created_at})`);
            if (!isDryRun) {
                await db.collection('recipes').doc(doc.id).delete();
            }
        }

        if (isDryRun) {
            console.log("\n[DRY RUN] No changes made. Run with --force to execute.");
        } else {
            console.log("\nCleanup Complete.");
        }

    } catch (e) {
        console.error("Cleanup failed:", e);
    }
  }

  await cleanupDuplicates();
}

run();