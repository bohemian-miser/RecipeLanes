// Prebuild script: runs before `next build`.
// 1. Downloads Xenova/all-MiniLM-L6-v2 into model-cache/ (gitignored, ships in container).
// 2. Copies icon_index.json from the CF data directory into lib/vector-search/.
//
// Run manually: node scripts/prebuild.js
// Runs automatically via: npm run build (via prebuild hook in package.json)

const { pipeline, env } = require('@huggingface/transformers');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODEL_CACHE = path.join(ROOT, 'model-cache');
const OUT_DIR = path.join(ROOT, 'lib', 'vector-search');
const OUT_INDEX = path.join(OUT_DIR, 'icon_index.json');

// Source: the CF already maintains a fresh export here
const CF_INDEX = path.join(ROOT, 'functions', 'src', 'vector-search', 'data', 'icon_index.json');

async function downloadModel() {
    console.log('[prebuild] Downloading Xenova/all-MiniLM-L6-v2 →', MODEL_CACHE);
    env.cacheDir = MODEL_CACHE;
    env.allowRemoteModels = true;

    const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32' });
    const out = await embedder('test', { pooling: 'mean', normalize: true });
    const dim = Array.from(out.data).length;
    if (dim !== 384) throw new Error(`Expected 384-dim, got ${dim}`);
    console.log(`[prebuild] Model ready (${dim}d)`);
}

function copyIconIndex() {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    if (fs.existsSync(CF_INDEX)) {
        fs.copyFileSync(CF_INDEX, OUT_INDEX);
        const stat = fs.statSync(OUT_INDEX);
        console.log(`[prebuild] Copied icon_index.json (${(stat.size / 1024 / 1024).toFixed(1)} MB) from functions/`);
        return;
    }

    // Fallback: create empty index so the server starts without crashing
    console.warn('[prebuild] CF icon_index.json not found at', CF_INDEX);
    console.warn('[prebuild] Writing empty index — search will return no results');
    fs.writeFileSync(OUT_INDEX, JSON.stringify({ exportedAt: Date.now(), records: [] }));
}

async function main() {
    copyIconIndex();
    await downloadModel();
    console.log('[prebuild] Done.');
    process.exit(0);
}

main().catch(e => {
    console.error('[prebuild] Failed:', e);
    process.exit(1);
});
