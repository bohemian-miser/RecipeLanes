import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline, env } from '@huggingface/transformers';
import * as dotenv from 'dotenv';
import { FieldValue } from 'firebase-admin/firestore';
import { ai, embeddingModel } from '../lib/genkit';

// Usage: npx tsx backfill-embeddings.ts [--staging | --prod] [--dry-run]

async function run() {
  const args = process.argv.slice(2);
  let envArg = 'staging';
  let dryRun = false;

  if (args.includes('--prod')) envArg = 'prod';
  else if (args.includes('--staging')) envArg = 'staging';
  
  if (args.includes('--dry-run')) dryRun = true;

  const envFile = envArg === 'prod' ? '.env.prod' : '.env.staging';
  dotenv.config({ path: path.resolve(__dirname, `../${envFile}`) });

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
  
  console.log(`=========================================`);
  console.log(` ENVIRONMENT: ${envArg}`);
  console.log(` MODE:        ${dryRun ? 'DRY RUN (No writes)' : 'LIVE WRITE'}`);
  console.log(`=========================================`);
  
  console.log(`Fetching all icons from ${envArg} icon_index...`);
  const snap = await db.collection('icon_index').get();
  
  console.log(`Found ${snap.size} total icons. Loading MiniLM model...`);
  const embedderPipeline = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
      dtype: 'fp32'
  });

  let backfilledMiniLM = 0;
  let backfilledVertex = 0;
  let errors = 0;
  let skips = 0;

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

      // Helper to check if a vector field is valid and populated
      const isVectorValid = (vec: any, expectedDim: number) => {
          if (!vec) return false;
          const arr = typeof vec.toArray === 'function' ? vec.toArray() : vec;
          return Array.isArray(arr) && arr.length === expectedDim;
      };

      // 1. Backfill MiniLM (384d)
      if (!isVectorValid(data.embedding_minilm, 384)) {
          try {
              const output = await embedderPipeline(name, { pooling: "mean", normalize: true });
              const queryVec = Array.from(output.data) as number[];
              if (queryVec.length === 384) {
                  updates.embedding_minilm = FieldValue.vector(queryVec);
                  backfilledMiniLM++;
              } else {
                  throw new Error(`MiniLM produced vector of length ${queryVec.length}`);
              }
          } catch (e: any) {
              console.error(`Failed to generate MiniLM embedding for ${name}:`, e.message);
              errors++;
          }
      }

      // 2. Backfill Vertex (768d)
      if (!isVectorValid(data.embedding, 768)) {
          try {
              const result = await ai.embed({ embedder: embeddingModel, content: name });
              const vertexVec = result[0]?.embedding;
              if (vertexVec && vertexVec.length === 768) {
                  updates.embedding = FieldValue.vector(vertexVec);
                  backfilledVertex++;
              } else {
                  throw new Error(`Vertex produced vector of length ${vertexVec?.length}`);
              }
          } catch (e: any) {
              console.error(`Failed to generate Vertex embedding for ${name}:`, e.message);
              errors++;
          }
      }

      // Commit updates if any
      if (Object.keys(updates).length > 0) {
          try {
              if (!dryRun) {
                  await doc.ref.update(updates);
              }
              console.log(`[${i+1}/${snap.size}] ${dryRun ? 'WOULD UPDATE' : 'UPDATED'} ${doc.id} ("${name}") - Added MiniLM: ${!!updates.embedding_minilm}, Added Vertex: ${!!updates.embedding}`);
          } catch (e: any) {
              console.error(`Failed to write updates for ${doc.id}:`, e.message);
              errors++;
          }
      } else {
          skips++;
          if (i % 100 === 0) {
              console.log(`[${i+1}/${snap.size}] ... processing (already populated)`);
          }
      }
  }

  console.log("=================================================");
  console.log(`BACKFILL COMPLETE ${dryRun ? '(DRY RUN)' : ''}`);
  console.log("=================================================");
  console.log(`Total icons processed: ${snap.size}`);
  console.log(`Icons fully skipped:   ${skips}`);
  console.log(`MiniLM generated:      ${backfilledMiniLM}`);
  console.log(`Vertex generated:      ${backfilledVertex}`);
  console.log(`Errors encountered:    ${errors}`);
  console.log("=================================================");
}

run().catch(console.error);
