import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

// Usage: npx tsx pull-db.ts --staging | --prod
async function run() {
  const args = process.argv.slice(2);
  let env = 'staging';

  if (args.includes('--prod') && args.includes('--staging')) {
    console.error('Error: --staging and --prod are mutually exclusive.');
    process.exit(1);
  }

  if (args.includes('--prod')) env = 'prod';
  else if (args.includes('--staging')) env = 'staging';
  else {
      // Default to staging if not explicitly provided
      console.warn("No environment flag provided. Defaulting to --staging.");
      env = 'staging';
  }

  const outDir = '../functions/src/vector-search/data';
  
  let serviceAccountPath = '';
  if (env === 'staging') {
    serviceAccountPath = path.resolve(__dirname, '../staging-service-account.json');
  } else if (env === 'prod') {
    serviceAccountPath = path.resolve(__dirname, '../service-account.json');
  }

  if (!fs.existsSync(serviceAccountPath)) {
    console.error(`Service account file not found at ${serviceAccountPath}`);
    process.exit(1);
  }

  const serviceAccount = require(serviceAccountPath);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  const db = admin.firestore();
  console.log(`Pulling icon_index from ${env}...`);
  
  const snapshot = await db.collection('icon_index').get();
  
  const records: any[] = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.embedding && Array.isArray(data.embedding)) {
      records.push({
        id: doc.id,
        embedding: data.embedding
      });
    }
  });

  console.log(`Found ${records.length} records with embeddings.`);

  const outputDirPath = path.resolve(__dirname, outDir);
  if (!fs.existsSync(outputDirPath)) {
      fs.mkdirSync(outputDirPath, { recursive: true });
  }

  const outputPath = path.join(outputDirPath, 'icon_index.json');
  fs.writeFileSync(outputPath, JSON.stringify(records));
  
  console.log(`Successfully saved to ${outputPath}`);
}

run().catch(console.error);
