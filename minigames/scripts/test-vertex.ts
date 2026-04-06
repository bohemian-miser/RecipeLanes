import { embedTextVertex } from '../src/lib/vertex';
import admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import fs from 'fs';

// Init Firebase
const serviceAccount = JSON.parse(fs.readFileSync('./staging-service-account.json', 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'recipe-lanes-staging',
  });
}

const db = admin.firestore();

async function run() {
  console.log('Testing vertex embed...');
  const { vector, timeMs } = await embedTextVertex('egg', 'text-embedding-004', 'us-central1');
  console.log(`Embed took ${timeMs}ms. Vector dim: ${vector.length}`);

  console.log('Testing search on icon_index...');
  const start = Date.now();
  try {
    const snap = await db.collection('icon_index')
      .findNearest('embedding', FieldValue.vector(vector), { limit: 5, distanceMeasure: 'COSINE' })
      .get();
    console.log(`Search took ${Date.now() - start}ms. Found ${snap.docs.length} results.`);
    snap.docs.forEach(d => console.log(' - ' + d.data().ingredient_name));
  } catch (e: any) {
    console.error('Search failed:', e.message);
  }
}

run().catch(console.error);
