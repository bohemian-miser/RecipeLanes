/**
 * Backfills the Vertex AI 768d embedding field on existing icon_index docs.
 * Skips docs that already have a valid 768d vector.
 *
 * Fast path: batches up to 100 texts per Vertex API call, with concurrent requests.
 *
 * Usage:
 *   npx tsx scripts/backfill-vertex-embedding.ts [--staging] [--dry-run]
 */

import dotenv from 'dotenv';
import { FieldValue } from 'firebase-admin/firestore';
import { GoogleAuth } from 'google-auth-library';
import { DB_COLLECTION_ICON_INDEX } from '../lib/config';
import { scanCollection } from './lib/db-tools';

const staging = process.argv.includes('--staging');
const dryRun = process.argv.includes('--dry-run');

if (staging) {
    dotenv.config({ path: '.env.staging', override: true });
} else {
    dotenv.config();
}

const PROJECT = staging ? 'recipe-lanes-staging' : 'recipe-lanes';
const EMBED_BATCH = 100;   // texts per Vertex API call (max 250)
const CONCURRENCY = 4;     // parallel Vertex requests
const WRITE_BATCH = 200;   // Firestore batch write size

function vectorLength(v: any): number | null {
    if (!v) return null;
    const arr = typeof v.toArray === 'function' ? v.toArray() : v;
    return Array.isArray(arr) ? arr.length : null;
}

// --- Vertex HTTP client with token caching ---
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

async function embedBatch(texts: string[]): Promise<number[][]> {
    const token = await getToken();
    const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/us-central1/publishers/google/models/text-embedding-004:predict`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            instances: texts.map(text => ({ content: text, task_type: 'RETRIEVAL_DOCUMENT' })),
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Vertex API ${res.status}: ${body.slice(0, 300)}`);
    }
    const data: any = await res.json();
    return data.predictions.map((p: any) => p.embeddings.values as number[]);
}

// Run up to `limit` async tasks concurrently
async function withConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
    const results: T[] = [];
    const executing: Promise<void>[] = [];
    for (const task of tasks) {
        const p = task().then(r => { results.push(r); });
        executing.push(p);
        if (executing.length >= limit) await Promise.race(executing).catch(() => {});
        // clean up settled promises
        for (let i = executing.length - 1; i >= 0; i--) {
            executing[i] = executing[i].then(() => { executing.splice(i, 1); }).catch(() => { executing.splice(i, 1); });
        }
    }
    await Promise.allSettled(executing);
    return results;
}

async function main() {
    const { db } = await import('../lib/firebase-admin');

    console.log(`ENV:  ${staging ? 'staging' : 'prod'}`);
    console.log(`MODE: ${dryRun ? 'DRY RUN' : 'LIVE WRITE'}\n`);

    // Collect all docs that need backfilling
    console.log('Scanning icon_index...');
    type Pending = { id: string; ref: FirebaseFirestore.DocumentReference; name: string };
    const pending: Pending[] = [];
    let skipped = 0;

    for await (const doc of scanCollection(db, DB_COLLECTION_ICON_INDEX)) {
        if (vectorLength(doc.data().embedding) === 768) { skipped++; continue; }
        const name = doc.data().visualDescription || doc.data().ingredient_name;
        if (!name) { skipped++; continue; }
        pending.push({ id: doc.id, ref: doc.ref, name });
    }

    console.log(`To embed: ${pending.length}  Already done: ${skipped}\n`);
    if (pending.length === 0) { console.log('Nothing to do.'); return; }

    // Chunk into batches and embed concurrently
    const chunks: Pending[][] = [];
    for (let i = 0; i < pending.length; i += EMBED_BATCH) {
        chunks.push(pending.slice(i, i + EMBED_BATCH));
    }

    let embedded = 0;
    let errors = 0;
    const updates: { ref: FirebaseFirestore.DocumentReference; vec: number[] }[] = [];

    const tasks = chunks.map((chunk, ci) => async () => {
        try {
            const vecs = await embedBatch(chunk.map(d => d.name));
            for (let i = 0; i < chunk.length; i++) {
                updates.push({ ref: chunk[i].ref, vec: vecs[i] });
                embedded++;
            }
        } catch (e: any) {
            console.error(`\nChunk ${ci} failed: ${e.message}`);
            errors += chunk.length;
        }
        process.stdout.write(`\r  embedded=${embedded} errors=${errors} (chunk ${ci + 1}/${chunks.length})  `);
    });

    await withConcurrency(tasks, CONCURRENCY);
    console.log('\n');

    if (dryRun || updates.length === 0) {
        console.log(`Done (dry run). Would write ${updates.length} docs.`);
        return;
    }

    // Write in Firestore batches
    console.log(`Writing ${updates.length} docs...`);
    let written = 0;
    for (let i = 0; i < updates.length; i += WRITE_BATCH) {
        const batch = db.batch();
        for (const { ref, vec } of updates.slice(i, i + WRITE_BATCH)) {
            batch.update(ref, { embedding: FieldValue.vector(vec) });
        }
        await batch.commit();
        written += Math.min(WRITE_BATCH, updates.length - i);
        process.stdout.write(`\r  written=${written}/${updates.length}  `);
    }

    console.log(`\n\nDone. embedded=${embedded} written=${written} skipped=${skipped} errors=${errors}`);
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
