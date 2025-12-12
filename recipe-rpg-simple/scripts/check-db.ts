import 'dotenv/config';
import { db } from './lib/firebase-admin';

async function checkIngredients() {
  console.log('Listing all ingredients...');
  const snapshot = await db.collection('ingredients').get();
  
  if (snapshot.empty) {
      console.log('No ingredients found.');
      return;
  }

  snapshot.docs.forEach(doc => {
      console.log(` - ID: ${doc.id}, Name: "${doc.data().name}"`);
  });
}

checkIngredients();
