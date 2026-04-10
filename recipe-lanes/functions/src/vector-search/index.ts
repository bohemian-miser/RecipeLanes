import { onCall, HttpsError } from "firebase-functions/v2/https";
import { pipeline, env } from "@huggingface/transformers";
import * as fs from "fs";
import * as path from "path";

// Load the model from the bundled cache shipped with the function.
// /tmp fallback only if bundle is missing (should not happen in production).
const BUNDLED_MODEL_CACHE = path.resolve(__dirname, './model-cache');
env.cacheDir = BUNDLED_MODEL_CACHE;
env.allowRemoteModels = false;

interface IconRecord {
  id: string;
  embedding: number[];
}

let embedderPipeline: any = null;
let iconIndex: IconRecord[] | null = null;
let snapshotTimestamp: number = 0;

// Initialize model and data on cold start
async function initialize() {
  if (!embedderPipeline) {
    console.log("[VectorSearch] Loading embedding model...");
    // Using xenova's version or default to download dynamically into /tmp
    embedderPipeline = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
      dtype: 'fp32'
    });
  }

  if (!iconIndex) {
    console.log("[VectorSearch] Loading in-memory icon index...");
    const indexPath = path.resolve(__dirname, "./data/icon_index.json");
    if (fs.existsSync(indexPath)) {
      const raw = fs.readFileSync(indexPath, "utf8");
      iconIndex = JSON.parse(raw) as IconRecord[];
      snapshotTimestamp = fs.statSync(indexPath).mtimeMs;
      console.log(`[VectorSearch] Loaded ${iconIndex.length} icons into memory.`);
    } else {
      console.warn(`[VectorSearch] icon_index.json not found at ${indexPath}. Embed-only mode.`);
      iconIndex = [];
      snapshotTimestamp = Date.now();
    }
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export const searchIconVector = onCall({
    memory: "1GiB", // Model needs some RAM
    timeoutSeconds: 60,
    maxInstances: 10,
}, async (request) => {
  const query = request.data.query;
  const limit = request.data.limit || 12;

  if (!query || typeof query !== "string") {
    throw new HttpsError("invalid-argument", "The function must be called with a 'query' string.");
  }

  await initialize();

  // Generate embedding
  const output = await embedderPipeline(query, { pooling: "mean", normalize: true });
  // output is a Tensor. We need it as an array.
  const queryEmbedding = Array.from(output.data) as number[];

  // Perform cosine similarity search
  const fastMatches: { icon_id: string; score: number }[] = [];
  
  if (iconIndex && iconIndex.length > 0) {
    for (const record of iconIndex) {
      const score = cosineSimilarity(queryEmbedding, record.embedding);
      fastMatches.push({
        icon_id: record.id,
        score,
      });
    }
    
    // Sort descending by score
    fastMatches.sort((a, b) => b.score - a.score);
    // Truncate
    fastMatches.splice(limit);
  }

  return {
    embedding: queryEmbedding,
    fast_matches: fastMatches,
    snapshot_timestamp: snapshotTimestamp,
  };
});
