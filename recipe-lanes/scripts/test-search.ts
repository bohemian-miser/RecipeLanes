import * as path from 'path';
import * as dotenv from 'dotenv';

// Parse arguments early so env is set before firebase-client imports
const args = process.argv.slice(2);
let envArg = 'local';
for (const arg of args) {
  if (arg === '--staging') envArg = 'staging';
  else if (arg === '--prod') envArg = 'prod';
  else if (arg === '--local') envArg = 'local';
}

if (envArg === 'staging') {
    dotenv.config({ path: path.resolve(__dirname, '../.env.staging') });
} else if (envArg === 'prod') {
    dotenv.config({ path: path.resolve(__dirname, '../.env.prod') });
} else {
    dotenv.config({ path: path.resolve(__dirname, '../.env') });
}

import { initializeApp } from 'firebase/app';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';

const firebaseConfig = {
    apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

if (!firebaseConfig.apiKey) {
    console.error('Missing NEXT_PUBLIC_FIREBASE_API_KEY — check your .env file.');
    process.exit(1);
}

const app = initializeApp(firebaseConfig);

// Usage: npx tsx scripts/test-search.ts "query 1" "query 2" ... [--local|--staging|--prod]
// All positional args become the queries array — the CF embeds them in parallel and averages.
async function run() {
  const queries = args.filter(a => !a.startsWith('--'));
  if (queries.length === 0) queries.push('A bowl of fresh eggs');

  const env = envArg;
  const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '(unknown)';

  console.log(`===================================================`);
  console.log(` Env:     ${env} (${project})`);
  console.log(`===================================================`);

  const functions = getFunctions(app, 'us-central1');

  if (env === 'local') {
      connectFunctionsEmulator(functions, '127.0.0.1', 5001);
      console.log('Connected to local emulator on :5001');
  }

    const searchIconVector = httpsCallable<{ queries: string[]; limit: number }, any>(
      functions, 'vectorSearch-searchIconVector'
  );

  console.log(`Queries (${queries.length}):`);
  queries.forEach((q, i) => console.log(`  ${i + 1}. "${q}"`));
  console.log('Calling vectorSearch-searchIconVector...');
  const t0 = Date.now();

  try {
      const res = await searchIconVector({ queries, limit: 12 });
      const ms = Date.now() - t0;
      const { embedding, fast_matches, snapshot_timestamp } = res.data;

      const snapshotAge = snapshot_timestamp
          ? Math.round((Date.now() - snapshot_timestamp) / 1000 / 60 / 60)
          : null;

      console.log(`\n OK  ${ms}ms`);
      console.log(` Embedding dim:    ${embedding?.length ?? 'n/a'} (averaged over ${queries.length} quer${queries.length === 1 ? 'y' : 'ies'})`);
      console.log(` Index snapshot:   ${snapshot_timestamp ? new Date(snapshot_timestamp).toISOString() : 'n/a'}${snapshotAge !== null ? ` (${snapshotAge}h ago)` : ''}`);
      console.log(` Matches returned: ${fast_matches?.length ?? 0}`);

      if (fast_matches?.length > 0) {
          console.log(`\n Top matches:`);
          (fast_matches as any[]).slice(0, 5).forEach((m: any, i: number) => {
              const bar = '█'.repeat(Math.round((m.score ?? 0) * 20)).padEnd(20);
              console.log(`   ${i + 1}. ${m.icon_id}`);
              console.log(`      score: ${m.score?.toFixed(4)} |${bar}|`);
          });
      } else {
          console.warn('\n  No matches — icon index may be empty or model failed to load.');
          console.warn('  Run: npx tsx scripts/export-icon-index.ts --staging');
          console.warn('  Then redeploy: ./scripts/vector-search.sh deploy --staging');
      }
  } catch (err: any) {
      const ms = Date.now() - t0;
      console.error(`\n FAIL  ${ms}ms`);
      console.error(` ${err.message}`);
      if (err.code) console.error(` code: ${err.code}`);
  }

  console.log(`\n===================================================`);
}

run().catch(console.error);
