
import 'dotenv/config';
import { db } from '../lib/firebase-admin';

async function check() {
  try {
      const snapshot = await db.collection('ingredients_new').limit(1).get();
      if (snapshot.empty) {
        console.log('No ingredients found.');
        return;
      }
      console.log('JSON_START: ' + JSON.stringify(snapshot.docs[0].data()) + ' :JSON_END');
  } catch (e: any) {
      console.error('Failed to check ingredients:', e);
  }
}
check();
