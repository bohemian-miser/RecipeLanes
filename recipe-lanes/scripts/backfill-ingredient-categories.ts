/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Backfills the `ingredient_categories` lookup collection — one doc per
 * distinct ingredient label, carrying the label's taxonomy category.
 *
 * Pipeline:
 *   1. Scan `recipes`, extracting ingredient labels with the SAME pure logic
 *      the comparison table uses (`ingredient-label-extract`), so the doc ids
 *      written here are exactly the keys the table will look up.
 *   2. Skip labels that already have a GOOD doc (see idempotency below).
 *   3. Classify the rest with Vertex Gemini 2.5 Flash, in batches, using the
 *      shared prompt/parser from `lib/recipe-lanes/ingredient-taxonomy`.
 *      A batch that comes back incomplete is retried for its missing labels
 *      only; a batch whose RESPONSE was truncated is split in half instead,
 *      since retrying an over-long request identically just truncates again.
 *   4. Cross-check each label against seed-anchor MiniLM embeddings and store
 *      the nearest anchor's category as `nnCategory`/`nnScore`. ADVISORY ONLY
 *      — the LLM is authoritative; the NN is known-bad on non-English labels.
 *      Its value is the disagreement report, which is where misclassifications
 *      show up for a human to eyeball.
 *   5. Write the docs, and always print (and dump to JSON) the evidence:
 *      per-category counts, top labels per category, the disagreement table.
 *
 * IDEMPOTENCY / RESUMABILITY. Re-running is cheap and safe: a label that
 * already has a doc is not re-classified. The exception is deliberate — docs
 * with `source: 'fallback'` are NOT treated as done. A fallback doc means the
 * classifier failed for that label and it was parked in `other`, so skipping
 * it would make one bad run permanent: the damage would survive every
 * subsequent run and could only be undone by a full `--force` pass. Instead
 * fallbacks are retried automatically on the next run.
 *
 * For the same reason the run REFUSES to write when more than
 * `MAX_FALLBACK_FRACTION` of it fell back — that is a broken Vertex endpoint,
 * not a hard corpus, and persisting it would poison the collection with
 * `other`. Use `--force-fallbacks` to write anyway once you know why.
 *
 * Usage:
 *   npx tsx scripts/backfill-ingredient-categories.ts (--staging | --prod)
 *       [--dry-run] [--limit N] [--force] [--force-fallbacks] [--out path.json]
 *
 * `--staging` or `--prod` is REQUIRED — this script writes, so the target must
 * be stated rather than defaulted. `--dry-run` performs zero Firestore writes
 * (it still reads, classifies and embeds, which is the point: it is how the
 * classification quality gets reviewed before anything is persisted).
 *
 * NOTE (follow-up): the Vertex REST call + token cache, the `withConcurrency`
 * helper and the MiniLM embedder setup below are near-duplicates of the ones
 * in `backfill-icon-search-terms.ts` / `backfill-embeddings.ts`. Extracting
 * them into `scripts/lib/` is worth doing, but it touches those scripts and
 * belongs in its own PR rather than riding along with this one.
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { GoogleAuth } from 'google-auth-library';
import { pipeline, env as hfEnv } from '@huggingface/transformers';
import { DB_COLLECTION_RECIPES } from '../lib/config';
import { scanCollection } from './lib/db-tools';
import { cosineSimilarity } from '../lib/recipe-lanes/model-utils';
import {
    buildClassificationPrompt,
    parseClassificationResponse,
    COMPARISON_CATEGORY_IDS,
    FALLBACK_CATEGORY_ID,
    getIngredientCategory,
} from '../lib/recipe-lanes/ingredient-taxonomy';
import {
    createIngredientLabelCollector,
    ingredientCategoryDocId,
    type IngredientLabelUsage,
} from '../lib/recipe-lanes/ingredient-label-extract';
import type { RecipeGraph } from '../lib/recipe-lanes/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The lookup collection this script owns. */
const COLLECTION = 'ingredient_categories';

const MODEL = 'gemini-2.5-flash';
const VERTEX_LOCATION = 'us-central1';

/** Labels per classification call. ~90 calls for the full prod corpus. */
const BATCH_SIZE = 50;
/** Extra attempts for a batch that comes back missing/invalid labels. */
const MAX_RETRIES = 2;
/** How many times a truncated batch may be halved before giving up. */
const MAX_SPLIT_DEPTH = 4;
/** Classification calls in flight at once. */
const CONCURRENCY = 4;

/** Backoff before retry N (1-based), before jitter. */
const BACKOFF_MS = [2_000, 8_000];
/** Floor for the cool-down applied after a 429, if the server suggests none. */
const RATE_LIMIT_COOLDOWN_MS = 10_000;

/** Refuse to write a run that fell back on more than this fraction of labels. */
const MAX_FALLBACK_FRACTION = 0.2;

/** Firestore's own cap is 500 ops; siblings stay at 200 for headroom. */
const WRITE_BATCH_SIZE = 200;
/** `getAll` fan-out when checking which labels already have a doc. */
const READ_CHUNK_SIZE = 100;

/** Minimum cosine similarity for an NN opinion to be worth reporting. */
const NN_REPORT_THRESHOLD = 0.6;
/** Rows shown per category in the "top labels" section of the report. */
const TOP_LABELS_PER_CATEGORY = 15;

/**
 * Seed anchors for the nearest-neighbour cross-check, carried over from the
 * taxonomy survey's `nn-preliminary` run. These are deliberately *phrases* as
 * they appear in recipes ("ground beef", not "beef") because MiniLM is a
 * sentence encoder — anchoring on bare category names scores much worse.
 */
const SEED_ANCHORS: Record<string, string[]> = {
    proteins: ['ground beef', 'chicken pieces', 'beef', 'bacon', 'salmon fillet', 'pork', 'shrimp', 'chicken breast', 'tofu'],
    aromatics: ['chopped onion', 'garlic cloves', 'fresh ginger', 'shallots', 'spring onion', 'leek', 'minced garlic'],
    herbs_spices: ['fresh parsley', 'fresh dill', 'thyme leaves', 'basil leaves', 'dried oregano', 'cilantro', 'salt', 'black pepper', 'chili powder', 'ground cumin', 'garam masala', 'paprika', 'cinnamon'],
    fats_oils: ['olive oil', 'vegetable oil', 'unsalted butter', 'sesame oil', 'ghee', 'coconut oil'],
    dairy_eggs: ['whole milk', 'eggs', 'heavy cream', 'grated parmesan cheese', 'yogurt', 'cream cheese', 'sour cream'],
    vegetables: ['chopped carrots', 'crushed tomatoes', 'fresh spinach leaves', 'sliced mushrooms', 'broccoli', 'zucchini', 'red bell pepper'],
    fruits: ['bananas', 'apple', 'strawberries', 'mango', 'raisins', 'orange'],
    grains_starches: ['all-purpose flour', 'pasta', 'cooked rice', 'breadcrumbs', 'cornstarch', 'bread', 'egg noodles', 'rolled oats', 'potatoes'],
    sweeteners: ['granulated sugar', 'brown sugar', 'honey', 'maple syrup', 'powdered sugar', 'chocolate'],
    nuts_seeds: ['almonds', 'sesame seeds', 'roasted peanuts', 'walnuts', 'pine nuts', 'cashew nuts'],
    condiments_liquids: ['soy sauce', 'tomato paste', 'white wine vinegar', 'lemon juice', 'water', 'chicken stock', 'red wine', 'fish sauce', 'mayonnaise', 'ketchup'],
};

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

interface Flags {
    envName: 'staging' | 'prod';
    dryRun: boolean;
    force: boolean;
    forceFallbacks: boolean;
    limit: number;
    outPath: string;
}

function flagValue(args: string[], name: string): string | undefined {
    const index = args.indexOf(name);
    if (index === -1) return undefined;
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
        fail(`${name} needs a value.`);
    }
    return value;
}

function fail(message: string): never {
    console.error(`\n  ${message}\n`);
    console.error('Usage: npx tsx scripts/backfill-ingredient-categories.ts (--staging | --prod)');
    console.error('           [--dry-run] [--limit N] [--force] [--force-fallbacks] [--out path.json]\n');
    process.exit(1);
}

function parseFlags(args: string[]): Flags {
    const staging = args.includes('--staging');
    const prod = args.includes('--prod');
    // Deliberately no default: this script writes to a real database, and
    // guessing which one is not a thing it should ever do.
    if (staging === prod) {
        fail(staging ? 'Pass exactly one of --staging / --prod, not both.' : 'Pass --staging or --prod: this script writes, so the target must be explicit.');
    }
    const envName = prod ? 'prod' : 'staging';

    const rawLimit = flagValue(args, '--limit');
    let limit = Infinity;
    if (rawLimit !== undefined) {
        limit = Number(rawLimit);
        if (!Number.isInteger(limit) || limit <= 0) fail(`--limit must be a positive integer, got "${rawLimit}".`);
    }

    const date = new Date().toISOString().slice(0, 10);
    return {
        envName,
        dryRun: args.includes('--dry-run'),
        force: args.includes('--force'),
        forceFallbacks: args.includes('--force-fallbacks'),
        limit,
        outPath: flagValue(args, '--out') ?? `./ingredient-categories-${envName}-${date}.json`,
    };
}

// ---------------------------------------------------------------------------
// Environment / credentials
// ---------------------------------------------------------------------------

/** First existing candidate, or undefined. Paths are relative to recipe-lanes/. */
function firstExisting(candidates: string[]): string | undefined {
    for (const candidate of candidates) {
        const resolved = path.resolve(__dirname, '..', candidate);
        if (fs.existsSync(resolved)) return resolved;
    }
    return undefined;
}

interface Target {
    db: admin.firestore.Firestore;
    /** GCP project id, from the service account. Used for Firestore AND Vertex. */
    projectId: string;
}

function initFirebase(envName: Flags['envName']): Target {
    // Prod config lives in `.env` (there is no `.env.prod`); staging in `.env.staging`.
    const envFile = firstExisting(envName === 'prod' ? ['.env.prod', '.env'] : ['.env.staging']);
    if (!envFile) fail(`No env file found for ${envName}. These are gitignored — copy them into this checkout.`);
    dotenv.config({ path: envFile, override: true });

    const serviceAccountPath = firstExisting(
        envName === 'prod'
            ? ['prod-service-account.json', 'service-account.json']
            : ['staging-service-account.json'],
    );
    if (!serviceAccountPath) fail(`No ${envName} service-account JSON found. These are gitignored — copy one into this checkout.`);

    // Vertex auth (GoogleAuth, below) reads this; pin it to the same account
    // Firestore uses so the two can never end up on different projects.
    process.env.GOOGLE_APPLICATION_CREDENTIALS = serviceAccountPath;

    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    const projectId: string | undefined = serviceAccount.project_id;
    if (!projectId) fail(`Service account ${serviceAccountPath} has no project_id.`);

    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId });
    }
    console.log(`ENV FILE:  ${path.relative(path.resolve(__dirname, '..'), envFile)}`);
    // The credential's own project — NOT an env var and not a hardcoded guess.
    // Firestore and Vertex both use exactly this, so a staging key can never
    // read staging data while billing/classifying against the prod project.
    console.log(`PROJECT:   ${projectId} (from ${path.basename(serviceAccountPath)})`);
    return { db: admin.firestore(), projectId };
}

// ---------------------------------------------------------------------------
// Vertex Gemini (REST) — same shape as backfill-icon-search-terms.ts
// ---------------------------------------------------------------------------

let cachedToken: string | null = null;
let tokenExpiry = 0;
async function getToken(): Promise<string> {
    if (cachedToken && Date.now() < tokenExpiry - 60_000) return cachedToken;
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token.token) throw new Error('GoogleAuth returned no access token');
    cachedToken = token.token;
    tokenExpiry = Date.now() + 3_600_000;
    return cachedToken;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Shared rate-limit gate. Workers run concurrently, so a 429 seen by one of
 * them is information for ALL of them: without this, the other three keep
 * hammering the endpoint that just asked everyone to slow down, and the whole
 * run degrades into retries. Set on 429, awaited before every call.
 */
let cooldownUntil = 0;

async function respectCooldown(): Promise<void> {
    while (Date.now() < cooldownUntil) {
        await sleep(cooldownUntil - Date.now());
    }
}

/** Backoff for retry `attempt` (1-based), with ±50% jitter to de-sync workers. */
function backoffFor(attempt: number): number {
    const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length) - 1];
    return Math.round(base * (0.5 + Math.random()));
}

/** `Retry-After` is either delta-seconds or an HTTP date. 0 when absent/bogus. */
function parseRetryAfter(header: string | null): number {
    if (!header) return 0;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(header);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

/**
 * Thrown when the model ran out of output budget mid-answer. Retrying the same
 * request just truncates again at the same place, so the caller must make the
 * request SMALLER rather than repeat it — hence its own error type.
 */
class TruncatedResponseError extends Error {}

async function callGemini(projectId: string, prompt: string, backoffMs: number): Promise<string> {
    await respectCooldown();
    const token = await getToken();
    const url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${VERTEX_LOCATION}/publishers/google/models/${MODEL}:generateContent`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                // Classification into a closed enum: no reason to sample.
                temperature: 0,
                responseMimeType: 'application/json',
                maxOutputTokens: 8192,
                // Thinking tokens are billed against maxOutputTokens, so on a
                // 2.5 model a long "think" can eat the whole budget and the
                // answer comes back truncated. Looking up 50 labels in a fixed
                // table needs no deliberation, so switch it off outright.
                thinkingConfig: { thinkingBudget: 0 },
            },
        }),
    });

    if (res.status === 429) {
        const wait = Math.max(parseRetryAfter(res.headers.get('retry-after')), backoffMs, RATE_LIMIT_COOLDOWN_MS);
        cooldownUntil = Math.max(cooldownUntil, Date.now() + wait);
        throw new Error(`Vertex 429 rate limited — all workers cooling down ${Math.round(wait / 1000)}s`);
    }
    if (!res.ok) {
        const body = await res.text();
        // RESOURCE_EXHAUSTED sometimes arrives as 4xx/5xx rather than a clean 429.
        if (body.includes('RESOURCE_EXHAUSTED')) {
            const wait = Math.max(backoffMs, RATE_LIMIT_COOLDOWN_MS);
            cooldownUntil = Math.max(cooldownUntil, Date.now() + wait);
            throw new Error(`Vertex ${res.status} RESOURCE_EXHAUSTED — cooling down ${Math.round(wait / 1000)}s`);
        }
        throw new Error(`Vertex ${res.status}: ${body.slice(0, 300)}`);
    }

    const data: any = await res.json();
    const candidate = data.candidates?.[0];
    const text: string = (candidate?.content?.parts ?? [])
        .map((p: any) => p?.text ?? '')
        .join('');

    if (candidate?.finishReason === 'MAX_TOKENS') {
        throw new TruncatedResponseError(`response hit MAX_TOKENS after ${text.length} chars`);
    }
    if (!text) {
        throw new Error(`Empty response (finishReason=${candidate?.finishReason ?? 'unknown'})`);
    }
    return text;
}

/**
 * Classifies one batch, retrying only the labels that did not come back
 * usable. Returns the assignments it managed to get; anything absent from the
 * result is the caller's fallback problem.
 */
async function classifyBatch(
    projectId: string,
    labels: string[],
    log: (message: string) => void,
    depth = 0,
): Promise<Map<string, string>> {
    const resolved = new Map<string, string>();
    let outstanding = labels;

    for (let attempt = 1; attempt <= MAX_RETRIES + 1 && outstanding.length > 0; attempt++) {
        if (attempt > 1) await sleep(backoffFor(attempt - 1));
        try {
            const raw = await callGemini(projectId, buildClassificationPrompt(outstanding), backoffFor(attempt));
            const result = parseClassificationResponse(raw, outstanding);
            // `assignments` is null-prototype by design (a label may literally
            // be "__proto__"), so read it with Object.entries / bracket access.
            for (const [label, category] of Object.entries(result.assignments)) {
                resolved.set(label, category);
            }
            if (result.invalid.length > 0) {
                log(`  attempt ${attempt}: ${result.invalid.length} invalid category value(s), e.g. ${result.invalid.slice(0, 3).map(i => `"${i.label}" -> "${i.value}"`).join(', ')}`);
            }
            outstanding = result.missing;
            if (outstanding.length > 0) {
                log(`  attempt ${attempt}: ${outstanding.length}/${labels.length} label(s) unresolved, retrying just those`);
            }
        } catch (e: any) {
            // A truncated answer is a size problem, not a luck problem: ask for
            // less instead of asking again. Each half gets its own full retry
            // budget, and the recursion is depth-capped.
            if (e instanceof TruncatedResponseError && outstanding.length > 1 && depth < MAX_SPLIT_DEPTH) {
                const mid = Math.ceil(outstanding.length / 2);
                const halves = [outstanding.slice(0, mid), outstanding.slice(mid)];
                log(`  attempt ${attempt}: ${e.message} — splitting ${outstanding.length} labels into ${halves.map(h => h.length).join(' + ')}`);
                for (const half of halves) {
                    for (const [label, category] of await classifyBatch(projectId, half, log, depth + 1)) {
                        resolved.set(label, category);
                    }
                }
                // The halves consumed their own retries; nothing left to do here.
                break;
            }
            log(`  attempt ${attempt} failed: ${e.message}`);
        }
    }

    return resolved;
}

// ---------------------------------------------------------------------------
// MiniLM nearest-anchor cross-check
// ---------------------------------------------------------------------------

type Embedder = (text: string, opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ data: ArrayLike<number> }>;

interface Anchor {
    category: string;
    phrase: string;
    vector: number[];
}

async function embed(embedder: Embedder, text: string): Promise<number[]> {
    const out = await embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(out.data);
}

async function buildAnchors(embedder: Embedder): Promise<Anchor[]> {
    const anchors: Anchor[] = [];
    for (const [category, phrases] of Object.entries(SEED_ANCHORS)) {
        for (const phrase of phrases) {
            anchors.push({ category, phrase, vector: await embed(embedder, phrase) });
        }
    }
    return anchors;
}

function nearestAnchor(anchors: Anchor[], vector: number[]): { category: string; score: number } {
    let best = anchors[0];
    let bestScore = -Infinity;
    for (const anchor of anchors) {
        // The pipeline already unit-normalises, so this is the dot product —
        // but share the app's implementation rather than inlining a second one.
        const score = cosineSimilarity(vector, anchor.vector);
        if (score > bestScore) {
            bestScore = score;
            best = anchor;
        }
    }
    return { category: best.category, score: Math.round(bestScore * 1000) / 1000 };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

interface Classified {
    key: string;
    label: string;
    category: string;
    source: 'gemini-2.5-flash' | 'fallback';
    nnCategory: string;
    nnScore: number;
    usageCount: number;
    recipeCount: number;
}

interface Disagreement {
    label: string;
    usageCount: number;
    llm: string;
    nn: string;
    nnScore: number;
}

function table(headers: string[], rows: string[][]): string {
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)));
    const line = (cells: string[]) => cells.map((c, i) => (c ?? '').padEnd(widths[i])).join('  ').trimEnd();
    return [line(headers), widths.map(w => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

function categoryCounts(classified: Classified[]): { category: string; label: string; count: number }[] {
    return COMPARISON_CATEGORY_IDS.map(id => ({
        category: id,
        label: getIngredientCategory(id)?.label ?? id,
        count: classified.filter(c => c.category === id).length,
    }));
}

function disagreements(classified: Classified[]): Disagreement[] {
    return classified
        .filter(c => c.nnScore >= NN_REPORT_THRESHOLD && c.nnCategory !== c.category)
        .sort((a, b) => b.usageCount - a.usageCount || b.nnScore - a.nnScore)
        .map(c => ({ label: c.label, usageCount: c.usageCount, llm: c.category, nn: c.nnCategory, nnScore: c.nnScore }));
}

function printReport(classified: Classified[]): void {
    const counts = categoryCounts(classified);

    console.log('\n================ PER-CATEGORY COUNTS ================\n');
    console.log(table(
        ['category', 'display', 'labels', 'usages'],
        counts.map(c => [
            c.category,
            c.label,
            String(c.count),
            String(classified.filter(x => x.category === c.category).reduce((n, x) => n + x.usageCount, 0)),
        ]),
    ));
    console.log(`\ntotal labels classified: ${classified.length}`);

    console.log(`\n============ TOP ${TOP_LABELS_PER_CATEGORY} LABELS BY USAGE, PER CATEGORY ============`);
    for (const { category, label } of counts) {
        const top = classified
            .filter(c => c.category === category)
            .sort((a, b) => b.usageCount - a.usageCount || (a.key < b.key ? -1 : 1))
            .slice(0, TOP_LABELS_PER_CATEGORY);
        if (top.length === 0) continue;
        console.log(`\n${label} (${category}) — ${classified.filter(c => c.category === category).length} labels`);
        console.log(table(
            ['label', 'usage', 'nn', 'nnScore', 'src'],
            top.map(c => [c.label, String(c.usageCount), c.nnCategory, c.nnScore.toFixed(3), c.source === 'fallback' ? 'FALLBACK' : 'llm']),
        ));
    }

    const rows = disagreements(classified);
    console.log(`\n====== NN DISAGREEMENTS (advisory; nnScore >= ${NN_REPORT_THRESHOLD}) ======\n`);
    if (rows.length === 0) {
        console.log('None.');
    } else {
        console.log(table(
            ['label', 'usage', 'llm', 'nn', 'score'],
            rows.map(r => [r.label, String(r.usageCount), r.llm, r.nn, r.nnScore.toFixed(3)]),
        ));
        console.log(`\n${rows.length} disagreement(s) of ${classified.length} labels (${((rows.length / Math.max(classified.length, 1)) * 100).toFixed(1)}%).`);
    }
}

// ---------------------------------------------------------------------------
// Concurrency helper (same shape as backfill-icon-search-terms.ts)
// ---------------------------------------------------------------------------

async function withConcurrency(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
    const queue = [...tasks];
    async function run() {
        while (queue.length) await queue.shift()!();
    }
    await Promise.all(Array.from({ length: Math.min(limit, Math.max(queue.length, 1)) }, run));
}

function chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

type Addressable = IngredientLabelUsage & { docId: string };

async function main(): Promise<void> {
    const flags = parseFlags(process.argv.slice(2));

    console.log('========================================================');
    console.log(` ENVIRONMENT: ${flags.envName}`);
    console.log(` MODE:        ${flags.dryRun ? 'DRY RUN (zero Firestore writes)' : 'LIVE WRITE'}`);
    console.log(` LIMIT:       ${flags.limit === Infinity ? 'none' : `${flags.limit} recipes`}`);
    console.log(` FORCE:       ${flags.force}${flags.forceFallbacks ? '   FORCE-FALLBACKS: true' : ''}`);
    console.log(` OUT:         ${flags.outPath}`);
    const { db, projectId } = initFirebase(flags.envName);
    console.log('========================================================\n');

    // --- 1. Census -------------------------------------------------------
    console.log(`Scanning ${DB_COLLECTION_RECIPES}...`);
    const collector = createIngredientLabelCollector();
    let skippedGraphs = 0;
    for await (const doc of scanCollection(db, DB_COLLECTION_RECIPES)) {
        if (collector.recipesSeen >= flags.limit) break;
        // One malformed recipe out of ~900 must not end the run: this scan is
        // the expensive part, and the graphs are user data of varying vintage.
        try {
            const graph = doc.data()?.graph as RecipeGraph | undefined;
            if (!graph || !Array.isArray(graph.nodes)) { skippedGraphs++; continue; }
            collector.add(graph);
        } catch (e: any) {
            skippedGraphs++;
            console.warn(`  skipped recipe ${doc.id}: ${e?.message ?? e}`);
        }
    }
    const census = collector.labels();
    console.log(`Recipes scanned: ${collector.recipesSeen}${skippedGraphs ? ` (${skippedGraphs} skipped: no usable graph)` : ''}`);
    console.log(`Distinct labels: ${census.length}\n`);
    if (census.length === 0) { console.log('Nothing to do.'); return; }

    // --- 2. Which ones already have a doc --------------------------------
    const addressable: Addressable[] = [];
    const unaddressable: IngredientLabelUsage[] = [];
    for (const usage of census) {
        const docId = ingredientCategoryDocId(usage.label);
        if (docId) addressable.push({ ...usage, docId });
        else unaddressable.push(usage);
    }
    if (unaddressable.length > 0) {
        console.warn(`⚠️  ${unaddressable.length} label(s) cannot be a Firestore doc id and were skipped: ${unaddressable.map(u => JSON.stringify(u.label)).join(', ')}\n`);
    }

    let alreadyDone = 0;
    let retriedFallbacks = 0;
    let pending = addressable;
    // Docs that are staying as-is but whose usage numbers have moved on.
    const staleCounts: Addressable[] = [];

    if (flags.force) {
        console.log('--force: reclassifying every label, existing docs included.\n');
    } else {
        const good = new Set<string>();
        for (const group of chunk(addressable, READ_CHUNK_SIZE)) {
            const docs = await db.getAll(...group.map(u => db.collection(COLLECTION).doc(u.docId)));
            const byId = new Map(group.map(u => [u.docId, u]));
            for (const doc of docs) {
                if (!doc.exists) continue;
                const data = doc.data() ?? {};
                // A fallback doc is a FAILURE that was parked in 'other', not a
                // result. Treating it as done would make one bad run permanent.
                if (data.source === 'fallback') { retriedFallbacks++; continue; }
                good.add(doc.id);
                const usage = byId.get(doc.id);
                if (usage && (data.usageCount !== usage.usageCount || data.recipeCount !== usage.recipeCount)) {
                    staleCounts.push(usage);
                }
            }
        }
        pending = addressable.filter(u => !good.has(u.docId));
        alreadyDone = addressable.length - pending.length;
        console.log(`Already classified: ${alreadyDone}   To classify: ${pending.length}${retriedFallbacks ? ` (incl. ${retriedFallbacks} earlier fallback(s) being retried)` : ''}`);
        if (staleCounts.length > 0) {
            console.log(`Usage counts to refresh on existing docs: ${staleCounts.length}`);
        }
        console.log('');
    }

    if (pending.length === 0 && staleCounts.length === 0) { console.log('Nothing to do.'); return; }

    // --- 3. MiniLM anchors -----------------------------------------------
    const classified: Classified[] = [];
    let unresolvedCount = 0;

    if (pending.length > 0) {
        console.log('Loading MiniLM (Xenova/all-MiniLM-L6-v2)...');
        hfEnv.cacheDir = '/tmp/.cache/huggingface';
        const embedder = (await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32' })) as unknown as Embedder;
        const anchors = await buildAnchors(embedder);
        console.log(`Model ready. ${anchors.length} seed anchors across ${Object.keys(SEED_ANCHORS).length} categories.\n`);

        // --- 4. Classify --------------------------------------------------
        const batches = chunk(pending, BATCH_SIZE);
        console.log(`Classifying ${pending.length} label(s) in ${batches.length} batch(es) of up to ${BATCH_SIZE} via ${MODEL}...`);
        const assignments = new Map<string, string>();
        let batchesDone = 0;

        await withConcurrency(
            batches.map((batch, index) => async () => {
                const labels = batch.map(u => u.label);
                const resolved = await classifyBatch(projectId, labels, msg => console.log(`[batch ${index + 1}]${msg}`));
                for (const [label, category] of resolved) assignments.set(label, category);
                batchesDone++;
                console.log(`[batch ${index + 1}] ${resolved.size}/${labels.length} classified  (${batchesDone}/${batches.length} batches done)`);
            }),
            CONCURRENCY,
        );

        const unresolved = pending.filter(u => !assignments.has(u.label));
        unresolvedCount = unresolved.length;
        if (unresolved.length > 0) {
            console.warn(`\n⚠️  ⚠️  ${unresolved.length} label(s) survived ${MAX_RETRIES + 1} attempts unclassified and are being forced to '${FALLBACK_CATEGORY_ID}' with source 'fallback':`);
            for (const u of unresolved) console.warn(`      ${JSON.stringify(u.label)} (usage ${u.usageCount})`);
            console.warn('    These are retried automatically on the next run — fallback docs are not treated as done.\n');
        }

        // --- 5. NN cross-check ---------------------------------------------
        console.log(`\nEmbedding ${pending.length} label(s) for the NN cross-check...`);
        for (const usage of pending) {
            const nn = nearestAnchor(anchors, await embed(embedder, usage.label));
            const category = assignments.get(usage.label);
            classified.push({
                key: usage.key,
                label: usage.label,
                category: category ?? FALLBACK_CATEGORY_ID,
                source: category ? MODEL : 'fallback',
                nnCategory: nn.category,
                nnScore: nn.score,
                usageCount: usage.usageCount,
                recipeCount: usage.recipeCount,
            });
            if (classified.length % 250 === 0) console.log(`  ...${classified.length}/${pending.length}`);
        }
    }

    // --- 6. Fallback circuit-breaker ---------------------------------------
    const fallbackFraction = classified.length > 0 ? unresolvedCount / classified.length : 0;
    const tooManyFallbacks = fallbackFraction > MAX_FALLBACK_FRACTION;
    let aborted = false;
    if (tooManyFallbacks && !flags.forceFallbacks) {
        aborted = true;
        console.error('\n########################################################');
        console.error(`# ABORTING BEFORE WRITE: ${unresolvedCount}/${classified.length} labels (${(fallbackFraction * 100).toFixed(1)}%) fell back to`);
        console.error(`# '${FALLBACK_CATEGORY_ID}', over the ${(MAX_FALLBACK_FRACTION * 100).toFixed(0)}% limit. That is an unhealthy classifier,`);
        console.error('# not a hard corpus, and writing it would poison the lookup collection.');
        console.error('#');
        console.error('# Check Vertex health first: quota/429s, model availability in');
        console.error(`# ${VERTEX_LOCATION}, and the credentials for project ${projectId}.`);
        console.error('# Re-run once it is healthy, or pass --force-fallbacks to write anyway.');
        console.error('########################################################\n');
    } else if (tooManyFallbacks) {
        console.warn(`\n⚠️  --force-fallbacks: writing despite ${(fallbackFraction * 100).toFixed(1)}% fallbacks.\n`);
    }

    // --- 7. Write ----------------------------------------------------------
    const classifiedAt = new Date();
    let written = 0;
    let refreshed = 0;

    if (flags.dryRun) {
        console.log(`\nDRY RUN — would write ${classified.length} doc(s) to ${COLLECTION}` +
            `${staleCounts.length ? ` and refresh usage counts on ${staleCounts.length} existing doc(s)` : ''}; nothing was written.`);
    } else if (aborted) {
        console.error(`No documents were written (${classified.length} classification(s) discarded).`);
    } else {
        if (classified.length > 0) {
            console.log(`\nWriting ${classified.length} doc(s) to ${COLLECTION}...`);
            for (const group of chunk(classified, WRITE_BATCH_SIZE)) {
                const batch = db.batch();
                for (const entry of group) {
                    // The doc id is re-derived from the label through the same
                    // exported helper the census used, so the join key cannot
                    // drift between the two halves of this script.
                    batch.set(db.collection(COLLECTION).doc(ingredientCategoryDocId(entry.label)!), {
                        label: entry.label,
                        category: entry.category,
                        source: entry.source,
                        model: MODEL,
                        nnCategory: entry.nnCategory,
                        nnScore: entry.nnScore,
                        classifiedAt,
                        // Usage numbers describe the LAST SCAN, not all time:
                        // a --limit run records what that subset saw.
                        usageCount: entry.usageCount,
                        recipeCount: entry.recipeCount,
                    });
                }
                await batch.commit();
                written += group.length;
                console.log(`  ${written}/${classified.length}`);
            }
        }

        // Metadata-only refresh for docs whose category is fine but whose
        // counts have moved. Merge update, never touching `category`/`source`,
        // so a smoke run cannot freeze stale usage numbers forever.
        if (staleCounts.length > 0) {
            console.log(`Refreshing usage counts on ${staleCounts.length} existing doc(s)...`);
            for (const group of chunk(staleCounts, WRITE_BATCH_SIZE)) {
                const batch = db.batch();
                for (const usage of group) {
                    batch.update(db.collection(COLLECTION).doc(usage.docId), {
                        usageCount: usage.usageCount,
                        recipeCount: usage.recipeCount,
                    });
                }
                await batch.commit();
                refreshed += group.length;
            }
            console.log(`  ${refreshed}/${staleCounts.length}`);
        }
    }

    // --- 8. Evidence --------------------------------------------------------
    printReport(classified);

    const dump = {
        env: flags.envName,
        project: projectId,
        model: MODEL,
        dryRun: flags.dryRun,
        force: flags.force,
        forceFallbacks: flags.forceFallbacks,
        abortedForFallbacks: aborted,
        limit: flags.limit === Infinity ? null : flags.limit,
        generatedAt: classifiedAt.toISOString(),
        recipesScanned: collector.recipesSeen,
        recipesSkipped: skippedGraphs,
        distinctLabels: census.length,
        alreadyClassified: alreadyDone,
        fallbacksRetried: retriedFallbacks,
        classifiedNow: classified.length,
        fallbackCount: unresolvedCount,
        usageCountsRefreshed: staleCounts.length,
        skippedUnaddressable: unaddressable.map(u => u.label),
        docsWritten: written,
        categoryCounts: categoryCounts(classified),
        disagreements: disagreements(classified),
        classifications: classified,
    };
    fs.writeFileSync(path.resolve(flags.outPath), JSON.stringify(dump, null, 2));

    console.log(`\n========================================================`);
    console.log(` ${aborted ? 'ABORTED (too many fallbacks; nothing written)' : flags.dryRun ? 'DRY RUN COMPLETE (no writes)' : 'BACKFILL COMPLETE'}`);
    console.log(` classified: ${classified.length}   fallback: ${unresolvedCount}   already done: ${alreadyDone}   written: ${written}   counts refreshed: ${refreshed}`);
    console.log(` JSON dump:  ${path.resolve(flags.outPath)}`);
    console.log(`========================================================`);

    if (aborted) process.exit(1);
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
