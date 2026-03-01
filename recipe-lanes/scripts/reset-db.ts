import 'dotenv/config';
import { db, storage } from '../lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

// Wilson Score Interval (Lower Confidence Bound) - Copy of logic
function calculateWilsonLCB(n: number, r: number): number {
  if (n === 0) return 0;
  const k = n - r;
  const p = k / n;
  const z = 1.645; // 95% confidence (one-sided) 
  
  const den = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const adj = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  
  const lcb = (centre - adj) / den;
  return Math.max(0, lcb);
}

async function deleteCollection(collectionPath: string) {
  const collectionRef = db.collection(collectionPath);
  const query = collectionRef.orderBy('__name__').limit(500);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(db, query, resolve).catch(reject);
  });
}

async function deleteQueryBatch(db: any, query: any, resolve: any) {
  const snapshot = await query.get();

  const batchSize = snapshot.size;
  if (batchSize === 0) {
    resolve();
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc: any) => {
    batch.delete(doc.ref);
  });
  await batch.commit();

  process.nextTick(() => {
    deleteQueryBatch(db, query, resolve);
  });
}

async function resetAndSync() {
  console.log('!!! WARNING: This will DELETE all Firestore metadata !!!');
  console.log('...keeping images in Storage safe...');
  
  // 1. Delete Ingredients (and recursively their subcollections if using recursive delete, but here we do simple)
  // Actually, icons are subcollections. Deleting parent doc in Firestore DOES NOT delete subcollections.
  // We must delete 'icons' collection group first to be thorough.
  
  console.log('Deleting all icons records...');
  const iconSnapshot = await db.collectionGroup('icons').get();
  const iconBatch = db.batch();
  iconSnapshot.docs.forEach(doc => iconBatch.delete(doc.ref));
  await iconBatch.commit();
  console.log(`Deleted ${iconSnapshot.size} icon records.`);

  console.log('Deleting all ingredients records...');
  const ingSnapshot = await db.collection('ingredients').get();
  const ingBatch = db.batch();
  ingSnapshot.docs.forEach(doc => ingBatch.delete(doc.ref));
  await ingBatch.commit();
  console.log(`Deleted ${ingSnapshot.size} ingredient records.`);

  // 2. Rescan Storage
  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'recipe-lanes.firebasestorage.app';
  console.log(`
Rescanning bucket: ${bucketName}`);
  const bucket = storage.bucket(bucketName);
  const [files] = await bucket.getFiles({ prefix: 'icons/' });

  console.log(`Found ${files.length} files. Re-indexing...`);

  const initialN = 1;
  const initialR = 0;
  const initialLcb = calculateWilsonLCB(initialN, initialR);

  for (const file of files) {
    if (!file.name.endsWith('.png')) continue;

    // Parse: icons/Ingredient-Name-123.png
    const basename = file.name.split('/').pop() || '';
    const nameWithoutExt = basename.replace('.png', '');
    const parts = nameWithoutExt.split('-');
    const timestampStr = parts.pop(); // Remove timestamp
    
    // Check if timestamp is valid, if not, put it back (maybe it wasn't a timestamp)
    // But our format is strict.
    
    const ingredientSlug = parts.join('-');
    const ingredientName = ingredientSlug.replace(/-/g, ' ');

    if (!ingredientName) continue;

    const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(file.name)}?alt=media`;

    // 3. Reset Storage Metadata (Clean Slate)
    try {
        await file.setMetadata({
            metadata: {
                impressions: String(initialN),
                rejections: String(initialR),
                lcb: String(initialLcb),
                popularityScore: null // Clear old field if possible, or just overwrite
            }
        });
    } catch (e) {
        console.warn(`Failed to update metadata for ${basename}:`, e);
    }

    // 4. Create Ingredient (if needed)
    // We can't do optimal batching easily here without complex logic, so we'll query/write.
    const ingQuery = await db.collection('ingredients').where('name', '==', ingredientName).limit(1).get();
    let ingRef;

    if (ingQuery.empty) {
        const newIng = await db.collection('ingredients').add({
            name: ingredientName,
            embedding: [],
            created_at: FieldValue.serverTimestamp()
        });
        ingRef = newIng;
        console.log(`Created Ingredient: ${ingredientName}`);
    } else {
        ingRef = ingQuery.docs[0].ref;
    }

    // 5. Create Icon Record
    await ingRef.collection('icons').add({
        url: publicUrl,
        impressions: initialN,
        rejections: initialR,
        popularity_score: initialLcb, // For UI sorting
        ingredient_name: ingredientName,
        created_at: FieldValue.serverTimestamp(),
        marked_for_deletion: false
    });
    // console.log(` + Added Icon for ${ingredientName}`);
  }
  
  console.log('\nReset and Sync Complete!');
}

resetAndSync();
