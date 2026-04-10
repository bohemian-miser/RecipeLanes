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

/** Embed a list of queries and return their averaged, normalised vector. */
async function embedAndSearch(queries: string[], limit: number): Promise<{
  embedding: number[];
  fast_matches: { icon_id: string; score: number }[];
}> {
  const outputs = await Promise.all(
    queries.map(q => embedderPipeline(q, { pooling: "mean", normalize: true }))
  );
  const vecs = outputs.map((o: any) => Array.from(o.data) as number[]);
  const embedding = vecs.length === 1 ? vecs[0] : averageEmbeddings(vecs);

  const fast_matches: { icon_id: string; score: number }[] = [];
  if (iconIndex && iconIndex.length > 0) {
    for (const record of iconIndex) {
      fast_matches.push({ icon_id: record.id, score: cosineSimilarity(embedding, record.embedding) });
    }
    fast_matches.sort((a, b) => b.score - a.score);
    fast_matches.splice(limit);
  }
  return { embedding, fast_matches };
}

export const searchIconVector = onCall({
    memory: "1GiB",
    timeoutSeconds: 60,
    maxInstances: 10,
}, async (request) => {
  const limit = request.data.limit || 12;
  await initialize();

  // Batch mode: ingredients[{name, queries[]}] → results[{name, embedding, fast_matches}]
  if (Array.isArray(request.data.ingredients)) {
    const ingredients: { name: string; queries: string[] }[] = request.data.ingredients;
    if (ingredients.length === 0) {
      throw new HttpsError("invalid-argument", "ingredients array is empty.");
    }
    console.log(`[VectorSearch] batch: ${ingredients.length} ingredients`);
    const results = await Promise.all(
      ingredients.map(async (ing) => {
        const queries = ing.queries.filter(q => typeof q === "string" && q.trim());
        if (queries.length === 0) return { name: ing.name, embedding: [], fast_matches: [] };
        const { embedding, fast_matches } = await embedAndSearch(queries, limit);
        return { name: ing.name, embedding, fast_matches };
      })
    );
    return { results, snapshot_timestamp: snapshotTimestamp };
  }

  // Single-ingredient mode (backward compat): queries[] or query string
  const rawQueries: string | string[] = request.data.queries ?? request.data.query;
  const queries: string[] = Array.isArray(rawQueries)
    ? rawQueries.filter((q: any) => typeof q === "string" && q.trim())
    : (typeof rawQueries === "string" && rawQueries.trim() ? [rawQueries] : []);

  if (queries.length === 0) {
    throw new HttpsError("invalid-argument", "Provide 'ingredients' (batch) or 'queries'/'query' (single).");
  }

  console.log(`[VectorSearch] single: ${queries.length} quer${queries.length === 1 ? 'y' : 'ies'}`);
  const { embedding, fast_matches } = await embedAndSearch(queries, limit);
  return { embedding, fast_matches, snapshot_timestamp: snapshotTimestamp };
});
