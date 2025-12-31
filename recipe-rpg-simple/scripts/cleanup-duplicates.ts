import 'dotenv/config';
import { db } from '../lib/firebase-admin';

async function cleanupDuplicates() {
  const targetTitle = process.argv[2];
  if (!targetTitle || targetTitle.startsWith('--')) {
      console.error("Usage: npx tsx scripts/cleanup-duplicates.ts \"Recipe Title\" [--force]");
      process.exit(1);
  }
  
  const isDryRun = !process.argv.includes('--force');

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

cleanupDuplicates();
