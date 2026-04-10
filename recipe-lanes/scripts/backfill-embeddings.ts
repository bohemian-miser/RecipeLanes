import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline, env } from '@huggingface/transformers';
import * as dotenv from 'dotenv';
import { FieldValue } from 'firebase-admin/firestore';
import { ai, embeddingModel } from '../lib/genkit';

// Usage: npx tsx backfill-embeddings.ts [--staging | --prod]

async function run() {
  const args = process.argv.slice(2);
  let envArg = 'staging';

  if (args.includes('--prod')) envArg = 'prod';
  else if (args.includes('--staging')) envArg = 'staging';
  else {
      console.warn("No environment flag provided. Defaulting to --staging.");
  }

  const envFile = envArg === 'prod' ? '.env.prod' : '.env.staging';
  dotenv.config({ path: path.resolve(__dirname, `../${envFile}`) });

  // Disable local cache writing for the transformers library if needed, 
  // but it's fine locally. We'll use /tmp just in case.
  env.cacheDir = "/tmp/.cache/huggingface";

  const serviceAccountPath = path.resolve(__dirname, `../${envArg}-service-account.json`);
  if (!fs.existsSync(serviceAccountPath)) {
    console.error(`Service account file not found at ${serviceAccountPath}`);
    process.exit(1);
  }

  const serviceAccount = require(serviceAccountPath);

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }

  const db = admin.firestore();
  
  console.log(`Fetching all icons from ${envArg} icon_index...`);
  const snap = await db.collection('icon_index').get();
  
  console.log(`Found ${snap.size} total icons. Loading MiniLM model...`);
  const embedderPipeline = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
      dtype: 'fp32'
  });

  let backfilledMiniLM = 0;
  let backfilledVertex = 0;
  let errors = 0;

  console.log("Starting backfill process...");

  for (let i = 0; i < snap.docs.length; i++) {
      const doc = snap.docs[i];
      const data = doc.data();
      const name = data.visualDescription || data.ingredient_name;
      
      if (!name) {
          console.warn(`Skipping doc ${doc.id}: no visualDescription or ingredient_name`);
          continue;
      }

      const updates: any = {};

      // 1. Backfill MiniLM (384d)
      if (!data.embedding_minilm) {
          try {
              const output = await embedderPipeline(name, { pooling: "mean", normalize: true });
              const queryVec = Array.from(output.data) as number[];
              updates.embedding_minilm = FieldValue.vector(queryVec);
              backfilledMiniLM++;
          } catch (e: any) {
              console.error(`Failed to generate MiniLM embedding for ${name}:`, e.message);
              errors++;
          }
      }

      // 2. Backfill Vertex (768d) - optional, but requested "both embeddings populated"
      if (!data.embedding) {
          try {
              const result = await ai.embed({ embedder: embeddingModel, content: name });
              updates.embedding = FieldValue.vector(result.embedding);
              backfilledVertex++;
          } catch (e: any) {
              console.error(`Failed to generate Vertex embedding for ${name}:`, e.message);
              errors++;
          }
      }

      // Commit updates if any
      if (Object.keys(updates).length > 0) {
          try {
              await doc.ref.update(updates);
              console.log(`[${i+1}/${snap.size}] Updated ${doc.id} ("${name}") - MiniLM: ${!!updates.embedding_minilm}, Vertex: ${!!updates.embedding}`);
          } catch (e: any) {
              console.error(`Failed to write updates for ${doc.id}:`, e.message);
              errors++;
          }
      } else if (i % 100 === 0) {
          console.log(`[${i+1}/${snap.size}] ... already fully populated.`);
      }
  }

  console.log("=================================================");
  console.log("BACKFILL COMPLETE");
  console.log("=================================================");
  console.log(`Total icons processed: ${snap.size}`);
  console.log(`MiniLM (384d) embeddings generated: ${backfilledMiniLM}`);
  console.log(`Vertex (768d) embeddings generated: ${backfilledVertex}`);
  console.log(`Errors encountered: ${errors}`);
  console.log("=================================================");
}

run().catch(console.error);
