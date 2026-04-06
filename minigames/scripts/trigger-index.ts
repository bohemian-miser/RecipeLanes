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
  const dummyVector = new Array(384).fill(0);
  try {
    console.log('Querying icon_index_browser...');
    await db.collection('icon_index_browser')
      .findNearest('embedding', FieldValue.vector(dummyVector), { limit: 1, distanceMeasure: 'COSINE' })
      .get();
    console.log('Success - index already exists?');
  } catch (e: any) {
    console.error('Failed as expected. Error message for index creation link:');
    console.error(e.message);
  }
}

run().catch(console.error);
