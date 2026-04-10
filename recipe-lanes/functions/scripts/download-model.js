// Downloads Xenova/all-MiniLM-L6-v2 into the bundled model cache directory.
// Run before deploying: node scripts/download-model.js
// (or via: npm run download-model)

const { pipeline, env } = require('@huggingface/transformers');
const path = require('path');

const MODEL_CACHE = path.resolve(__dirname, '../src/vector-search/model-cache');

env.cacheDir = MODEL_CACHE;
env.allowRemoteModels = true;

async function main() {
    console.log('Downloading Xenova/all-MiniLM-L6-v2...');
    console.log('Target:', MODEL_CACHE);

    const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        dtype: 'fp32',
    });

    // Quick smoke test
    const out = await embedder('test sentence', { pooling: 'mean', normalize: true });
    const dim = Array.from(out.data).length;
    if (dim !== 384) throw new Error(`Expected 384-dim embedding, got ${dim}`);

    console.log(`Done. Embedding dim: ${dim}`);
    process.exit(0);
}

main().catch(e => {
    console.error('Download failed:', e);
    process.exit(1);
});
