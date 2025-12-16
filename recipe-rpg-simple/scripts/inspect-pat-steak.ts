import 'dotenv/config';
import { db, storage } from '../lib/firebase-admin';

async function inspectPatSteak() {
  const target = "pat steak dry";
  console.log(`=== Inspecting "${target}" ===`);

  try {
    const bucket = storage.bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'ropgcp.firebasestorage.app');
    
    // 1. Find Ingredient Docs (Case Insensitive Scan)
    const ingSnapshot = await db.collection('ingredients').get();
    const matchingDocs = ingSnapshot.docs.filter(d => d.data().name.toLowerCase() === target.toLowerCase());

    console.log(`Found ${matchingDocs.length} ingredient groups.`);

    for (const doc of matchingDocs) {
        console.log(`
[Group] ID: ${doc.id} | Name: "${doc.data().name}"`);
        
        const iconsSnap = await doc.ref.collection('icons').get();
        console.log(`  - Icons: ${iconsSnap.size}`);

        for (const iconDoc of iconsSnap.docs) {
            const data = iconDoc.data();
            const url = data.url;
            console.log(`    - Icon ID: ${iconDoc.id}`);
            console.log(`      URL: ${url}`);
            
            // Check Storage
            const matches = url.match(new RegExp("/o/([^?]+)"));
            if (matches && matches[1]) {
                const filePath = decodeURIComponent(matches[1]);
                const [exists] = await bucket.file(filePath).exists();
                console.log(`      File Exists: ${exists} (Path: ${filePath})`);
                
                if (!exists) {
                    console.log("      *** ZOMBIE DETECTED ***");
                    // Optionally delete? Let's just list for now.
                }
            } else {
                console.log("      *** INVALID URL FORMAT ***");
            }
        }
    }

  } catch (e) {
      console.error(e);
  }
}

inspectPatSteak();
