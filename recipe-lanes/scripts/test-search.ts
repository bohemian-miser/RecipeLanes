import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import * as admin from 'firebase-admin';

// Parse env + flags early — must happen before firebase imports
const args = process.argv.slice(2);
let envArg = 'local';
let topN = 5;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--staging') envArg = 'staging';
  else if (args[i] === '--prod') envArg = 'prod';
  else if (args[i] === '--local') envArg = 'local';
  else if (args[i] === '--top' && args[i + 1]) { topN = parseInt(args[i + 1], 10); i++; }
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

// ---------------------------------------------------------------------------
// CLI syntax
//
// Single ingredient (queries are HyDE variants, averaged by the CF):
//   npx tsx scripts/test-search.ts "fresh tomatoes" "sliced red tomato" --staging
//
// Multiple ingredients in parallel (groups separated by --):
//   npx tsx scripts/test-search.ts "fresh tomatoes" "red tomato" -- "rack of lamb" -- "butter" --staging
//
// Flags:
//   --top N      Show top N results per group (default 5)
//   --staging / --prod / --local
// ---------------------------------------------------------------------------

function parseQueryGroups(args: string[]): string[][] {
    const groups: string[][] = [];
    let current: string[] = [];
    for (const arg of args) {
        if (arg === '--') {
            if (current.length) { groups.push(current); current = []; }
        } else if (arg === '--top') {
            // skip: already consumed above
        } else if (!arg.startsWith('--')) {
            // skip numeric arg after --top
            if (current.length === 0 && groups.length === 0 && /^\d+$/.test(arg) &&
                args[args.indexOf(arg) - 1] === '--top') continue;
            current.push(arg);
        }
    }
    if (current.length) groups.push(current);
    return groups.length ? groups : [['A bowl of fresh eggs']];
}

// ---------------------------------------------------------------------------
// Admin SDK for icon name lookups
// ---------------------------------------------------------------------------
let adminDb: admin.firestore.Firestore | null = null;

function initAdmin(): admin.firestore.Firestore | null {
    if (envArg === 'local') return null; // use emulator or skip
    if (adminDb) return adminDb;
    const saPath = path.resolve(__dirname, `../${envArg}-service-account.json`);
    if (!fs.existsSync(saPath)) {
        console.warn(`  (no service account at ${saPath} — icon names will not be resolved)`);
        return null;
    }
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.cert(require(saPath)) });
    }
    adminDb = admin.firestore();
    return adminDb;
}

async function resolveIconNames(iconIds: string[]): Promise<Map<string, string>> {
    const db = initAdmin();
    const map = new Map<string, string>();
    if (!db || iconIds.length === 0) return map;
    try {
        const refs = iconIds.map(id => db.collection('icon_index').doc(id));
        const docs = await db.getAll(...refs);
        for (const doc of docs) {
            if (!doc.exists) continue;
            const d = doc.data()!;
            map.set(doc.id, d.visualDescription || d.ingredient_name || doc.id);
        }
    } catch (e: any) {
        console.warn(`  (icon name lookup failed: ${e.message})`);
    }
    return map;
}

// ---------------------------------------------------------------------------
// Client SDK for CF calls
// ---------------------------------------------------------------------------
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

const clientApp = initializeApp(firebaseConfig);

function scoreBar(score: number): string {
    const filled = Math.round(score * 20);
    return '█'.repeat(filled).padEnd(20, '░');
}

async function run() {
    const groups = parseQueryGroups(args);
    const env = envArg;
    const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '(unknown)';

    console.log(`===================================================`);
    console.log(` Env:    ${env} (${project})`);
    console.log(` Groups: ${groups.length}  (1 batch call)  |  top ${topN} per group`);
    groups.forEach((g, i) => console.log(`  [${i + 1}] ${g.map(q => `"${q}"`).join(', ')}`));
    console.log(`===================================================`);

    const functions = getFunctions(clientApp, 'us-central1');
    if (env === 'local') {
        connectFunctionsEmulator(functions, '127.0.0.1', 5001);
        console.log('Connected to local emulator on :5001');
    }

    const fn = httpsCallable(functions, 'vectorSearch-searchIconVector');
    const ingredients = groups.map((queries, i) => ({ name: `group-${i + 1}`, queries }));

    const t0 = Date.now();
    let batchResults: any[];
    let snapshotTimestamp: number | null = null;
    try {
        const res: any = await fn({ ingredients, limit: Math.max(topN, 12) });
        const ms = Date.now() - t0;
        batchResults = res.data.results;
        snapshotTimestamp = res.data.snapshot_timestamp ?? null;
        const snapshotAge = snapshotTimestamp
            ? Math.round((Date.now() - snapshotTimestamp) / 1000 / 60 / 60)
            : null;
        console.log(`\n  OK  ${ms}ms  |  snapshot ${snapshotAge !== null ? `${snapshotAge}h ago` : 'n/a'}  |  ${batchResults.length} ingredients`);
    } catch (err: any) {
        console.error(`\n  FAIL  ${Date.now() - t0}ms  ${err.message}${err.code ? `  (${err.code})` : ''}`);
        return;
    }

    // Collect all icon IDs for a single Firestore name lookup
    const allIconIds = batchResults.flatMap((r: any) => (r.fast_matches ?? []).slice(0, topN).map((m: any) => m.icon_id));
    const names = await resolveIconNames(allIconIds);

    for (let i = 0; i < batchResults.length; i++) {
        const { name, embedding, fast_matches } = batchResults[i];
        const label = groups[i].map(q => `"${q}"`).join(', ');
        console.log(`\n[${i + 1}] ${label}`);
        console.log(`    dim=${embedding?.length}  |  ${fast_matches?.length ?? 0} matches`);
        const topMatches = (fast_matches ?? []).slice(0, topN);
        console.log(`    Top ${topN}:`);
        for (const m of topMatches) {
            const iconName = names.get(m.icon_id) ?? m.icon_id;
            const bar = scoreBar(m.score ?? 0);
            console.log(`      ${m.score?.toFixed(4)}  |${bar}|  ${iconName}`);
        }
    }

    console.log(`\n===================================================`);
    console.log(` Total wall time: ${Date.now() - t0}ms`);
}

run().catch(console.error);
