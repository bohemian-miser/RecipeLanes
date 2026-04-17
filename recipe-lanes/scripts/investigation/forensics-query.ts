
import 'dotenv/config';
import { db } from '../lib/firebase-admin';
const DB_COLLECTION_QUEUE = 'icon_queue';
const DB_COLLECTION_RECIPES = 'recipes';

async function forensicQuery() {
  console.log('Querying failed items in icon_queue and checking recipes...');
  try {
      const snapshot = await db.collection(DB_COLLECTION_QUEUE)
        .where('status', '==', 'failed')
        .get();
      
      if (snapshot.empty) {
          console.log('No failed items found in icon_queue.');
          return;
      }

      for (const doc of snapshot.docs) {
          const data = doc.data();
          const recipes = data.recipes || [];
          const existence: Record<string, boolean> = {};
          
          for (const rId of recipes) {
              const rDoc = await db.collection(DB_COLLECTION_RECIPES).doc(rId).get();
              existence[rId] = rDoc.exists;
          }

          console.log(`JSON_START: ${JSON.stringify({id: doc.id, error: data.error, existence})} :JSON_END`);
      }
  } catch (e: any) {
      console.error('Failed to query queue:', e);
  }
}

forensicQuery();
