import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

// Usage: npx tsx pull-db.ts [staging|prod] [output_dir]
async function run() {
  const env = process.argv[2] || 'staging';
  const outDir = process.argv[3] || '../.claude/worktrees/rust-vector-search/rust-vector-search';
  
  let serviceAccountPath = '';
  if (env === 'staging') {
    serviceAccountPath = path.resolve(__dirname, '../staging-service-account.json');
  } else if (env === 'prod') {
    serviceAccountPath = path.resolve(__dirname, '../service-account.json');
  } else {
    console.error('Invalid environment. Use "staging" or "prod".');
    process.exit(1);
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
    // Assuming data.embedding is an array of numbers
    if (data.embedding && Array.isArray(data.embedding)) {
      records.push({
        id: doc.id,
        embedding: data.embedding
      });
    }
  });

  console.log(`Found ${records.length} records with embeddings.`);

  const outputPath = path.resolve(__dirname, outDir, 'icon_index.json');
  fs.writeFileSync(outputPath, JSON.stringify(records));
  
  console.log(`Successfully saved to ${outputPath}`);
}

run().catch(console.error);
