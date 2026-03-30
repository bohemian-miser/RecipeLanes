/**
 * Local search test: embed a query and call findNearest against staging icon_index.
 * Usage: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/search-test.ts "arborio rice"
 */
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { GoogleAuth } from 'google-auth-library';

const PROJECT = 'recipe-lanes-staging';
const QUERY = process.argv[2] || 'egg';

async function getAccessToken(): Promise<string> {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token.token!;
}

async function embedTexts(texts: string[]): Promise<number[]> {
  const token = await getAccessToken();
  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/us-central1/publishers/google/models/text-embedding-004:predict`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ instances: texts.map(t => ({ content: t, task_type: 'RETRIEVAL_QUERY' })) })
  });
  if (!res.ok) throw new Error(`Embed API error: ${res.status} ${await res.text()}`);
  const data = await res.json() as any;
  const vecs: number[][] = data.predictions.map((p: any) => p.embeddings.values as number[]);
  // average if multiple texts
  const dim = vecs[0].length;
  const avg = new Array(dim).fill(0) as number[];
  for (const vec of vecs) for (let i = 0; i < dim; i++) avg[i] += vec[i] / vecs.length;
  return avg;
}

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.error('Set GOOGLE_APPLICATION_CREDENTIALS=./service-account.json');
    process.exit(1);
  }

  admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  // 1. Check collection size
  const countSnap = await db.collection('icon_index').count().get();
  console.log(`icon_index doc count: ${countSnap.data().count}`);

  // 2. List first 5 docs to verify shape
  const sample = await db.collection('icon_index').limit(5).get();
  console.log(`\nSample docs:`);
  for (const doc of sample.docs) {
    const d = doc.data();
    const embType = d.embedding?.constructor?.name ?? typeof d.embedding;
    console.log(`  ${doc.id}: ingredient="${d.ingredient_name}", url=${d.url?.substring(0,60)}, embedding type=${embType}`);
  }

  // 3. Embed the query
  console.log(`\nEmbedding query: "${QUERY}"`);
  const vec = await embedTexts([QUERY]);
  console.log(`Embedding dim: ${vec.length}, first 5 values: ${vec.slice(0,5).map(v => v.toFixed(4)).join(', ')}`);

  // 4. findNearest
  console.log(`\nRunning findNearest...`);
  try {
    const snap = await db.collection('icon_index')
      .findNearest('embedding', FieldValue.vector(vec), { limit: 10, distanceMeasure: 'COSINE' })
      .get();
    console.log(`Results: ${snap.docs.length}`);
    for (const doc of snap.docs) {
      const d = doc.data();
      console.log(`  ${d.icon_id}: "${d.ingredient_name}" — ${d.url?.substring(0,80)}`);
    }
  } catch (e: any) {
    console.error(`findNearest error: ${e.message}`);
    if (e.message?.includes('index')) console.log('  → Vector index may not be READY yet');
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
