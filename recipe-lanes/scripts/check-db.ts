import 'dotenv/config';
import { db } from '../lib/firebase-admin';

async function checkIngredients() {
  console.log('Listing all ingredients...');
  try {
      const snapshot = await db.collection('ingredients').get();
      
      if (snapshot.empty) {
          console.log('No ingredients found in Firestore.');
          return;
      }

      snapshot.docs.forEach(doc => {
          console.log(` - ID: ${doc.id}, Name: "${doc.data().name}"`);
      });
  } catch (e: any) {
      const errString = String(e);
      if (errString.includes('invalid_grant') || errString.includes('invalid_rapt')) {
          console.warn('Warning: Could not connect to Cloud Firestore due to missing or invalid credentials.');
          console.warn('Note: The application is currently running in "fallback mode" using an in-memory store.');
          console.warn('      Since this script runs as a separate process, the in-memory store is empty here.');
      } else {
          console.error('Failed to list ingredients:', e);
      }
  }
}

checkIngredients();
