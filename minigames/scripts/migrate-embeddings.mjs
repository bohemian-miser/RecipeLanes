import { pipeline, env } from '@xenova/transformers';
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
  console.log('Loading local model...');
  env.allowLocalModels = false;
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  const sourceCol = db.collection('icon_index');
  const targetCol = db.collection('icon_index_browser');

  console.log('Fetching source documents...');
  const snap = await sourceCol.get();
  console.log(`Found ${snap.docs.length} documents.`);

  let count = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    if (!data.ingredient_name) continue;

    const out = await extractor(data.ingredient_name, { pooling: 'mean', normalize: true });
    const vector = Array.from(out.data);

    const newData = { ...data };
    newData.embedding = FieldValue.vector(vector);

    await targetCol.doc(doc.id).set(newData);
    count++;
    if (count % 10 === 0) console.log(`Processed ${count}...`);
  }

  console.log('Done migrating to icon_index_browser');
}

run().catch(console.error);
