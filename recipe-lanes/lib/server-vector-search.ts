/**
 * In-process vector search for the Next.js backend.
 * The embedding model and icon index are bundled into the container image
 * via scripts/prebuild.js (runs before `next build`).
 *
 * Uses @huggingface/transformers loaded lazily inside initialize() so that
 * a native-binary failure (e.g. missing libonnxruntime.so.1 in some container
 * environments) surfaces as a caught error rather than an unhandled rejection
 * that crashes the route.
 */

import * as fs from 'fs';
import * as path from 'path';

interface IconRecord {
    id: string;
    embedding: number[];
}

const MODEL_CACHE = path.join(process.cwd(), 'model-cache');
const INDEX_PATH = path.join(process.cwd(), 'lib', 'vector-search', 'icon_index.json');

// Module-level singletons — initialised once per process (like CF cold start)
let embedder: any = null;
let iconIndex: IconRecord[] = [];
let snapshotTimestamp: number = 0;
let initPromise: Promise<void> | null = null;

async function initialize(): Promise<void> {
    if (initPromise) return initPromise;
    initPromise = (async () => {
        // Dynamic import keeps the module-level load clean even if onnxruntime
        // native binaries are unavailable in the current environment.
        const { pipeline, env } = await import('@huggingface/transformers');

        if (!embedder) {
            console.log('[ServerVectorSearch] Loading model from', MODEL_CACHE);
            env.cacheDir = MODEL_CACHE;
            env.allowRemoteModels = false;
            embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32' });
            console.log('[ServerVectorSearch] Model ready');
        }

        if (iconIndex.length === 0 && fs.existsSync(INDEX_PATH)) {
            const raw = fs.readFileSync(INDEX_PATH, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                iconIndex = parsed;
            } else {
                iconIndex = parsed.records ?? [];
                snapshotTimestamp = parsed.exportedAt ?? 0;
            }
            console.log(`[ServerVectorSearch] Loaded ${iconIndex.length} icons (snapshot ${snapshotTimestamp ? new Date(snapshotTimestamp).toISOString() : 'unknown'})`);
        }
    })().catch(e => {
        // Reset so the next call retries rather than returning a permanently-rejected promise
        initPromise = null;
        throw e;
    });
    return initPromise;
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

function averageEmbeddings(vecs: number[][]): number[] {
    const dim = vecs[0].length;
    const avg = new Array<number>(dim).fill(0);
    for (const v of vecs) for (let i = 0; i < dim; i++) avg[i] += v[i];
    for (let i = 0; i < dim; i++) avg[i] /= vecs.length;
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += avg[i] * avg[i];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < dim; i++) avg[i] /= norm;
    return avg;
}

async function embedAndSearch(queries: string[], limit: number): Promise<{
    embedding: number[];
    fast_matches: { icon_id: string; score: number }[];
}> {
    const outputs = await Promise.all(
        queries.map(q => embedder(q, { pooling: 'mean', normalize: true }))
    );
    const vecs = outputs.map((o: any) => Array.from(o.data) as number[]);
    const embedding = vecs.length === 1 ? vecs[0] : averageEmbeddings(vecs);

    const fast_matches: { icon_id: string; score: number }[] = [];
    for (const record of iconIndex) {
        fast_matches.push({ icon_id: record.id, score: cosineSimilarity(embedding, record.embedding) });
    }
    fast_matches.sort((a, b) => b.score - a.score);
    fast_matches.splice(limit);

    return { embedding, fast_matches };
}

export type BatchIngredient = { name: string; queries: string[] };
export type BatchResult = { name: string; embedding: number[]; fast_matches: { icon_id: string; score: number }[] };

/**
 * Batch embed + search. Same API as the Cloud Function's batch mode.
 * Sequential processing — ONNX is single-threaded.
 */
export async function nextjsEmbedAndSearch(ingredients: BatchIngredient[], limit = 12): Promise<BatchResult[]> {
    await initialize();

    const results: BatchResult[] = [];
    for (const ing of ingredients) {
        const queries = ing.queries.filter(q => typeof q === 'string' && q.trim());
        if (queries.length === 0) {
            results.push({ name: ing.name, embedding: [], fast_matches: [] });
            continue;
        }
        const { embedding, fast_matches } = await embedAndSearch(queries, limit);
        results.push({ name: ing.name, embedding, fast_matches });
    }
    return results;
}
