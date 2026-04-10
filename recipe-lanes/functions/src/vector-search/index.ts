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
      const parsed = JSON.parse(raw);
      // Support both { exportedAt, records } (new) and plain array (legacy)
      if (Array.isArray(parsed)) {
        iconIndex = parsed as IconRecord[];
        snapshotTimestamp = 0;
      } else {
        iconIndex = parsed.records as IconRecord[];
        snapshotTimestamp = parsed.exportedAt ?? 0;
      }
      console.log(`[VectorSearch] Loaded ${iconIndex.length} icons (exported ${snapshotTimestamp ? new Date(snapshotTimestamp).toISOString() : 'unknown'}).`);
    } else {
      console.warn(`[VectorSearch] icon_index.json not found at ${indexPath}. Embed-only mode.`);
      iconIndex = [];
      snapshotTimestamp = 0;
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

/** Average a set of unit vectors and re-normalise the result. */
function averageEmbeddings(vecs: number[][]): number[] {
  const dim = vecs[0].length;
  const avg = new Array<number>(dim).fill(0);
  for (const v of vecs) {
    for (let i = 0; i < dim; i++) avg[i] += v[i];
  }
  for (let i = 0; i < dim; i++) avg[i] /= vecs.length;
  // Re-normalise so cosine similarity stays well-defined.
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += avg[i] * avg[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dim; i++) avg[i] /= norm;
  return avg;
}

export const searchIconVector = onCall({
    memory: "1GiB",
    timeoutSeconds: 60,
    maxInstances: 10,
}, async (request) => {
  // Accept either queries[] (preferred) or legacy query string.
  const rawQueries: string | string[] = request.data.queries ?? request.data.query;
  const queries: string[] = Array.isArray(rawQueries)
    ? rawQueries.filter((q: any) => typeof q === "string" && q.trim())
    : (typeof rawQueries === "string" && rawQueries.trim() ? [rawQueries] : []);
  const limit = request.data.limit || 12;

  if (queries.length === 0) {
    throw new HttpsError("invalid-argument", "Provide 'queries' (string[]) or 'query' (string).");
  }

  await initialize();

  // Embed all queries in parallel, then average + re-normalise.
  const outputs = await Promise.all(
    queries.map(q => embedderPipeline(q, { pooling: "mean", normalize: true }))
  );
  const vecs = outputs.map((o: any) => Array.from(o.data) as number[]);
  const queryEmbedding = vecs.length === 1 ? vecs[0] : averageEmbeddings(vecs);

  console.log(`[VectorSearch] embedded ${queries.length} quer${queries.length === 1 ? 'y' : 'ies'}, dim=${queryEmbedding.length}`);

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
