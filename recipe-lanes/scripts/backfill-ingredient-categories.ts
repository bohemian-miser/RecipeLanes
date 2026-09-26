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
 * distinct ingredient label, carrying the label's taxonomy category and the
 * raw ingredient name comparison rows for that label should be totalled under.
 *
 * Pipeline:
 *   1. Scan `recipes`, extracting ingredient labels with the SAME pure logic
 *      the comparison table uses (`ingredient-label-extract`), so the doc ids
 *      written here are exactly the keys the table will look up.
 *   2. Skip labels that already have a GOOD doc (see idempotency below).
 *   3. Classify the rest with Vertex Gemini 2.5 Flash, in batches, using the
 *      shared prompt/parser from `lib/recipe-lanes/ingredient-taxonomy` with
 *      `includeRaw` — one call returns both the category and the raw name.
 *      A batch that comes back incomplete is retried for its missing labels
 *      only; a batch whose RESPONSE was truncated is split in half instead,
 *      since retrying an over-long request identically just truncates again.
 *   4. Cross-check each label against seed-anchor MiniLM embeddings and store
 *      the nearest anchor's category as `nnCategory`/`nnScore`. ADVISORY ONLY
 *      — the LLM is authoritative; the NN is known-bad on non-English labels.
 *      Its value is the disagreement report, which is where misclassifications
 *      show up for a human to eyeball. It says nothing about the raw name;
 *      raw quality is verified by the merge report instead (step 5).
 *   5. PRINT the evidence — per-category counts, top labels per category, the
 *      disagreement table, and the raw-ingredient merge report
 *      (`raw-ingredient-report`): which labels move to a different row, which
 *      labels end up sharing one, and a loud flag on any merge that spans two
 *      taxonomy categories. Before the write, deliberately: a section headed
 *      "review before writing" is worthless underneath the write it was meant
 *      to gate.
 *   6. Write the docs, unless a circuit-breaker stopped the run.
 *   7. Dump the whole evidence set to JSON (last, because it records what the
 *      write actually did).
 *
 * RAW NAMES ARE THE RISKY HALF. A wrong category mislabels a row; a wrong raw
 * name SUMS TWO UNRELATED QUANTITIES into one and the total still looks
 * plausible. The model is therefore told that identity (raw = label) is always
 * safe, an unusable raw value is dropped rather than guessed at (the parser's
 * job), and a label with no raw of its own is stored as its own raw name here.
 * The merge report exists so a human signs off on the collisions before a
 * production write — see the plan's rollout checkpoint.
 *
 * IDEMPOTENCY / RESUMABILITY. Re-running is cheap and safe: a label that
 * already has a GOOD doc is not re-classified. "Good" means: it carries the
 * current `categoryRulesVersion` AND the current `rawRulesVersion` AND an
 * actual `rawIngredient` value. The two rule sets version independently, so a
 * doc written by a run that predates raw extraction has a fine category and no
 * raw name, and must come back through — the last clause is the belt-and-braces
 * version of that, catching a doc stamped current whose value never landed.
 *
 * A further exception is deliberate — docs
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
 * A SECOND breaker covers the raw half: the run refuses to write when a label
 * it would write shares a raw ingredient with a label in a different taxonomy
 * category. That is the over-merge signature, it is silent once written, and
 * `--force-merges` is the acknowledgement that a human looked at the
 * cross-category section and accepted it. Note the merge report is computed
 * over the WHOLE corpus — the labels that already have docs are read back and
 * folded in — because a merge is a relationship between labels and a report
 * scoped to the pending set cannot see one.
 *
 * Usage:
 *   npx tsx scripts/backfill-ingredient-categories.ts (--staging | --prod)
 *       [--dry-run] [--limit N] [--force] [--force-fallbacks] [--force-merges]
 *       [--out path.json]
 *
 * `--staging` or `--prod` is REQUIRED — this script writes, so the target must
 * be stated rather than defaulted. `--dry-run` performs zero Firestore writes
 * (it still reads, classifies and embeds, which is the point: it is how the
 * classification quality gets reviewed before anything is persisted).
 *
 * NOTE (follow-up, issue #327): the Vertex REST call, the `withConcurrency`
 * helper and the MiniLM embedder setup below are near-duplicates of the ones
 * in `backfill-icon-search-terms.ts` / `backfill-embeddings.ts`. THIS file is
 * the up-to-date copy — the siblings still carry a fixed-1h-TTL token cache
 * that ignores the token's real expiry, and have no MAX_TOKENS/truncation
 * handling — so a future extraction into `scripts/lib/` should start from
 * here rather than from them. Extracting touches those scripts too and
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
    boundRawIngredientName,
    buildClassificationPrompt,
    parseClassificationResponse,
    COMPARISON_CATEGORY_IDS,
    FALLBACK_CATEGORY_ID,
    getIngredientCategory,
    RAW_RULES_VERSION,
    TAXONOMY_RULES_VERSION,
} from '../lib/recipe-lanes/ingredient-taxonomy';
import {
    createIngredientLabelCollector,
    ingredientCategoryDocId,
    type IngredientLabelUsage,
} from '../lib/recipe-lanes/ingredient-label-extract';
import {
    buildRawIngredientReport,
    type RawIngredientEntry,
    type RawIngredientGroup,
    type RawIngredientReport,
} from '../lib/recipe-lanes/raw-ingredient-report';
import { standardizeIngredientName } from '../lib/utils';
import type { RecipeGraph } from '../lib/recipe-lanes/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The lookup collection this script owns. */
const COLLECTION = 'ingredient_categories';

const MODEL = 'gemini-2.5-flash';
const VERTEX_LOCATION = 'us-central1';

/**
 * Labels per classification call. ~90 calls for the full prod corpus.
 *
 * The object-shaped response (`{category, raw}` per label) is roughly twice the
 * output tokens of the bare-id one, which brings MAX_TOKENS closer. It is left
 * at 50 deliberately: the truncation-split machinery below already handles an
 * over-long answer correctly and only costs an extra call on the batches that
 * actually overflow, whereas halving this doubles the call count for the whole
 * corpus. Halve it only if a real run shows splits happening routinely.
 */
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
 * Rows printed in the label→raw table before it is cut off. The collision
 * report and the cross-category flags below it are NEVER truncated — those are
 * the sections a human has to read in full before a production write — but this
 * one is informational and grows with the corpus, so the console keeps the
 * heaviest-used moves and the JSON dump keeps every one of them.
 */
const TOP_RAW_RENAMES = 50;

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
    /** Acknowledge this run's cross-category merges and write them anyway. */
    forceMerges: boolean;
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
    console.error('           [--dry-run] [--limit N] [--force] [--force-fallbacks] [--force-merges]');
    console.error('           [--out path.json]\n');
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
        forceMerges: args.includes('--force-merges'),
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
// Vertex Gemini (REST). backfill-icon-search-terms.ts has the same shape but
// is the outdated copy — see the NOTE at the top of this file (issue #327).
// ---------------------------------------------------------------------------

/** One `GoogleAuth` for the whole run, so it keeps its own token cache. */
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

/**
 * Deliberately does NOT cache the token itself. `getAccessToken()` already
 * caches and refreshes against the token's REAL expiry; a hand-rolled fixed
 * one-hour TTL can only get that wrong, and it gets it wrong in the expensive
 * direction — a token that expires early keeps being served, every Vertex call
 * 401s, and the retry/backoff budget is burned on an auth problem that the
 * error path reads as a model problem.
 */
async function getToken(): Promise<string> {
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token.token) throw new Error('GoogleAuth returned no access token');
    return token.token;
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
 * What one label came back with. `raw` is optional and sparse on purpose: the
 * parser drops a raw name it cannot use (absent, empty, multi-line, oversized)
 * rather than failing the entry, so absence means "no merge hint", which the
 * caller turns into identity — never "unknown".
 */
interface Resolved {
    category: string;
    raw?: string;
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
): Promise<Map<string, Resolved>> {
    const resolved = new Map<string, Resolved>();
    let outstanding = labels;
    // An unsplittable truncation (below) gets exactly one extra attempt before
    // falling back — see the comment at that branch for why.
    let unsplittableRetried = false;

    for (let attempt = 1; attempt <= MAX_RETRIES + 1 && outstanding.length > 0; attempt++) {
        if (attempt > 1) await sleep(backoffFor(attempt - 1));
        try {
            const response = await callGemini(
                projectId,
                // The one place raw extraction is switched on. Every other
                // caller of this builder (the icon backfill, classify-on-miss)
                // leaves it off and keeps the cheaper bare-id contract.
                buildClassificationPrompt(outstanding, { includeRaw: true }),
                backoffFor(attempt),
            );
            // No `includeRaw` on the parse side on purpose: the option governs
            // what we ASK for, and the parser accepts both response shapes
            // regardless — a model that answers with bare ids still gets its
            // categories kept, it just contributes no merge hints.
            const result = parseClassificationResponse(response, outstanding);
            // `assignments` and `rawAssignments` are null-prototype by design (a
            // label may literally be "__proto__"), so read them with
            // Object.entries / bracket access.
            for (const [label, category] of Object.entries(result.assignments)) {
                resolved.set(label, { category, raw: result.rawAssignments[label] });
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
            if (e instanceof TruncatedResponseError) {
                if (outstanding.length > 1 && depth < MAX_SPLIT_DEPTH) {
                    const mid = Math.ceil(outstanding.length / 2);
                    const halves = [outstanding.slice(0, mid), outstanding.slice(mid)];
                    log(`  attempt ${attempt}: ${e.message} — splitting ${outstanding.length} labels into ${halves.map(h => h.length).join(' + ')}`);
                    for (const half of halves) {
                        for (const [label, entry] of await classifyBatch(projectId, half, log, depth + 1)) {
                            resolved.set(label, entry);
                        }
                    }
                    // The halves consumed their own retries; nothing left to do here.
                    break;
                }
                // The request cannot get any smaller — a single label, or the
                // split budget is spent. Vertex at temperature 0 is not
                // bit-deterministic across serving replicas, and a MAX_TOKENS
                // on a batch this small usually means a transient degenerate
                // repetition loop rather than a genuinely oversized request —
                // one retry tends to clear it. A second truncation means the
                // retry didn't help, so only one extra attempt is spent here
                // before handing these labels to the caller's fallback.
                if (!unsplittableRetried) {
                    unsplittableRetried = true;
                    log(`  attempt ${attempt}: ${e.message} — cannot split further (${outstanding.length} label(s), depth ${depth}); retrying once before falling back`);
                    continue;
                }
                log(`  attempt ${attempt}: ${e.message} — cannot split further (${outstanding.length} label(s), depth ${depth}) and the retry truncated too; leaving them to the fallback`);
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
    /**
     * The raw ingredient name written to the doc, in display casing. Never
     * empty: a label the model gave no usable raw for is its OWN raw name
     * (`rawIsIdentity`), which is the conservative outcome — that label keeps
     * exactly the comparison row it has today.
     */
    raw: string;
    /** True when `raw` is the label itself because the model supplied no usable one. */
    rawIsIdentity: boolean;
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

function disagreements(classified: Classified[]): Disagreement[] {
    return classified
        .filter(c => c.nnScore >= NN_REPORT_THRESHOLD && c.nnCategory !== c.category)
        .sort((a, b) => b.usageCount - a.usageCount || b.nnScore - a.nnScore)
        .map(c => ({ label: c.label, usageCount: c.usageCount, llm: c.category, nn: c.nnCategory, nnScore: c.nnScore }));
}

/**
 * Everything the reporting and the JSON dump need, grouped in ONE pass.
 *
 * The naive shape of this stage re-scans the whole `classified` array for every
 * question it asks — once per category for the counts, again per category for
 * the usage sum, again per category for the top-labels list, and again for the
 * NN disagreements (computed separately for the printed table and the dump).
 * That is ~50 linear scans of the same array to produce one report. Grouping
 * once and sharing the result costs a single pass, and it also guarantees the
 * printed tables and the dumped JSON describe the same grouping rather than
 * independently recomputed ones.
 */
interface Summary {
    total: number;
    /** category id -> its docs, in classification order. Categories with none are absent. */
    byCategory: Map<string, Classified[]>;
    /** Taxonomy-ordered counts + usage sums, including the zeroes, for the table and the dump. */
    counts: { category: string; label: string; count: number; usageCount: number }[];
    /** NN disagreements, computed once; shared by the printed table and the dump. */
    disagreements: Disagreement[];
    /**
     * Raw-ingredient merge quality — the pre-prod review gate (pure helper).
     * Computed over this run's labels AND the ones that already have docs; see
     * `existingForReport` for why a run-scoped report is worse than useless.
     */
    raw: RawIngredientReport;
    /** Labels that kept their own name because the model offered no raw. */
    rawIdentityCount: number;
}

function summarise(classified: Classified[], existing: RawIngredientEntry[]): Summary {
    const byCategory = new Map<string, Classified[]>();

    for (const entry of classified) {
        const group = byCategory.get(entry.category);
        if (group) group.push(entry);
        else byCategory.set(entry.category, [entry]);
    }

    // Driven by COMPARISON_CATEGORY_IDS, not by the map's keys, so the report
    // keeps taxonomy order and still shows categories nothing landed in.
    const counts = COMPARISON_CATEGORY_IDS.map(id => {
        const group = byCategory.get(id) ?? [];
        return {
            category: id,
            label: getIngredientCategory(id)?.label ?? id,
            count: group.length,
            usageCount: group.reduce((n, x) => n + x.usageCount, 0),
        };
    });

    return {
        total: classified.length,
        byCategory,
        counts,
        disagreements: disagreements(classified),
        // `classified` carries no `isNew`, which the helper reads as new — the
        // safe default, and true here.
        raw: buildRawIngredientReport([...classified, ...existing]),
        rawIdentityCount: classified.reduce((n, c) => n + (c.rawIsIdentity ? 1 : 0), 0),
    };
}

function printReport(summary: Summary): void {
    const { counts, total, byCategory, disagreements: rows } = summary;

    console.log('\n================ PER-CATEGORY COUNTS ================\n');
    console.log(table(
        ['category', 'display', 'labels', 'usages'],
        counts.map(c => [c.category, c.label, String(c.count), String(c.usageCount)]),
    ));
    console.log(`\ntotal labels classified: ${total}`);

    console.log(`\n============ TOP ${TOP_LABELS_PER_CATEGORY} LABELS BY USAGE, PER CATEGORY ============`);
    for (const { category, label, count } of counts) {
        const top = [...(byCategory.get(category) ?? [])]
            .sort((a, b) => b.usageCount - a.usageCount || (a.key < b.key ? -1 : 1))
            .slice(0, TOP_LABELS_PER_CATEGORY);
        if (top.length === 0) continue;
        console.log(`\n${label} (${category}) — ${count} labels`);
        console.log(table(
            ['label', 'usage', 'nn', 'nnScore', 'src'],
            top.map(c => [c.label, String(c.usageCount), c.nnCategory, c.nnScore.toFixed(3), c.source === 'fallback' ? 'FALLBACK' : 'llm']),
        ));
    }

    console.log(`\n====== NN DISAGREEMENTS (advisory; nnScore >= ${NN_REPORT_THRESHOLD}) ======\n`);
    if (rows.length === 0) {
        console.log('None.');
    } else {
        console.log(table(
            ['label', 'usage', 'llm', 'nn', 'score'],
            rows.map(r => [r.label, String(r.usageCount), r.llm, r.nn, r.nnScore.toFixed(3)]),
        ));
        console.log(`\n${rows.length} disagreement(s) of ${total} labels (${((rows.length / Math.max(total, 1)) * 100).toFixed(1)}%).`);
    }
}

/**
 * One collision group as a header line plus its member rows.
 *
 * The `new` column is the part a reviewer of an incremental run actually needs:
 * a group of five labels where four were written and approved months ago and
 * one landed today is a question about that one label, not about the group.
 */
function printGroup(group: RawIngredientGroup): void {
    const flag = group.crossCategory ? '  ⚠️  CROSS-CATEGORY' : '';
    const provenance = group.hasNewMember ? '' : '  (all pre-existing)';
    console.log(
        `\n"${group.raw}"  ← ${group.members.length} labels, ${group.usageCount} usages`
        + `  [${group.categories.join(', ')}]${flag}${provenance}`,
    );
    console.log(table(
        ['  label', 'usage', 'category', 'new'],
        group.members.map(m => [`  ${m.label}`, String(m.usageCount), m.category, m.isNew ? 'NEW' : '']),
    ));
}

/**
 * The raw-ingredient evidence: what these names would do to the comparison
 * table if written. This is the section the owner reads before a production
 * run, so it is ordered by how much it should worry them — what moved, what
 * merged, and then what merged across a taxonomy boundary.
 */
function printRawReport(summary: Summary): void {
    const { raw, rawIdentityCount, total } = summary;
    const newRenames = raw.renames.reduce((n, r) => n + (r.isNew ? 1 : 0), 0);

    console.log('\n================ RAW INGREDIENT — SUMMARY ================\n');
    // Scope first, because every number under it is a statement about the
    // corpus and it would otherwise read as a statement about this run.
    console.log(`labels in the merge view:          ${raw.totalLabels}`
        + `  (${raw.newLabels} classified now, ${raw.totalLabels - raw.newLabels} already had docs)`);
    // These three split THIS RUN's labels exactly: a label either moves rows,
    // or keeps its own row because the model said so, or keeps it because the
    // model gave nothing usable and identity is the fallback.
    console.log(`  of this run, raw moves the row:  ${newRenames}`);
    console.log(`  of this run, model kept identity:${(total - rawIdentityCount - newRenames).toString().padStart(4)}`);
    console.log(`  of this run, model gave no raw:  ${rawIdentityCount}`);
    console.log(`renames across the whole corpus:   ${raw.renames.length}`);
    console.log(`collision groups (2+ labels):      ${raw.groups.length}`
        + `  (${raw.groups.filter(g => g.hasNewMember).length} contain a label from this run)`);
    console.log(`comparison rows removed by merging:${raw.rowsMerged.toString().padStart(4)}`);
    console.log(`CROSS-CATEGORY GROUPS (review!):   ${raw.crossCategoryGroups.length}`
        + `  (${raw.newCrossCategoryGroups.length} this run is accountable for)`);

    console.log(`\n========= LABEL → RAW (only where the row key changes) =========\n`);
    if (raw.renames.length === 0) {
        console.log('None — every label is its own raw ingredient.');
    } else {
        // Sorted new-first by the helper, so the cap below can never hide this
        // run's own moves behind a corpus that was already reviewed.
        const shown = raw.renames.slice(0, TOP_RAW_RENAMES);
        console.log(table(
            ['label', 'raw', 'usage', 'new'],
            shown.map(r => [r.label, r.raw, String(r.usageCount), r.isNew ? 'NEW' : '']),
        ));
        if (raw.renames.length > shown.length) {
            console.log(`\n... and ${raw.renames.length - shown.length} more (all of them in the JSON dump).`);
        }
    }

    console.log(`\n===== COLLISION REPORT (raw groups; this run's first, then biggest) =====`);
    if (raw.groups.length === 0) {
        console.log('\nNone — no two labels share a raw ingredient.');
    } else {
        // Never truncated: a group hidden here is a merge nobody reviewed.
        for (const group of raw.groups) printGroup(group);
        console.log(`\n${raw.groups.length} group(s) merging ${raw.rowsMerged + raw.groups.length} labels into ${raw.groups.length} row(s).`);
    }

    console.log(`\n${'#'.repeat(64)}`);
    console.log('# CROSS-CATEGORY MERGES — LIKELY OVER-MERGE, REVIEW BEFORE WRITING');
    console.log(`${'#'.repeat(64)}`);
    if (raw.crossCategoryGroups.length === 0) {
        console.log('\nNone. Every merged group agrees on its category.');
    } else {
        // The taxonomy already calls these different kinds of thing, and
        // summing their quantities is the silent-corruption failure mode the
        // boundary rules exist to prevent. Not filtered, not capped — the
        // automation's job is to make a human look at each one.
        for (const group of raw.crossCategoryGroups) printGroup(group);
        console.log(`\n⚠️  ${raw.crossCategoryGroups.length} group(s) merge labels across taxonomy categories,`);
        console.log(`    ${raw.newCrossCategoryGroups.length} of them involving a label this run would write.`);
        console.log('    Each one is a candidate over-merge: check the boundary rules in');
        console.log('    RAW_INGREDIENT_RULES before letting these reach production.');
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
    console.log(` FORCE:       ${flags.force}${flags.forceFallbacks ? '   FORCE-FALLBACKS: true' : ''}${flags.forceMerges ? '   FORCE-MERGES: true' : ''}`);
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
    let staleCategoryVersion = 0;
    let staleRawVersion = 0;
    let missingRaw = 0;
    let pending = addressable;
    // Docs that are staying as-is but whose usage numbers have moved on.
    const staleCounts: Addressable[] = [];
    /**
     * The labels that already have a good doc, in the merge report's shape.
     *
     * A merge is a relationship BETWEEN labels, so the report cannot be
     * computed from this run's pending set alone: a later run that classifies
     * one new "Tomato Paste" whose raw name is "Tomato" would report zero
     * collisions and zero cross-category flags while writing a doc that folds
     * tomato paste into the tinned-tomato row. Seeding the already-good docs in
     * is what makes the grouping a statement about the corpus rather than about
     * the accident of which labels happened to be pending.
     */
    const existingForReport: RawIngredientEntry[] = [];

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
                // Classified against boundaries the taxonomy no longer states.
                // Docs written before versioning have no field at all, which
                // compares unequal and so gets picked up here too — exactly
                // right, since they predate every clause added since.
                //
                // The two rule sets are versioned SEPARATELY (see the constants
                // in ingredient-taxonomy). A doc is only done when it satisfies
                // both, because a run under the current category rules that
                // predates raw extraction produced a perfectly good category
                // and no raw name at all.
                if (data.categoryRulesVersion !== TAXONOMY_RULES_VERSION) { staleCategoryVersion++; continue; }
                if (data.rawRulesVersion !== RAW_RULES_VERSION) { staleRawVersion++; continue; }
                // Belt and braces for the stamp being right while the value is
                // not: an interim run, a partial write, a hand-edited doc. The
                // version field is a claim, this is the field the lookup
                // actually reads, and a missing one silently un-merges rows.
                if (typeof data.rawIngredient !== 'string' || !data.rawIngredient.trim()) { missingRaw++; continue; }
                good.add(doc.id);
                const usage = byId.get(doc.id);
                if (usage && (data.usageCount !== usage.usageCount || data.recipeCount !== usage.recipeCount)) {
                    staleCounts.push(usage);
                }
                // Seeded into the merge report so grouping sees the whole
                // corpus, not just what is pending. Usage comes from the census
                // rather than the doc, because the doc's copy describes the
                // scan that wrote it and may be several runs out of date.
                existingForReport.push({
                    label: typeof data.label === 'string' && data.label ? data.label : usage?.label ?? doc.id,
                    raw: data.rawIngredient,
                    category: typeof data.category === 'string' ? data.category : FALLBACK_CATEGORY_ID,
                    usageCount: usage?.usageCount ?? (typeof data.usageCount === 'number' ? data.usageCount : 0),
                    isNew: false,
                });
            }
        }
        pending = addressable.filter(u => !good.has(u.docId));
        alreadyDone = addressable.length - pending.length;
        const reasons = [
            retriedFallbacks ? `${retriedFallbacks} earlier fallback(s)` : '',
            staleCategoryVersion ? `${staleCategoryVersion} classified under older category rules (now v${TAXONOMY_RULES_VERSION})` : '',
            staleRawVersion ? `${staleRawVersion} under older raw rules (now v${RAW_RULES_VERSION})` : '',
            missingRaw ? `${missingRaw} stamped current but carrying no rawIngredient` : '',
        ].filter(Boolean);
        console.log(`Already classified: ${alreadyDone}   To classify: ${pending.length}${reasons.length ? ` (incl. ${reasons.join(', ')})` : ''}`);
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
        const assignments = new Map<string, Resolved>();
        let batchesDone = 0;

        await withConcurrency(
            batches.map((batch, index) => async () => {
                const labels = batch.map(u => u.label);
                const resolved = await classifyBatch(projectId, labels, msg => console.log(`[batch ${index + 1}]${msg}`));
                for (const [label, entry] of resolved) assignments.set(label, entry);
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
            const resolved = assignments.get(usage.label);
            // Identity fallback, in both directions: a label the classifier
            // never answered for, and a label whose raw name was unusable, both
            // become their own raw ingredient. `usage.label` is already
            // standardized by the census; the model's answer is not, so it goes
            // through the same casing the comparison table's labels use.
            //
            // Both paths then go through `boundRawIngredientName`. For the
            // model's answer that is a no-op guard — the parser already held it
            // to the length bound — but the IDENTITY path never met the parser,
            // and recipe labels get long ("Tomatoes, San Marzano, Peeled,
            // Canned, Drained And Crushed By Hand"). Without it the safe
            // fallback is the one path that can store a rawIngredient the model
            // itself would have been forbidden to return, and PR 4 turns this
            // field into a comparison row label.
            const modelRaw = resolved?.raw ? standardizeIngredientName(resolved.raw) : '';
            const rawIsIdentity = !modelRaw;
            classified.push({
                key: usage.key,
                label: usage.label,
                category: resolved?.category ?? FALLBACK_CATEGORY_ID,
                raw: boundRawIngredientName(rawIsIdentity ? usage.label : modelRaw),
                rawIsIdentity,
                source: resolved ? MODEL : 'fallback',
                nnCategory: nn.category,
                nnScore: nn.score,
                usageCount: usage.usageCount,
                recipeCount: usage.recipeCount,
            });
            if (classified.length % 250 === 0) console.log(`  ...${classified.length}/${pending.length}`);
        }
    }

    // --- 6. Evidence, BEFORE the write -------------------------------------
    // Ordering is load-bearing, not cosmetic. This used to print after step 7,
    // which meant a live run committed the docs and only then showed the
    // operator the "REVIEW BEFORE WRITING" section — advice about a decision
    // already taken, on values already in Firestore. One pass here builds
    // everything the report and the JSON dump need, instead of each of them
    // re-scanning `classified` on their own.
    const summary = summarise(classified, existingForReport);
    printReport(summary);
    printRawReport(summary);

    // --- 7. Circuit-breakers ------------------------------------------------
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

    /**
     * The merge breaker, mirroring the fallback one above.
     *
     * THRESHOLD: any cross-category group this run would contribute a label to.
     * Not a count, and not the corpus total, for two reasons. A tolerance of
     * "N is fine" waves through N silent over-merges, each of which sums
     * unrelated quantities into a plausible-looking number; and the corpus
     * total never falls, so keying on it would either block every future run
     * forever or have to be raised until it stopped meaning anything. Keyed on
     * new members it is self-clearing: once a human has looked at a flagged
     * group and let it through, that group has no new members next time and
     * stops blocking, while a genuinely new over-merge always blocks.
     *
     * On a first, full, or `--force` run every label is new, so this fires by
     * design — that IS the owner checkpoint the rollout plan requires before
     * any production write, now enforced by the script instead of by the
     * operator remembering to scroll up.
     */
    const flaggedMerges = summary.raw.newCrossCategoryGroups.length;
    // A dry run has nothing to block: it writes nothing, and producing this
    // report for review is the entire job it was asked to do. So it says what
    // WOULD happen and still exits 0 — unlike the fallback breaker, which
    // reports a broken classifier and is a genuine failure in either mode.
    const mergesBlockWrite = flaggedMerges > 0 && !flags.forceMerges;
    if (mergesBlockWrite) {
        const log = flags.dryRun ? console.warn : console.error;
        log(`\n${'#'.repeat(72)}`);
        log(`# ${flags.dryRun ? 'WOULD ABORT BEFORE WRITE' : 'ABORTING BEFORE WRITE'}: ${flaggedMerges} cross-category merge group(s)`);
        log('# involve a label this run would write. Merging labels the taxonomy puts in');
        log('# different categories is the over-merge signature — it sums unrelated');
        log('# quantities into one comparison row and the total still looks plausible.');
        log('#');
        log('# Read the CROSS-CATEGORY section above. If the merges are right, re-run');
        log('# with --force-merges. If they are not, fix RAW_INGREDIENT_RULES, bump');
        log(`# RAW_RULES_VERSION (now ${RAW_RULES_VERSION}) and re-run — the bump re-derives every`);
        log('# raw name without disturbing the category corpus.');
        log(`${'#'.repeat(72)}\n`);
    } else if (flaggedMerges > 0) {
        console.warn(`\n⚠️  --force-merges: writing despite ${flaggedMerges} cross-category merge group(s).\n`);
    }

    // Only a live run can be stopped by the merge breaker; see above.
    const blocked = aborted || (mergesBlockWrite && !flags.dryRun);

    // --- 8. Write ----------------------------------------------------------
    const classifiedAt = new Date();
    let written = 0;
    let refreshed = 0;

    if (flags.dryRun) {
        console.log(`\nDRY RUN — would write ${classified.length} doc(s) to ${COLLECTION}` +
            `${staleCounts.length ? ` and refresh usage counts on ${staleCounts.length} existing doc(s)` : ''}; nothing was written.`);
    } else if (blocked) {
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
                        // The pantry item this label's comparison row totals
                        // under. Always present, never empty: a label with no
                        // merge hint stores its own name, so a reader can key
                        // on this field unconditionally instead of re-deriving
                        // the identity fallback at every call site.
                        rawIngredient: entry.raw,
                        source: entry.source,
                        model: MODEL,
                        nnCategory: entry.nnCategory,
                        nnScore: entry.nnScore,
                        classifiedAt,
                        // Which boundary text produced each half of this
                        // answer. The scan above reclassifies anything stamped
                        // with a different version, so a rules edit reaches old
                        // docs instead of needing a blanket --force — and the
                        // two are stamped separately so that editing the raw
                        // boundary does not invalidate the category corpus
                        // (the icon index shares these categories) or vice
                        // versa.
                        categoryRulesVersion: TAXONOMY_RULES_VERSION,
                        rawRulesVersion: RAW_RULES_VERSION,
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

    // --- 9. JSON dump -------------------------------------------------------
    // Last, because it is the only part that needs the write's own results
    // (`docsWritten`). The human-facing report was printed back in step 6,
    // before anything could be committed.
    const dump = {
        env: flags.envName,
        project: projectId,
        model: MODEL,
        dryRun: flags.dryRun,
        force: flags.force,
        forceFallbacks: flags.forceFallbacks,
        forceMerges: flags.forceMerges,
        abortedForFallbacks: aborted,
        abortedForMerges: mergesBlockWrite && !flags.dryRun,
        flaggedMergeGroups: flaggedMerges,
        limit: flags.limit === Infinity ? null : flags.limit,
        generatedAt: classifiedAt.toISOString(),
        recipesScanned: collector.recipesSeen,
        recipesSkipped: skippedGraphs,
        distinctLabels: census.length,
        rulesVersion: TAXONOMY_RULES_VERSION,
        rawRulesVersion: RAW_RULES_VERSION,
        alreadyClassified: alreadyDone,
        fallbacksRetried: retriedFallbacks,
        reclassifiedForRulesVersion: staleCategoryVersion,
        reclassifiedForRawRulesVersion: staleRawVersion,
        reclassifiedForMissingRaw: missingRaw,
        classifiedNow: classified.length,
        fallbackCount: unresolvedCount,
        rawIdentityCount: summary.rawIdentityCount,
        usageCountsRefreshed: staleCounts.length,
        skippedUnaddressable: unaddressable.map(u => u.label),
        docsWritten: written,
        categoryCounts: summary.counts,
        disagreements: summary.disagreements,
        // The merge evidence, in full — the console truncates the label→raw
        // table, this never does, and the owner checkpoint reads from here.
        rawMerge: {
            // Whole-corpus, not just this run: `labelsInView` counts the
            // already-good docs seeded in alongside `newLabels`, without which
            // a merge between a new label and an existing one is invisible.
            labelsInView: summary.raw.totalLabels,
            newLabels: summary.raw.newLabels,
            renames: summary.raw.renames,
            groups: summary.raw.groups,
            crossCategoryGroups: summary.raw.crossCategoryGroups,
            newCrossCategoryGroups: summary.raw.newCrossCategoryGroups,
            rowsMerged: summary.raw.rowsMerged,
        },
        classifications: classified,
    };
    fs.writeFileSync(path.resolve(flags.outPath), JSON.stringify(dump, null, 2));

    console.log(`\n========================================================`);
    const verdict = aborted ? 'ABORTED (too many fallbacks; nothing written)'
        : blocked ? 'ABORTED (cross-category merges need review; nothing written)'
        : flags.dryRun ? 'DRY RUN COMPLETE (no writes)'
        : 'BACKFILL COMPLETE';
    console.log(` ${verdict}`);
    console.log(` classified: ${classified.length}   fallback: ${unresolvedCount}   already done: ${alreadyDone}   written: ${written}   counts refreshed: ${refreshed}`);
    console.log(` raw: ${summary.raw.renames.length} label(s) move rows, ${summary.raw.groups.length} collision group(s), `
        + `${summary.raw.crossCategoryGroups.length} cross-category flag(s) `
        + `(${flaggedMerges} from this run)${mergesBlockWrite && flags.dryRun ? ' — a live run would be BLOCKED' : ''}`);
    console.log(` JSON dump:  ${path.resolve(flags.outPath)}`);
    console.log(`========================================================`);

    if (blocked) process.exit(1);
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
