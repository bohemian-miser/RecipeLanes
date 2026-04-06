import admin from 'firebase-admin';
import fs from 'fs';

const serviceAccount = JSON.parse(fs.readFileSync('./staging-service-account.json', 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'recipe-lanes-staging',
  });
}
const db = admin.firestore();

async function dump() {
    console.log('Dumping icon_index_browser (384d)...');
    const snap = await db.collection('icon_index_browser').get();
    
    const docs = snap.docs.map(d => {
        const data = d.data();
        let vector = null;
        if (data.embedding && data.embedding.isEqual) {
            // It's a FieldValue.vector
            vector = data.embedding.toArray();
        } else if (Array.isArray(data.embedding)) {
            vector = data.embedding;
        }
        
        return {
            id: d.id,
            ingredient_name: data.ingredient_name || '',
            url: data.url || '',
            icon_id: data.icon_id || '',
            embedding: vector
        };
    }).filter(d => d.embedding !== null);

    fs.writeFileSync('./public/icon_index_384.json', JSON.stringify(docs));
    console.log(`Saved ${docs.length} vectors to ./public/icon_index_384.json`);
}

dump().catch(console.error);
