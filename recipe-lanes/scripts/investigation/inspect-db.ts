import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

async function run() {
  const serviceAccountPath = path.resolve(__dirname, '../staging-service-account.json');
  const serviceAccount = require(serviceAccountPath);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  const db = admin.firestore();
  
  const snap1 = await db.collection('icon_index').limit(1).get();
  if (!snap1.empty) {
      console.log("icon_index doc:", snap1.docs[0].id);
      const data = snap1.docs[0].data();
      const vec = data.embedding;
      console.log("embedding length:", typeof vec?.toArray === 'function' ? vec.toArray().length : vec?.length);
  }

  const snap2 = await db.collection('icon_index_browser').limit(1).get();
  if (!snap2.empty) {
      console.log("icon_index_browser doc:", snap2.docs[0].id);
      const data = snap2.docs[0].data();
      const vec = data.embedding;
      console.log("embedding length:", typeof vec?.toArray === 'function' ? vec.toArray().length : vec?.length);
  }
}

run().catch(console.error);
