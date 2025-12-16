import 'dotenv/config';
import { db, storage } from '../lib/firebase-admin';

async function cleanupZombies() {
  console.log("=== Scanning for Zombies (Firestore records without Storage files) ===");
  
  try {
    // 1. Get all Storage Files
    const bucket = storage.bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'ropgcp.firebasestorage.app');
    const [files] = await bucket.getFiles({ prefix: 'icons/' });
    const storageUrls = new Set(files.map(f => f.name));
    
    console.log(`Found ${storageUrls.size} files in Storage.`);

    // 2. Scan Firestore
    const ingredientsSnap = await db.collection('ingredients').get();
    let zombieCount = 0;

    for (const ingDoc of ingredientsSnap.docs) {
        const name = ingDoc.data().name;
        const iconsSnap = await ingDoc.ref.collection('icons').get();
        
        for (const iconDoc of iconsSnap.docs) {
            const data = iconDoc.data();
            const url = data.url || "";
            
            const matches = url.match(/\/o\/([^?]+)/);
            if (matches && matches[1]) {
                const fileName = decodeURIComponent(matches[1]);
                
                if (!storageUrls.has(fileName)) {
                    console.log(`[ZOMBIE FOUND] Ingredient: "${name}" | ID: ${iconDoc.id}`);
                    console.log(`   - Missing File: ${fileName}`);
                    try {
                        await iconDoc.ref.delete();
                        console.log(`   - Deleted Firestore Record.`);
                        zombieCount++;
                    } catch (err) {
                        console.error(`   - Failed to delete: ${err}`);
                    }
                }
            }
        }
    }

    console.log(`\nCleanup Complete. Removed ${zombieCount} zombie records.`);

  } catch (e) {
      console.error("Cleanup failed:", e);
  }
}

cleanupZombies();
