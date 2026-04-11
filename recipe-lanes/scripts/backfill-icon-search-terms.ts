/**
 * Backfill searchTerms + embeddings on icon_index docs using Gemini vision.
 *
 * For each icon:
 *   1. Fetches the icon image from Firebase Storage
 *   2. Calls Gemini 2.5 Flash vision to generate search terms
 *   3. Embeds all terms with MiniLM (384d) and averages → embedding_minilm
 *   4. Embeds all terms with Vertex (768d) in one batched call and averages → embedding
 *   5. Writes searchTerms + both embeddings back to icon_index
 *
 * Skips docs that already have searchTerms unless --force.
 *
 * Usage:
 *   npx tsx scripts/backfill-icon-search-terms.ts [--staging] [--dry-run] [--limit 100] [--force]
 */

import dotenv from 'dotenv';
import { FieldValue } from 'firebase-admin/firestore';
import { GoogleAuth } from 'google-auth-library';
import { pipeline, env as hfEnv } from '@huggingface/transformers';
import { DB_COLLECTION_ICON_INDEX } from '../lib/config';
import { scanCollection } from './lib/db-tools';

const args = process.argv.slice(2);
const staging = args.includes('--staging');
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : Infinity;

if (staging) {
    dotenv.config({ path: '.env.staging', override: true });
} else {
    dotenv.config();
}

const PROJECT = staging ? 'recipe-lanes-staging' : 'recipe-lanes';
const BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
    ?? (staging ? 'recipe-lanes-staging.firebasestorage.app' : 'recipe-lanes.firebasestorage.app');

const GEMINI_CONCURRENCY = 5;

// Terms containing these substrings are filtered out after generation
const BANNED_SUBSTRINGS = ['pixel art', 'cartoon', 'illustration', 'clip art', 'clipart', 'drawing', 'artwork', 'vector art'];

const PROMPT = `You are generating search terms for a food and cooking icon image library.

How the terms are used: each term gets independently embedded with a sentence model (MiniLM), then all embeddings are averaged into a single vector for this icon. A user's search query is embedded the same way and matched against it. Terms that cluster in the same semantic region waste slots — "truffle oil", "truffle cooking oil", and "oil with truffles" barely shift the average. Terms that cover distinct angles each pull the centroid somewhere new, making the icon reachable from more queries.

Look at the icon carefully. Generate around 12 terms that together cover as much ground as possible:

- The ingredient/dish name and any synonyms or regional alternatives (e.g. "ramen" and "noodle soup", "scallion" and "spring onion", "zucchini" and "courgette")
- Short distinctive visual fragments: dominant colour, shape, or material ("golden liquid", "dark round seeds", "orange broth", "cork stopper")
- Cooking context: dish, cuisine, technique, or meal type
- Ingredient category (dairy, grain, legume, condiment, seafood, etc.)
- 3–4 full descriptive sentences that paint the exact contents of the icon in detail — materials, colours, textures, arrangement. These are the most valuable terms. Write them the way someone would describe a photo to someone who can't see it. Example: "clear glass bottle with a brown cork stopper, containing amber oil and two dark bumpy truffles sitting at the bottom"

DO NOT include: meta-descriptions of art style ("cartoon", "illustration", "pixel art", "drawing", "vector"), vague filler ("refreshment", "preserved food", "food item", "cooking ingredient"), or near-duplicates of each other.

All lowercase. Return ONLY a JSON array of strings, no explanation, no markdown fences.`;

// --- Auth ---
let cachedToken: string | null = null;
let tokenExpiry = 0;
async function getToken(): Promise<string> {
    if (cachedToken && Date.now() < tokenExpiry - 60_000) return cachedToken;
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const t = await client.getAccessToken();
    cachedToken = t.token!;
    tokenExpiry = Date.now() + 3_600_000;
    return cachedToken;
}

// --- Storage URL ---
function iconStorageUrl(iconId: string, ingredientName: string): string {
    const shortId = iconId.substring(0, 8);
    const kebabName = ingredientName.trim().replace(/\s+/g, '-');
    const path = `icons/${kebabName}-${shortId}.png`;
    return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media`;
}

// --- Gemini vision ---
async function generateTerms(iconId: string, ingredientName: string): Promise<string[]> {
    const url = iconStorageUrl(iconId, ingredientName);
    const imgRes = await fetch(url);
    if (!imgRes.ok) throw new Error(`Image fetch ${imgRes.status}: ${url}`);
    const imageBase64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64');

    const token = await getToken();
    const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent`;
    const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [
                { inlineData: { mimeType: 'image/png', data: imageBase64 } },
                { text: PROMPT },
            ]}],
            generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`);
    }
    const data: any = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const clean = raw.trim().replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/```$/, '').trim();

    let terms: string[];
    try {
        terms = JSON.parse(clean);
    } catch {
        const matches = clean.match(/"([^"\\]|\\.)*"/g) ?? [];
        if (matches.length === 0) throw new Error(`Unparseable response: ${clean.slice(0, 100)}`);
        terms = matches.map((s: string) => JSON.parse(s));
    }

    // Filter banned art-style terms
    return terms.filter(t =>
        !BANNED_SUBSTRINGS.some(b => t.toLowerCase().includes(b))
    );
}

// --- MiniLM ---
type EmbedderPipeline = Awaited<ReturnType<typeof pipeline>>;
async function embedAllMiniLM(embedder: EmbedderPipeline, terms: string[]): Promise<number[]> {
    const vecs: number[][] = [];
    for (const term of terms) {
        const out = await embedder(term, { pooling: 'mean', normalize: true });
        vecs.push(Array.from(out.data) as number[]);
    }
    return averageVecs(vecs);
}

// --- Vertex batch ---
async function embedAllVertex(terms: string[]): Promise<number[]> {
    const token = await getToken();
    const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/us-central1/publishers/google/models/text-embedding-004:predict`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            instances: terms.map(text => ({ content: text, task_type: 'RETRIEVAL_DOCUMENT' })),
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Vertex ${res.status}: ${body.slice(0, 200)}`);
    }
    const data: any = await res.json();
    const vecs: number[][] = data.predictions.map((p: any) => p.embeddings.values as number[]);
    return averageVecs(vecs);
}

function averageVecs(vecs: number[][]): number[] {
    const dim = vecs[0].length;
    const avg = new Array(dim).fill(0) as number[];
    for (const v of vecs) for (let i = 0; i < dim; i++) avg[i] += v[i] / vecs.length;
    return avg;
}

// --- Concurrency helper ---
async function withConcurrency(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
    const queue = [...tasks];
    async function run() {
        while (queue.length) await queue.shift()!();
    }
    await Promise.all(Array.from({ length: limit }, run));
}

// --- Main ---
async function main() {
    const { db } = await import('../lib/firebase-admin');

    console.log(`ENV:     ${staging ? 'staging' : 'prod'}`);
    console.log(`BUCKET:  ${BUCKET}`);
    console.log(`MODE:    ${dryRun ? 'DRY RUN' : 'LIVE WRITE'}`);
    console.log(`LIMIT:   ${LIMIT === Infinity ? 'none' : LIMIT}`);
    console.log(`FORCE:   ${force}\n`);

    // Load MiniLM
    console.log('Loading MiniLM model...');
    hfEnv.cacheDir = '/tmp/.cache/huggingface';
    const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32' });
    console.log('Model ready.\n');

    // Collect pending docs
    console.log('Scanning icon_index...');
    type Pending = { id: string; ref: FirebaseFirestore.DocumentReference; name: string };
    const pending: Pending[] = [];
    let skipped = 0;

    for await (const doc of scanCollection(db, DB_COLLECTION_ICON_INDEX)) {
        if (pending.length >= LIMIT) break;
        const data = doc.data();
        const hasTerms = Array.isArray(data.searchTerms) && data.searchTerms.length > 0;
        if (hasTerms && !force) { skipped++; continue; }
        const name: string = data.ingredient_name ?? doc.id;
        pending.push({ id: doc.id, ref: doc.ref, name });
    }
    console.log(`To process: ${pending.length}  Already done: ${skipped}\n`);
    if (pending.length === 0) { console.log('Nothing to do.'); return; }

    let errors = 0;
    let done = 0;

    let written = 0;

    const tasks = pending.map(({ id, ref, name }) => async (): Promise<void> => {
        try {
            const terms = await generateTerms(id, name);
            if (terms.length === 0) throw new Error('No terms generated');
            const [miniLM, vertex] = await Promise.all([
                embedAllMiniLM(embedder, terms),
                embedAllVertex(terms),
            ]);

            done++;
            console.log(`\n[${done}/${pending.length}] ${name} (${id.slice(0, 8)})`);
            terms.forEach((t, ti) => console.log(`  ${ti + 1}. ${t}`));

            if (!dryRun) {
                const searchTerms = terms.map(text => ({ text, source: 'llm_vision', addedAt: Date.now() }));
                await ref.update({
                    searchTerms,
                    embedding_minilm: FieldValue.vector(miniLM),
                    embedding: FieldValue.vector(vertex),
                });
                written++;
                console.log(`  ✓ written`);
            }
        } catch (e: any) {
            done++;
            errors++;
            console.error(`\n[${done}/${pending.length}] ERROR ${name}: ${e.message}`);
        }
    });

    await withConcurrency(tasks, GEMINI_CONCURRENCY);

    console.log(`\n\nDone. written=${written} skipped=${skipped} errors=${errors}`);
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
