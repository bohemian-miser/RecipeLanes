import { pipeline, env } from '@xenova/transformers';
import admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import fs from 'fs';

const serviceAccount = JSON.parse(fs.readFileSync('./staging-service-account.json', 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'recipe-lanes-staging',
  });
}

const db = admin.firestore();

async function run() {
  console.log('Loading local model...');
  env.allowLocalModels = false;
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  console.log('Embedding query "egg"...');
  const out = await extractor('egg', { pooling: 'mean', normalize: true });
  const vector = Array.from(out.data);

  console.log('Searching icon_index_browser...');
  const snap = await db.collection('icon_index_browser')
    .findNearest('embedding', FieldValue.vector(vector), { limit: 5, distanceMeasure: 'COSINE' })
    .get();

  console.log(`Found ${snap.docs.length} results:`);
  snap.docs.forEach(doc => {
    console.log(` - ${doc.data().ingredient_name}`);
  });
}

run().catch(console.error);
