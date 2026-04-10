import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline, env } from '@huggingface/transformers';
import * as dotenv from 'dotenv';
import { ai, embeddingModel } from '../lib/genkit';

dotenv.config({ path: path.resolve(__dirname, '../.env.staging') });

env.cacheDir = "/tmp/.cache/huggingface";

async function getVertexEmbedding(text: string): Promise<number[]> {
  const result = await ai.embed({ embedder: embeddingModel, content: text });
  return result.embedding;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function run() {
  const serviceAccountPath = path.resolve(__dirname, '../staging-service-account.json');
  const serviceAccount = require(serviceAccountPath);

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }

  const db = admin.firestore();
  
  console.log("Fetching all icons from staging icon_index...");
  const snap = await db.collection('icon_index').get();
  
  const icons: { id: string, name: string, vertexVec?: number[], minilmVec?: number[] }[] = [];
  
  // We'll also fetch icon_index_browser to get the 384d vectors
  console.log("Fetching minilm vectors from icon_index_browser...");
  const snapBrowser = await db.collection('icon_index_browser').get();
  const browserMap = new Map<string, number[]>();
  snapBrowser.forEach(doc => {
      const vec = doc.data().embedding;
      if (vec) browserMap.set(doc.id, typeof vec.toArray === 'function' ? vec.toArray() : vec);
  });

  snap.forEach(doc => {
    const data = doc.data();
    const vec = data.embedding;
    const name = data.visualDescription || data.ingredient_name;
    if (name) {
        icons.push({
            id: doc.id,
            name: name,
            vertexVec: vec ? (typeof vec.toArray === 'function' ? vec.toArray() : vec) : undefined,
            minilmVec: browserMap.get(doc.id)
        });
    }
  });

  console.log(`Found ${icons.length} icons. Loading MiniLM model...`);
  
  const embedderPipeline = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
      dtype: 'fp32'
  });

  console.log("Evaluating...");

  let vertexTop1 = 0;
  let vertexTop12 = 0;
  let minilmTop1 = 0;
  let minilmTop12 = 0;
  
  let validVertexCount = 0;
  let validMinilmCount = 0;

  for (let i = 0; i < icons.length; i++) {
      const icon = icons[i];
      if (!icon.name) continue;

      // 1. Test Vertex (Legacy)
      if (icon.vertexVec) {
          validVertexCount++;
          const queryVec = icon.vertexVec;
          const scores = icons
              .filter(ic => ic.vertexVec)
              .map(ic => ({ id: ic.id, score: cosineSimilarity(queryVec, ic.vertexVec!) }))
              .sort((a, b) => b.score - a.score);
              
          const rank = scores.findIndex(s => s.id === icon.id);
          if (rank === 0) vertexTop1++;
          if (rank >= 0 && rank < 12) vertexTop12++;
      }

      // 2. Test MiniLM (Node CF)
      if (icon.minilmVec) {
          validMinilmCount++;
          const queryVec = icon.minilmVec;
          
          const scores = icons
              .filter(ic => ic.minilmVec)
              .map(ic => ({ id: ic.id, score: cosineSimilarity(queryVec, ic.minilmVec!) }))
              .sort((a, b) => b.score - a.score);
              
          const rank = scores.findIndex(s => s.id === icon.id);
          if (rank === 0) minilmTop1++;
          if (rank >= 0 && rank < 12) minilmTop12++;
      }
      
      if (i > 0 && i % 50 === 0) console.log(`Processed ${i}/${icons.length}...`);
  }

  console.log("=================================================");
  console.log("EVALUATION RESULTS (Self-Retrieval):");
  console.log("=================================================");
  console.log(`Vertex AI (Legacy) - ${validVertexCount} icons evaluated:`);
  console.log(`Top 1 Accuracy:  ${((vertexTop1 / validVertexCount) * 100).toFixed(2)}%`);
  console.log(`Top 12 Accuracy: ${((vertexTop12 / validVertexCount) * 100).toFixed(2)}%`);
  console.log("");
  console.log(`MiniLM (Node CF) - ${validMinilmCount} icons evaluated:`);
  console.log(`Top 1 Accuracy:  ${((minilmTop1 / validMinilmCount) * 100).toFixed(2)}%`);
  console.log(`Top 12 Accuracy: ${((minilmTop12 / validMinilmCount) * 100).toFixed(2)}%`);
  console.log("=================================================");
  
  console.log("The user requested to map the embeddings so the Node CF can use MiniLM while Vertex uses 004.");
  console.log("Currently, pull-db pulls `icon_index` which is Vertex 768d, causing the CF to compute COS between 384d and 768d.");
  console.log("We need to update the pull-db script and Firestore to handle the multi-modal mapping.");
}

run().catch(console.error);