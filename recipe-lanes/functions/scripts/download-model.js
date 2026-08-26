// Downloads Xenova/all-MiniLM-L6-v2 into the bundled model cache directory.
// Run before deploying: node scripts/download-model.js
// (or via: npm run download-model)

const { pipeline, env } = require('@huggingface/transformers');
const path = require('path');

const MODEL_CACHE = path.resolve(__dirname, '../src/vector-search/model-cache');

env.cacheDir = MODEL_CACHE;
env.allowRemoteModels = true;

// huggingface.co resets connections often enough to have failed whole CI runs
// on a single un-retried fetch, so retry with backoff before giving up.
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 5_000, 15_000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function download() {
    const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        dtype: 'fp32',
    });

    // Quick smoke test
    const out = await embedder('test sentence', { pooling: 'mean', normalize: true });
    const dim = Array.from(out.data).length;
    if (dim !== 384) throw new Error(`Expected 384-dim embedding, got ${dim}`);
    return dim;
}

async function main() {
    console.log('Downloading Xenova/all-MiniLM-L6-v2...');
    console.log('Target:', MODEL_CACHE);

    let lastErr;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        await sleep(BACKOFF_MS[attempt - 1] ?? 0);
        try {
            const dim = await download();
            console.log(`Done. Embedding dim: ${dim}`);
            process.exit(0);
        } catch (e) {
            lastErr = e;
            console.warn(`Attempt ${attempt}/${MAX_ATTEMPTS} failed:`, e?.message ?? e);
        }
    }
    throw lastErr;
}

main().catch(e => {
    console.error('Download failed:', e);
    process.exit(1);
});
