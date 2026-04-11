/**
 * Create (or refresh) the icon_index collection from ingredients_new.
 *
 * For each ingredient, picks the best-scored icon and writes a full icon_index doc
 * with both embeddings:
 *   - embedding_minilm (384d) — MiniLM L6 v2, used by the vector search CF
 *   - embedding (768d)        — Vertex text-embedding-004, used by Firestore findNearest
 *
 * Safe to re-run: skips already-indexed icons unless --force is passed.
 *
 * Usage:
 *   npx tsx scripts/create-icon-index.ts --prod [--dry-run] [--limit 500] [--force]
 *   npx tsx scripts/create-icon-index.ts --staging [--dry-run] [--limit 500] [--force]
 *
 * Requires: <env>-service-account.json in the recipe-lanes directory.
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { FieldValue } from 'firebase-admin/firestore';
import { pipeline, env as hfEnv } from '@huggingface/transformers';
import { scanCollection } from './lib/db-tools';
import { DB_COLLECTION_INGREDIENTS, DB_COLLECTION_ICON_INDEX } from '../lib/config';
import { ai, embeddingModel } from '../lib/genkit';

const args = process.argv.slice(2);
const ENV = args.includes('--prod') ? 'prod' : 'staging';
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : Infinity;
const WRITE_BATCH_SIZE = 100;

async function main() {
    const envFile = ENV === 'prod' ? '.env.prod' : '.env.staging';
    dotenv.config({ path: path.resolve(__dirname, `../${envFile}`) });

    const serviceAccountPath = path.resolve(__dirname, `../${ENV}-service-account.json`);
    if (!fs.existsSync(serviceAccountPath)) {
        console.error(`Service account not found: ${serviceAccountPath}`);
        process.exit(1);
    }

    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.cert(require(serviceAccountPath)) });
    }
    const db = admin.firestore();

    console.log(`===========================================`);
    console.log(` ENV:     ${ENV}`);
    console.log(` MODE:    ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE WRITE'}`);
    console.log(` LIMIT:   ${LIMIT === Infinity ? 'none' : LIMIT}`);
    console.log(` FORCE:   ${FORCE}`);
    console.log(`===========================================`);

    // Load existing icon_index IDs so we can skip already-indexed icons
    console.log('Loading existing icon_index...');
    const existingSnap = await db.collection(DB_COLLECTION_ICON_INDEX).select().get();
    const indexed = new Set(existingSnap.docs.map(d => d.id));
    console.log(`Already indexed: ${indexed.size} icons`);

    // Load MiniLM model
    console.log('Loading MiniLM model...');
    hfEnv.cacheDir = '/tmp/.cache/huggingface';
    const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32' });
    console.log('Model ready.');

    async function embedMiniLM(text: string): Promise<number[]> {
        const out = await embedder(text, { pooling: 'mean', normalize: true });
        const vec = Array.from(out.data) as number[];
        if (vec.length !== 384) throw new Error(`Unexpected MiniLM embedding length: ${vec.length}`);
        return vec;
    }

    async function embedVertex(text: string): Promise<number[]> {
        const result = await ai.embed({ embedder: embeddingModel, content: text });
        const vec = result[0]?.embedding;
        if (!vec || vec.length !== 768) throw new Error(`Unexpected Vertex embedding length: ${vec?.length}`);
        return vec;
    }

    let processed = 0;
    let wrote = 0;
    let skipped = 0;
    let errors = 0;

    let batch = db.batch();
    let batchCount = 0;

    async function flushBatch() {
        if (batchCount === 0) return;
        if (!DRY_RUN) await batch.commit();
        batch = db.batch();
        batchCount = 0;
    }

    console.log(`\nScanning ${DB_COLLECTION_INGREDIENTS}...`);

    for await (const doc of scanCollection(db, DB_COLLECTION_INGREDIENTS)) {
        if (processed >= LIMIT) break;

        const data = doc.data();
        const icons: any[] = data.icons ?? [];
        if (icons.length === 0) continue;

        // Pick the best-scored icon
        const best = icons.reduce((a: any, b: any) => (b.score ?? 0) > (a.score ?? 0) ? b : a, icons[0]);
        if (!best?.id || !best?.url) continue;
        if (!FORCE && indexed.has(best.id)) {
            skipped++;
            continue;
        }

        const ingredientName: string = data.name ?? doc.id;
        const visualDescription: string = best.visualDescription ?? ingredientName;
        const textToEmbed = visualDescription !== ingredientName
            ? `${ingredientName} ${visualDescription}`
            : ingredientName;

        try {
            const [miniLM, vertex] = await Promise.all([
                embedMiniLM(textToEmbed),
                embedVertex(textToEmbed),
            ]);

            const indexDoc: Record<string, any> = {
                ingredient_name: ingredientName,
                visualDescription,
                score: best.score ?? 0,
                impressions: best.impressions ?? 0,
                rejections: best.rejections ?? 0,
                metadata: best.metadata ?? null,
                searchTerms: best.searchTerms ?? [],
                embedding_minilm: FieldValue.vector(miniLM),
                embedding: FieldValue.vector(vertex),
                indexed_at: FieldValue.serverTimestamp(),
            };

            if (DRY_RUN) {
                if (wrote < 5) {
                    console.log(`  [DRY RUN] ${best.id}: "${ingredientName}" — "${textToEmbed.slice(0, 60)}"`);
                }
            } else {
                batch.set(db.collection(DB_COLLECTION_ICON_INDEX).doc(best.id), indexDoc, { merge: false });
                batchCount++;
                if (batchCount >= WRITE_BATCH_SIZE) await flushBatch();
            }

            wrote++;
            processed++;

            if (processed % 20 === 0) {
                process.stdout.write(`\r  ${processed} processed, ${wrote} to write, ${skipped} skipped, ${errors} errors  `);
            }
        } catch (e: any) {
            console.error(`\nError for "${ingredientName}" (${best.id}): ${e.message}`);
            errors++;
        }
    }

    await flushBatch();

    console.log(`\n\nDone.`);
    console.log(`  Wrote:   ${wrote}`);
    console.log(`  Skipped: ${skipped} (already indexed)`);
    console.log(`  Errors:  ${errors}`);
    if (DRY_RUN) console.log(`  (DRY RUN — nothing was written)`);

    process.exit(0);
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
