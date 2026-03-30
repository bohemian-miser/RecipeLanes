/**
 * Backfill icon_index with embeddings for existing icons.
 * Reads up to N ingredients_new docs, picks best icon per ingredient,
 * embeds name + visualDescription, writes to icon_index.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/backfill-icon-index.ts [--limit 400] [--dry-run]
 */
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { GoogleAuth } from 'google-auth-library';

const PROJECT = 'recipe-lanes-staging';
const EMBED_BATCH = 5;    // docs per embedding API call (one call per doc, rate limiting)
const WRITE_BATCH = 100;  // Firestore batch write size
const DELAY_MS = 200;     // ms between embedding calls to avoid quota errors

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force'); // re-index even already-indexed docs
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 400;

async function getAccessToken(): Promise<string> {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token.token!;
}

let cachedToken: string | null = null;
let tokenExpiry = 0;
async function token(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;
  cachedToken = await getAccessToken();
  tokenExpiry = Date.now() + 3600000;
  return cachedToken;
}

async function embedTexts(texts: string[]): Promise<number[]> {
  const t = await token();
  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/us-central1/publishers/google/models/text-embedding-004:predict`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ instances: texts.map(text => ({ content: text, task_type: 'RETRIEVAL_DOCUMENT' })) })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Embed API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json() as any;
  const vecs: number[][] = data.predictions.map((p: any) => p.embeddings.values as number[]);
  if (vecs.length === 1) return vecs[0];
  const dim = vecs[0].length;
  const avg = new Array(dim).fill(0) as number[];
  for (const vec of vecs) for (let i = 0; i < dim; i++) avg[i] += vec[i] / vecs.length;
  return avg;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('Set GOOGLE_APPLICATION_CREDENTIALS=./service-account.json');
    process.exit(1);
  }

  admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  console.log(`[backfill] Starting. limit=${LIMIT}, dry_run=${DRY_RUN}`);

  // Check existing icon_index to skip already-indexed icons
  const existingSnap = await db.collection('icon_index').get();
  const indexed = new Set(existingSnap.docs.map(d => d.id));
  console.log(`[backfill] Already indexed: ${indexed.size} icons`);

  // Fetch ingredients_new docs
  const ingSnap = await db.collection('ingredients_new').limit(LIMIT * 2).get(); // over-fetch since some may have no icons
  console.log(`[backfill] ingredients_new docs fetched: ${ingSnap.docs.length}`);

  type Entry = { iconId: string; ingredientName: string; url: string; textsToEmbed: string[] };
  const toProcess: Entry[] = [];

  for (const doc of ingSnap.docs) {
    if (toProcess.length >= LIMIT) break;
    const data = doc.data();
    const icons: any[] = data.icons ?? [];
    if (icons.length === 0) continue;

    // Pick best icon by score, fallback to first
    const best = icons.reduce((a: any, b: any) => (b.score ?? 0) > (a.score ?? 0) ? b : a, icons[0]);
    if (!best?.id || !best?.url) continue;
    if (!FORCE && indexed.has(best.id)) { continue; }

    const name: string = data.name ?? doc.id;
    const vd: string = best.visualDescription ?? '';
    const textsToEmbed: string[] = vd && vd !== name ? [name, vd] : [name];

    // Include searchTerms texts if present
    const terms: any[] = best.searchTerms ?? [];
    if (terms.length > 0) textsToEmbed.push(...terms.map((t: any) => t.text).filter(Boolean));

    toProcess.push({ iconId: best.id, ingredientName: name, url: best.url, textsToEmbed });
  }

  console.log(`[backfill] Icons to process: ${toProcess.length}`);
  if (DRY_RUN) {
    console.log('[backfill] DRY RUN — first 5:');
    for (const e of toProcess.slice(0, 5)) console.log(`  ${e.iconId}: "${e.ingredientName}" (${e.textsToEmbed.length} texts)`);
    process.exit(0);
  }

  let wrote = 0;
  let errors = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const { iconId, ingredientName, url, textsToEmbed } = toProcess[i];
    try {
      const embedding = await embedTexts(textsToEmbed);
      const ref = db.collection('icon_index').doc(iconId);
      batch.set(ref, {
        icon_id: iconId,
        ingredient_name: ingredientName,
        url,
        embedding: FieldValue.vector(embedding),
        created_at: FieldValue.serverTimestamp()
      });
      batchCount++;
      wrote++;
      if (i % 10 === 0) process.stdout.write(`\r[backfill] ${i+1}/${toProcess.length} (${errors} errors)  `);
    } catch (e: any) {
      console.error(`\n[backfill] embed error for "${ingredientName}": ${e.message}`);
      errors++;
    }

    if (batchCount >= WRITE_BATCH) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
    if (DELAY_MS > 0) await sleep(DELAY_MS);
  }

  if (batchCount > 0) await batch.commit();

  console.log(`\n[backfill] Done. wrote=${wrote}, errors=${errors}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
