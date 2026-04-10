import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import * as admin from 'firebase-admin';

// Parse env + flags early — must happen before firebase imports
const args = process.argv.slice(2);
let envArg = 'local';
let topN = 5;
let recipeId: string | null = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--staging') envArg = 'staging';
  else if (args[i] === '--prod') envArg = 'prod';
  else if (args[i] === '--local') envArg = 'local';
  else if (args[i] === '--top' && args[i + 1]) { topN = parseInt(args[i + 1], 10); i++; }
  else if (args[i] === '--recipe' && args[i + 1]) { recipeId = args[i + 1]; i++; }
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
// Manual groups (queries are HyDE variants, averaged by the CF):
//   npx tsx scripts/test-search.ts "fresh tomatoes" "red tomato" -- "rack of lamb" -- "butter" --staging
//
// From a real recipe (pulls HyDE queries from Firestore):
//   npx tsx scripts/test-search.ts --recipe <recipeId> --staging
//
// Flags:
//   --top N            Show top N results per group (default 5)
//   --recipe <id>      Pull ingredients+hydeQueries from Firestore recipe
//   --staging / --prod / --local
// ---------------------------------------------------------------------------

function parseQueryGroups(args: string[]): string[][] {
    const groups: string[][] = [];
    let current: string[] = [];
    for (const arg of args) {
        if (arg === '--') {
            if (current.length) { groups.push(current); current = []; }
        } else if (arg === '--top' || arg === '--recipe') {
            // skip: already consumed above
        } else if (!arg.startsWith('--')) {
            // skip numeric arg after --top or id after --recipe
            const prev = args[args.indexOf(arg) - 1];
            if ((prev === '--top' || prev === '--recipe') && (current.length === 0 && groups.length === 0)) continue;
            current.push(arg);
        }
    }
    if (current.length) groups.push(current);
    return groups.length ? groups : [['A bowl of fresh eggs']];
}

// ---------------------------------------------------------------------------
// Admin SDK for Firestore lookups (icon names + recipe data)
// ---------------------------------------------------------------------------
let adminDb: admin.firestore.Firestore | null = null;

function initAdmin(): admin.firestore.Firestore | null {
    if (envArg === 'local') return null;
    if (adminDb) return adminDb;
    const saPath = path.resolve(__dirname, `../${envArg}-service-account.json`);
    if (!fs.existsSync(saPath)) {
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
        } else {
            console.warn(`  (no service account at ${saPath} — icon names/recipe will not be resolved)`);
            return null;
        }
    } else {
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(saPath)) });
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
// Pull ingredient groups from a real recipe
// ---------------------------------------------------------------------------
async function loadGroupsFromRecipe(id: string): Promise<{ name: string; queries: string[] }[]> {
    const db = initAdmin();
    if (!db) throw new Error('Need service account or ADC to load recipe from Firestore');

    const { standardizeIngredientName } = await import('../lib/utils');
    const { getNodeIngredientName, getNodeHydeQueries } = await import('../lib/recipe-lanes/model-utils');

    const doc = await db.collection('recipes').doc(id).get();
    if (!doc.exists) throw new Error(`Recipe ${id} not found`);
    const nodes: any[] = doc.data()?.graph?.nodes ?? [];

    const hydeMap = new Map<string, string[]>();
    for (const node of nodes) {
        if (!node.visualDescription) continue;
        const stdName = standardizeIngredientName(getNodeIngredientName(node));
        const queries: string[] = getNodeHydeQueries(node);
        const existing = hydeMap.get(stdName) ?? [];
        hydeMap.set(stdName, Array.from(new Set([...existing, ...queries])));
    }

    return Array.from(hydeMap.entries()).map(([name, queries]) => ({
        name,
        queries: queries.length ? queries : [name],
    }));
}

// ---------------------------------------------------------------------------
// Client SDK
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
    const env = envArg;
    const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '(unknown)';
    const functions = getFunctions(clientApp, 'us-central1');
    if (env === 'local') {
        connectFunctionsEmulator(functions, '127.0.0.1', 5001);
        console.log('Connected to local emulator on :5001');
    }

    // Build ingredient groups — either from recipe or from CLI args
    let groups: { name: string; queries: string[] }[];
    if (recipeId) {
        console.log(`Loading recipe ${recipeId} from Firestore...`);
        groups = await loadGroupsFromRecipe(recipeId);
        console.log(`Loaded ${groups.length} ingredients`);
        groups.forEach((g, i) => console.log(`  [${i + 1}] ${g.name} — ${g.queries.length} queries`));
    } else {
        const rawGroups = parseQueryGroups(args);
        groups = rawGroups.map((queries, i) => ({ name: `group-${i + 1}`, queries }));
    }

    const totalQueries = groups.reduce((s, g) => s + g.queries.length, 0);

    console.log(`\n===================================================`);
    console.log(` Env:     ${env} (${project})`);
    console.log(` Groups:  ${groups.length}  (1 batch call)  |  top ${topN} per group`);
    console.log(` Queries: ${totalQueries} total`);
    console.log(`===================================================`);

    const fn = httpsCallable(functions, 'vectorSearch-searchIconVector');
    const ingredients = groups.map(g => ({ name: g.name, queries: g.queries }));

    const t0 = Date.now();
    let batchResults: any[];
    let snapshotTimestamp: number | null = null;
    try {
        const res: any = await fn({ ingredients, limit: Math.max(topN, 12) });
        const cfMs = Date.now() - t0;
        batchResults = res.data.results;
        snapshotTimestamp = res.data.snapshot_timestamp ?? null;
        const snapshotAge = snapshotTimestamp
            ? Math.round((Date.now() - snapshotTimestamp) / 1000 / 60 / 60)
            : null;
        console.log(`\n  CF: ${cfMs}ms  |  snapshot ${snapshotAge !== null ? `${snapshotAge}h ago` : 'n/a'}  |  ${batchResults.length} ingredients`);
    } catch (err: any) {
        console.error(`\n  FAIL  ${Date.now() - t0}ms  ${err.message}${err.code ? `  (${err.code})` : ''}`);
        return;
    }

    // Single Firestore name lookup for all icon IDs
    const t1 = Date.now();
    const allIconIds = batchResults.flatMap((r: any) => (r.fast_matches ?? []).slice(0, topN).map((m: any) => m.icon_id));
    const names = await resolveIconNames(allIconIds);
    const fsMs = Date.now() - t1;

    for (let i = 0; i < batchResults.length; i++) {
        const { name, embedding, fast_matches } = batchResults[i];
        const label = recipeId ? name : groups[i].queries.map(q => `"${q}"`).join(', ');
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
    console.log(` CF wall time:        ${Date.now() - t0}ms`);
    console.log(` Firestore name lookup: ${fsMs}ms`);
    console.log(` Total:               ${Date.now() - t0 + fsMs}ms`);
}

run().catch(console.error);
