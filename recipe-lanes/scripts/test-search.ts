import * as path from 'path';
import * as dotenv from 'dotenv';

// Parse arguments early to load correct env
const args = process.argv.slice(2);
let envArg = 'local';
for (const arg of args) {
  if (arg === '--local') envArg = 'local';
  else if (arg === '--staging') envArg = 'staging';
  else if (arg === '--prod') envArg = 'prod';
}

if (envArg === 'staging') {
    dotenv.config({ path: path.resolve(__dirname, '../.env.staging') });
} else if (envArg === 'prod') {
    dotenv.config({ path: path.resolve(__dirname, '../.env.prod') });
} else {
    dotenv.config({ path: path.resolve(__dirname, '../.env') });
}

import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { app } from '../lib/firebase-client';

// Usage: npx tsx test-search.ts [query] [--local|--staging|--prod]
async function run() {
  let query = "A bowl of fresh eggs";
  let env = envArg;

  // Parse query
  for (const arg of args) {
    if (!arg.startsWith('--')) query = arg;
  }

  if (args.includes('--prod') && args.includes('--staging')) {
    console.error('Error: --staging and --prod are mutually exclusive.');
    process.exit(1);
  }

  console.log(`===================================================`);
  console.log(`🔍 Environment: ${env}`);
  console.log(`🔍 Searching for: '${query}'`);
  console.log(`===================================================`);

  const functions = getFunctions(app, 'us-central1'); // adjust region if needed
  
  if (env === 'local') {
      connectFunctionsEmulator(functions, "127.0.0.1", 5001);
      console.log('🔗 Connected to local Firebase Emulator on port 5001.');
  } else {
      console.log(`🔗 Targeting Firebase Functions for project: ${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'default'}`);
  }

  const searchIconVector = httpsCallable<{ query: string, limit: number }, any>(functions, 'vectorSearch-searchIconVector');
  
  try {
      console.log('⏳ Invoking searchIconVector Cloud Function...');
      const t0 = Date.now();
      const res = await searchIconVector({ query, limit: 12 });
      const duration = Date.now() - t0;
      
      const { embedding, fast_matches, snapshot_timestamp } = res.data;
      console.log(`✅ Success in ${duration}ms!`);
      console.log(`- Returned embedding vector length: ${embedding?.length}`);
      console.log(`- Snapshot timestamp: ${new Date(snapshot_timestamp).toISOString()}`);
      console.log(`- Fast matches found: ${fast_matches?.length}`);
      
      console.log('Top 3 Matches:');
      (fast_matches || []).slice(0, 3).forEach((m: any, i: number) => {
          console.log(`   ${i + 1}. [${m.icon_id}] Score: ${m.score.toFixed(4)}`);
      });
  } catch (err: any) {
      console.error(`❌ Cloud Function Error: ${err.message}`);
  }
}

run().catch(console.error);
