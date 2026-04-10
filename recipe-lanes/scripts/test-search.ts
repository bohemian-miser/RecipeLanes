import * as path from 'path';
import * as dotenv from 'dotenv';

// Parse env flag early — must happen before firebase imports
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

// ---------------------------------------------------------------------------
// CLI syntax
//
// Single ingredient (queries are HyDE variants, averaged by the CF):
//   npx tsx scripts/test-search.ts "fresh tomatoes" "sliced red tomato" --staging
//
// Multiple ingredients in parallel (groups separated by --):
//   npx tsx scripts/test-search.ts "fresh tomatoes" "red tomato" -- "rack of lamb" "lamb chop" -- "butter" --staging
//
// Each group is one CF call; all groups run in parallel.
// ---------------------------------------------------------------------------

function parseQueryGroups(args: string[]): string[][] {
    const groups: string[][] = [];
    let current: string[] = [];
    for (const arg of args) {
        if (arg.startsWith('--')) {
            // env flags and '--' separator
            if (arg === '--') {
                if (current.length) { groups.push(current); current = []; }
            }
            // skip env flags
        } else {
            current.push(arg);
        }
    }
    if (current.length) groups.push(current);
    return groups.length ? groups : [['A bowl of fresh eggs']];
}

const app = initializeApp(firebaseConfig);

async function searchOne(
    fn: ReturnType<typeof httpsCallable>,
    queries: string[],
    groupIdx: number,
): Promise<void> {
    const label = queries.length === 1 ? `"${queries[0]}"` : `[${queries.map(q => `"${q}"`).join(', ')}]`;
    process.stdout.write(`[${groupIdx + 1}] ${label} — calling...\n`);
    const t0 = Date.now();
    try {
        const res: any = await fn({ queries, limit: 12 });
        const ms = Date.now() - t0;
        const { embedding, fast_matches, snapshot_timestamp } = res.data;
        const snapshotAge = snapshot_timestamp
            ? Math.round((Date.now() - snapshot_timestamp) / 1000 / 60 / 60)
            : null;

        const top = (fast_matches ?? []).slice(0, 3)
            .map((m: any) => `${m.score?.toFixed(3)} ${m.icon_id.slice(0, 8)}`)
            .join('  ');

        console.log(
            `[${groupIdx + 1}] OK  ${ms}ms  dim=${embedding?.length}  ` +
            `snapshot=${snapshotAge !== null ? `${snapshotAge}h ago` : 'n/a'}  ` +
            `matches=${fast_matches?.length ?? 0}`
        );
        console.log(`[${groupIdx + 1}] top: ${top || '(none)'}`);
    } catch (err: any) {
        const ms = Date.now() - t0;
        console.error(`[${groupIdx + 1}] FAIL  ${ms}ms  ${err.message}${err.code ? `  (${err.code})` : ''}`);
    }
}

async function run() {
    const groups = parseQueryGroups(args);
    const env = envArg;
    const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '(unknown)';

    console.log(`===================================================`);
    console.log(` Env:     ${env} (${project})`);
    console.log(` Groups:  ${groups.length}  (all run in parallel)`);
    groups.forEach((g, i) => console.log(`  [${i + 1}] ${g.map(q => `"${q}"`).join(', ')}`));
    console.log(`===================================================`);

    const functions = getFunctions(app, 'us-central1');
    if (env === 'local') {
        connectFunctionsEmulator(functions, '127.0.0.1', 5001);
        console.log('Connected to local emulator on :5001');
    }

    const fn = httpsCallable(functions, 'vectorSearch-searchIconVector');

    const t0 = Date.now();
    await Promise.all(groups.map((g, i) => searchOne(fn, g, i)));
    console.log(`\n===================================================`);
    console.log(` Total wall time: ${Date.now() - t0}ms`);
}

run().catch(console.error);
