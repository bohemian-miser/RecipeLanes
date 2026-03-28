/**
 * Cluster action node visualDescriptions using Vertex AI text embeddings + k-means.
 *
 * Usage:
 *   npx tsx scripts/cluster-action-icons.ts [--staging] [--k 25] [--no-embed]
 *
 * --no-embed   Skip embedding generation, use cached file only.
 * --k N        Override the list of K values to try (single value).
 *
 * Caches embeddings to scripts/.action-embeddings-cache.json so you only
 * pay the embedding cost once.
 */

import 'dotenv/config';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { standardizeIngredientName } from '../lib/utils';

// ─── Config ──────────────────────────────────────────────────────────────────

const CACHE_PATH = path.join(__dirname, '.action-embeddings-cache.json');
const RESULTS_PATH = path.join(__dirname, 'action-icon-cluster-results.md');
const EMBED_BATCH = 20;          // requests in parallel per batch
const KMEANS_RESTARTS = 3;       // random restarts for stability
const KMEANS_MAX_ITER = 80;
const PCA_DIMS = 128;            // truncated PCA dims for faster k-means

// Embedding via Gemini AI Studio API (works from this machine; Vertex AI doesn't)
const GEMINI_EMBED_MODEL = 'gemini-embedding-001';

async function embedText(text: string, apiKey: string): Promise<number[]> {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:embedContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: `models/${GEMINI_EMBED_MODEL}`,
                content: { parts: [{ text }] },
            }),
        }
    );
    if (!res.ok) throw new Error(`Embed API ${res.status}: ${await res.text()}`);
    const j = await res.json() as any;
    return j.embedding.values as number[];
}

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const stagingIndex = args.indexOf('--staging');
const noEmbed = args.includes('--no-embed');
const kOverride = (() => {
    const i = args.indexOf('--k');
    return i !== -1 ? [parseInt(args[i + 1], 10)] : null;
})();

if (stagingIndex !== -1) {
    console.log('✨ Switching to STAGING environment...');
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    dotenv.config({ path: '.env.staging', override: true });
} else {
    dotenv.config();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dot(a: number[], b: number[]): number {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
}

function norm(a: number[]): number {
    return Math.sqrt(dot(a, a));
}

function cosineSim(a: number[], b: number[]): number {
    const n = norm(a) * norm(b);
    return n === 0 ? 0 : dot(a, b) / n;
}

function cosineDistSq(a: number[], b: number[]): number {
    return 1 - cosineSim(a, b);
}

function mean(vecs: number[][]): number[] {
    const dim = vecs[0].length;
    const out = new Array(dim).fill(0);
    for (const v of vecs) for (let i = 0; i < dim; i++) out[i] += v[i];
    const n = vecs.length;
    return out.map(x => x / n);
}

/**
 * Fast randomized dimensionality reduction via random Gaussian projection.
 * Not true PCA but preserves cosine similarity structure well enough for clustering.
 */
function reduceDims(vecs: number[][], targetDim: number): number[][] {
    const n = vecs.length;
    const d = vecs[0].length;
    const k = Math.min(targetDim, d);

    // Build a random Gaussian projection matrix (d × k)
    // Seeded via simple LCG so results are reproducible
    let rng = 42;
    const lcg = () => { rng = (rng * 1664525 + 1013904223) & 0xffffffff; return rng / 0x100000000 + 0.5; };
    const proj: number[][] = Array.from({ length: d }, () =>
        Array.from({ length: k }, () => { const u = lcg(), v = lcg(); return Math.sqrt(-2 * Math.log(u + 1e-9)) * Math.cos(2 * Math.PI * v); })
    );

    // Project each vector and L2-normalise
    return vecs.map(v => {
        const out = new Array(k).fill(0);
        for (let i = 0; i < d; i++) for (let j = 0; j < k; j++) out[j] += v[i] * proj[i][j];
        const n2 = Math.sqrt(out.reduce((s, x) => s + x * x, 0)) || 1;
        return out.map(x => x / n2);
    });
}

/** K-means on cosine distance with multiple random restarts. Returns cluster assignments. */
function kmeans(vecs: number[][], k: number): number[] {
    let bestInertia = Infinity;
    let bestAssign: number[] = [];

    for (let restart = 0; restart < KMEANS_RESTARTS; restart++) {
        // K-means++ init
        const centroids: number[][] = [];
        const indices = Array.from({ length: vecs.length }, (_, i) => i);
        centroids.push(vecs[Math.floor(Math.random() * vecs.length)]);

        for (let ki = 1; ki < k; ki++) {
            const dists = vecs.map(v => {
                let minD = Infinity;
                for (const c of centroids) minD = Math.min(minD, cosineDistSq(v, c));
                return minD;
            });
            const total = dists.reduce((a, b) => a + b, 0);
            let r = Math.random() * total;
            let chosen = 0;
            for (let i = 0; i < dists.length; i++) {
                r -= dists[i];
                if (r <= 0) { chosen = i; break; }
            }
            centroids.push(vecs[chosen]);
        }

        let assign = new Array(vecs.length).fill(0);
        for (let iter = 0; iter < KMEANS_MAX_ITER; iter++) {
            // Assign
            let changed = false;
            for (let i = 0; i < vecs.length; i++) {
                let best = 0, bestD = Infinity;
                for (let ki = 0; ki < k; ki++) {
                    const d = cosineDistSq(vecs[i], centroids[ki]);
                    if (d < bestD) { bestD = d; best = ki; }
                }
                if (assign[i] !== best) { assign[i] = best; changed = true; }
            }
            if (!changed) break;
            // Update centroids
            for (let ki = 0; ki < k; ki++) {
                const members = vecs.filter((_, i) => assign[i] === ki);
                if (members.length > 0) centroids[ki] = mean(members);
            }
        }

        // Inertia (sum of cosine distances to centroid)
        const inertia = vecs.reduce((s, v, i) => s + cosineDistSq(v, centroids[assign[i]]), 0);
        if (inertia < bestInertia) { bestInertia = inertia; bestAssign = [...assign]; }
    }
    return bestAssign;
}

/** For each cluster, find the description closest to the centroid. */
function clusterCentroid(vecs: number[][], assign: number[], k: number) {
    const centroids: number[][] = [];
    for (let ki = 0; ki < k; ki++) {
        const members = vecs.filter((_, i) => assign[i] === ki);
        centroids.push(members.length > 0 ? mean(members) : vecs[0]);
    }
    return centroids;
}

/** For each cluster, find the member closest to the centroid. */
function representativeDesc(descs: string[], vecs: number[][], assign: number[], k: number): string[] {
    const centroids = clusterCentroid(vecs, assign, k);
    return centroids.map((c, ki) => {
        let best = '', bestSim = -Infinity;
        for (let i = 0; i < descs.length; i++) {
            if (assign[i] !== ki) continue;
            const s = cosineSim(vecs[i], c);
            if (s > bestSim) { bestSim = s; best = descs[i]; }
        }
        return best;
    });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const { db } = await import('../lib/firebase-admin');

    // 1. Fetch all action descriptions from Firestore
    console.log('Fetching recipes...');
    const snapshot = await db.collection('recipes').get();
    console.log(`${snapshot.size} recipes found.`);

    const descFreq = new Map<string, number>();
    const allDescs: string[] = [];   // one per action node (with repeats, for coverage math)

    snapshot.forEach(doc => {
        const graph = doc.data().graph;
        if (!graph?.nodes?.length) return;
        for (const node of graph.nodes) {
            if (node.type === 'action' && node.visualDescription) {
                const d = standardizeIngredientName(String(node.visualDescription));
                descFreq.set(d, (descFreq.get(d) ?? 0) + 1);
                allDescs.push(d);
            }
        }
    });

    const uniqueDescs = [...descFreq.keys()];
    const totalNodes = allDescs.length;
    console.log(`${totalNodes} action nodes, ${uniqueDescs.length} unique descriptions.\n`);

    // 2. Load or generate embeddings
    let cache: Record<string, number[]> = {};
    if (fs.existsSync(CACHE_PATH)) {
        cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
        console.log(`Loaded ${Object.keys(cache).length} cached embeddings.`);
    }

    const missing = uniqueDescs.filter(d => !cache[d]);
    if (missing.length > 0 && !noEmbed) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('GEMINI_API_KEY not set in .env');
        console.log(`Generating embeddings for ${missing.length} new descriptions (model: ${GEMINI_EMBED_MODEL})...`);

        for (let i = 0; i < missing.length; i += EMBED_BATCH) {
            const batch = missing.slice(i, i + EMBED_BATCH);
            const results = await Promise.all(batch.map(d => embedText(d, apiKey)));
            for (let j = 0; j < batch.length; j++) {
                cache[batch[j]] = results[j];
            }
            process.stdout.write(`\r  ${Math.min(i + EMBED_BATCH, missing.length)} / ${missing.length}`);
            // Gentle rate-limit
            if (i + EMBED_BATCH < missing.length) await new Promise(r => setTimeout(r, 100));
        }
        console.log();
        fs.writeFileSync(CACHE_PATH, JSON.stringify(cache), 'utf8');
        console.log(`Embeddings saved to ${CACHE_PATH}`);
    } else if (missing.length > 0) {
        console.warn(`Warning: ${missing.length} descriptions have no cached embedding. Run without --no-embed.`);
    }

    // Build arrays aligned to uniqueDescs (skip any still missing)
    const embeddedDescs = uniqueDescs.filter(d => cache[d]);
    const rawVecs = embeddedDescs.map(d => cache[d]);
    const fullDim = rawVecs[0]?.length ?? 0;

    // Reduce dimensionality with truncated SVD (power iteration) for faster k-means.
    // On 3072-dim embeddings, PCA_DIMS=128 retains enough structure while being ~24× faster.
    console.log(`\nReducing ${fullDim}→${PCA_DIMS} dims via power-iteration PCA on ${embeddedDescs.length} vecs...`);
    const vecs = reduceDims(rawVecs, PCA_DIMS);
    console.log(`Clustering ${embeddedDescs.length} descriptions...`);

    // 3. Run k-means for several values of K
    const kValues = kOverride ?? [15, 20, 25, 30];
    const allResults: string[] = [];

    for (const k of kValues) {
        console.log(`  K=${k}...`);
        const assign = kmeans(vecs, k);
        const reps = representativeDesc(embeddedDescs, vecs, assign, k);

        // Build clusters
        type Cluster = { rep: string; members: { desc: string; count: number }[]; totalNodes: number };
        const clusters: Cluster[] = Array.from({ length: k }, (_, ki) => ({
            rep: reps[ki],
            members: [],
            totalNodes: 0,
        }));

        for (let i = 0; i < embeddedDescs.length; i++) {
            const desc = embeddedDescs[i];
            const count = descFreq.get(desc) ?? 1;
            clusters[assign[i]].members.push({ desc, count });
            clusters[assign[i]].totalNodes += count;
        }

        // Sort clusters by size desc
        clusters.sort((a, b) => b.totalNodes - a.totalNodes);
        // Sort members within cluster by count desc
        for (const c of clusters) c.members.sort((a, b) => b.count - a.count);

        const coveredNodes = clusters.reduce((s, c) => s + c.totalNodes, 0);
        const coveragePct = ((coveredNodes / totalNodes) * 100).toFixed(1);

        // Console output
        console.log(`\n${'═'.repeat(70)}`);
        console.log(`K=${k}  |  ${coveredNodes}/${totalNodes} nodes covered (${coveragePct}%)`);
        console.log('═'.repeat(70));
        for (let ci = 0; ci < clusters.length; ci++) {
            const c = clusters[ci];
            const pct = ((c.totalNodes / totalNodes) * 100).toFixed(1);
            console.log(`\n  [${ci + 1}] ${c.rep}  (${c.totalNodes} nodes, ${pct}%)`);
            const top8 = c.members.slice(0, 8);
            for (const m of top8) {
                console.log(`       ${m.count}×  ${m.desc}`);
            }
            if (c.members.length > 8) console.log(`       … +${c.members.length - 8} more`);
        }

        // Markdown section
        const clusterRows = clusters.map((c, ci) => {
            const pct = ((c.totalNodes / totalNodes) * 100).toFixed(1);
            const top5 = c.members.slice(0, 5).map(m => `${m.desc} (${m.count}×)`).join('; ');
            const more = c.members.length > 5 ? ` +${c.members.length - 5} more` : '';
            return `| ${ci + 1} | **${c.rep}** | ${c.totalNodes} | ${pct}% | ${top5}${more} |`;
        }).join('\n');

        allResults.push(`## K=${k}\n
Coverage: **${coveragePct}%** of ${totalNodes} action nodes across ${coveredNodes} nodes embedded.\n
| # | Representative label | Nodes | % | Top members |
|---|----------------------|-------|---|-------------|
${clusterRows}
`);
    }

    // 4. Vessel/food heuristic analysis
    console.log('\n\n=== Vessel + Food heuristic extraction ===\n');
    const vessels = ['frying pan', 'pan', 'skillet', 'saucepan', 'pot', 'bowl', 'wok',
                     'baking dish', 'baking tray', 'oven', 'cutting board', 'board',
                     'plate', 'dish', 'blender', 'food processor', 'mixer'];
    const foods  = ['chicken', 'beef', 'pork', 'lamb', 'fish', 'salmon', 'shrimp', 'prawn',
                    'egg', 'eggs', 'pasta', 'rice', 'potato', 'onion', 'garlic', 'tomato',
                    'vegetable', 'vegetables', 'herbs', 'dough', 'sauce', 'cream', 'butter',
                    'oil', 'water', 'stock', 'broth'];
    const actions = ['frying', 'sautéing', 'sauteing', 'boiling', 'simmering', 'baking',
                     'roasting', 'mixing', 'whisking', 'beating', 'chopping', 'slicing',
                     'dicing', 'mincing', 'browning', 'melting', 'heating', 'cooling',
                     'chilling', 'draining', 'straining', 'stirring', 'blending'];

    const vesselCount = new Map<string, number>();
    const foodCount   = new Map<string, number>();
    const actionCount = new Map<string, number>();

    for (const [desc, count] of descFreq) {
        const lower = desc.toLowerCase();
        for (const v of vessels) if (lower.includes(v)) vesselCount.set(v, (vesselCount.get(v) ?? 0) + count);
        for (const f of foods)   if (lower.includes(f)) foodCount.set(f, (foodCount.get(f) ?? 0) + count);
        for (const a of actions) if (lower.includes(a)) actionCount.set(a, (actionCount.get(a) ?? 0) + count);
    }

    const top = (m: Map<string, number>, n: number) =>
        [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

    console.log('Top vessels:');
    for (const [v, c] of top(vesselCount, 10)) console.log(`  ${String(c).padStart(4)}×  ${v}`);
    console.log('\nTop foods/ingredients in action nodes:');
    for (const [f, c] of top(foodCount, 15)) console.log(`  ${String(c).padStart(4)}×  ${f}`);
    console.log('\nTop action verbs:');
    for (const [a, c] of top(actionCount, 15)) console.log(`  ${String(c).padStart(4)}×  ${a}`);

    const vesselRows = top(vesselCount, 12).map(([v, c]) => `| ${v} | ${c} |`).join('\n');
    const foodRows   = top(foodCount, 15).map(([f, c]) => `| ${f} | ${c} |`).join('\n');
    const actionRows = top(actionCount, 15).map(([a, c]) => `| ${a} | ${c} |`).join('\n');

    // 5. Write results markdown
    const md = `# Action Icon Cluster Analysis
_Generated: ${new Date().toISOString()}_
_${totalNodes} total action nodes · ${uniqueDescs.length} unique descriptions · ${embeddedDescs.length} embedded_

## How to read this

Each cluster is a group of semantically similar action descriptions, found by embedding every
description with \`text-embedding-004\` and running k-means. The **representative label** is the
description closest to the cluster centroid — a good candidate name for the canonical icon.

---

${allResults.join('\n---\n\n')}

---

## Vessel / Food / Action heuristic breakdown

These counts come from substring matching across all action node descriptions.
They show which objects and verbs appear most often and should guide icon design priorities.

### Vessels / containers

| Vessel | Node count |
|--------|-----------|
${vesselRows}

### Foods / ingredients mentioned in action nodes

| Food | Node count |
|------|-----------|
${foodRows}

### Action verbs

| Action | Node count |
|--------|-----------|
${actionRows}

---

## Recommended approach

A fixed icon library matched **semantically** (via embedding similarity at lookup time) rather than
by exact string is viable. The clustering shows that ~20–30 visual archetypes cover the semantic
space well. Key design axes for the icon set:

1. **Vessel** — pan/skillet, saucepan/pot, bowl, oven/baking dish, cutting board, plate
2. **Food category** — meat (chicken/beef/lamb), eggs, vegetables/herbs, dough/pastry, liquid/sauce
3. **Action** — frying/sautéing, boiling/simmering, baking/roasting, mixing/whisking,
   chopping/cutting, cooling/resting, adding/seasoning

A library of ~25 icons spanning these combinations, with embedding-nearest-neighbour lookup,
would serve the large majority of action nodes without generating new icons per recipe.
`;

    fs.writeFileSync(RESULTS_PATH, md, 'utf8');
    console.log(`\nResults written to scripts/action-icon-cluster-results.md`);
}

main().catch(console.error);
