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
 * Classifies every `icon_index` document and writes the taxonomy `category`
 * back onto the doc, so the UMAP view at /tools/umap can colour the embedding
 * space by category.
 *
 * SIBLING, NOT A COPY OF, `backfill-ingredient-categories.ts`. Same prompt,
 * same Vertex transport, same safety rails — but a different corpus and a
 * different contract, which is why it is a separate script:
 *
 *  - The names here are VISUAL DESCRIPTIONS of an icon ("12 Golden Brown Baked
 *    Cinnamon Rolls...", "Oven Preheating"), not the standardized ingredient
 *    labels the comparison table joins on. There is no reliable mapping from
 *    one to the other, so these classifications must not leak into
 *    `ingredient_categories` and this script never writes there.
 *  - Because icons include process and equipment states, the extra
 *    `action_or_state` id is enabled (`includeIconCategories: true`). The
 *    comparison-side enum stays closed; only icon docs can carry it.
 *  - There is no nearest-neighbour cross-check. The label backfill needs one
 *    because a wrong row category is invisible in a table. Here the icons
 *    already sit in a 2-D projection of embedding space, so a misclassification
 *    shows up as a wrong-coloured ring inside an otherwise coherent
 *    neighbourhood — THE UMAP VIEW IS THE CROSS-CHECK, and a far weaker
 *    seed-anchor NN would only add noise to it.
 *
 * IDEMPOTENCY / RESUMABILITY. A doc that already has a category is skipped, so
 * re-running is cheap and a half-finished run resumes where it stopped. The one
 * deliberate exception: docs with `categorySource: 'fallback'` are retried.
 * A fallback means the classifier FAILED for that icon and it was parked in
 * `other` — skipping it would make one bad run permanent, and permanently grey
 * on the map. `--force` reclassifies everything regardless.
 *
 * For the same reason the run REFUSES to write when more than
 * `MAX_FALLBACK_FRACTION` of it fell back: that is a broken Vertex endpoint,
 * not a hard corpus. `--force-fallbacks` overrides once you know why.
 *
 * Usage:
 *   npx tsx scripts/backfill-icon-categories.ts (--staging | --prod)
 *       [--dry-run] [--limit N] [--force] [--force-fallbacks] [--out path.json]
 *
 * `--staging` or `--prod` is REQUIRED — this script writes, so the target must
 * be stated rather than defaulted. `--limit N` caps DOCUMENTS scanned (the
 * label backfill's `--limit` counts recipes; this corpus is one doc per icon).
 * `--dry-run` performs zero Firestore writes but still reads and classifies,
 * which is the point: it is how classification quality gets reviewed first.
 *
 * NOTE (follow-up): the Vertex REST call + token cache and the `withConcurrency`
 * helper below are near-duplicates of the ones in
 * `backfill-ingredient-categories.ts` / `backfill-icon-search-terms.ts`.
 * Extracting them into `scripts/lib/` is worth doing, but it touches those
 * scripts and belongs in its own PR rather than riding along with this one.
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { GoogleAuth } from 'google-auth-library';
import { DB_COLLECTION_ICON_INDEX } from '../lib/config';
import { scanCollection } from './lib/db-tools';
import {
    buildClassificationPrompt,
    parseClassificationResponse,
    ALL_CLASSIFICATION_CATEGORIES,
    ALL_CLASSIFICATION_IDS,
    FALLBACK_CATEGORY_ID,
    ICON_ONLY_CATEGORIES,
    TAXONOMY_RULES_VERSION,
} from '../lib/recipe-lanes/ingredient-taxonomy';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL = 'gemini-2.5-flash';
const VERTEX_LOCATION = 'us-central1';

/** Icon names per classification call. */
const BATCH_SIZE = 50;
/** Extra attempts for a batch that comes back missing/invalid names. */
const MAX_RETRIES = 2;
/** How many times a truncated batch may be halved before giving up. */
const MAX_SPLIT_DEPTH = 4;
/** Classification calls in flight at once. */
const CONCURRENCY = 4;

/** Backoff before retry N (1-based), before jitter. */
const BACKOFF_MS = [2_000, 8_000];
/** Floor for the cool-down applied after a 429, if the server suggests none. */
const RATE_LIMIT_COOLDOWN_MS = 10_000;

/** Refuse to write a run that fell back on more than this fraction of icons. */
const MAX_FALLBACK_FRACTION = 0.2;

/** Firestore's own cap is 500 ops; siblings stay at 200 for headroom. */
const WRITE_BATCH_SIZE = 200;

/** Example icon names shown per category in the report. */
const EXAMPLES_PER_CATEGORY = 15;

const CLASSIFY_OPTS = { includeIconCategories: true } as const;

/**
 * Only these fields are read off each `icon_index` doc.
 *
 * The docs also carry 768- and 384-dimension embedding vectors, which this
 * script never looks at — fetching whole documents moved roughly a hundred
 * times more data than the scan needs.
 */
const SCAN_FIELDS = ['ingredient_name', 'category', 'categorySource', 'categoryRulesVersion'];

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
    console.error('Usage: npx tsx scripts/backfill-icon-categories.ts (--staging | --prod)');
    console.error('           [--dry-run] [--limit N] [--force] [--force-fallbacks] [--out path.json]\n');
    process.exit(1);
}

function parseFlags(args: string[]): Flags {
    const staging = args.includes('--staging');
    const prod = args.includes('--prod');
    // Deliberately no default: this script writes to a real database, and
    // guessing which one is not a thing it should ever do.
    if (staging === prod) {
        fail(staging
            ? 'Pass exactly one of --staging / --prod, not both.'
            : 'Pass --staging or --prod: this script writes, so the target must be explicit.');
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
        outPath: flagValue(args, '--out') ?? `./icon-categories-${envName}-${date}.json`,
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
// Vertex Gemini (REST)
// ---------------------------------------------------------------------------

/**
 * One `GoogleAuth` for the whole run, built on first use.
 *
 * Lazily, because GoogleAuth resolves credentials when it is first *used*, and
 * `initFirebase` has to have pinned `GOOGLE_APPLICATION_CREDENTIALS` by then.
 * Once, because rebuilding it per token discards the library's own cache.
 */
let auth: GoogleAuth | null = null;

/**
 * Deliberately does NOT cache the token itself. `getAccessToken()` already
 * caches and refreshes against the token's REAL expiry; a hand-rolled fixed
 * one-hour TTL can only get that wrong, and it gets it wrong in the expensive
 * direction — a token that expires early keeps being served, every Vertex call
 * 401s, and the retry/backoff budget is burned on an auth problem that the
 * error path reads as a model problem.
 */
async function getToken(): Promise<string> {
    auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
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
                // answer comes back truncated. Looking up 50 names in a fixed
                // table needs no deliberation, so switch it off outright.
                thinkingConfig: { thinkingBudget: 0 },
            },
        }),
    });

    if (res.status === 429) {
        // A server-stated Retry-After is honoured as given: the endpoint knows
        // when its quota frees up, and a SHORT value is information rather than
        // an underestimate to be floored away. RATE_LIMIT_COOLDOWN_MS is only a
        // guess for when the server said nothing at all, so it applies only
        // then. Either way the per-attempt backoff is still respected.
        const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
        const wait = retryAfter > 0
            ? Math.max(retryAfter, backoffMs)
            : Math.max(backoffMs, RATE_LIMIT_COOLDOWN_MS);
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
 * Classifies one batch of icon names, retrying only the names that did not come
 * back usable. Returns the assignments it managed to get; anything absent from
 * the result is the caller's fallback problem.
 */
async function classifyBatch(
    projectId: string,
    names: string[],
    log: (message: string) => void,
    depth = 0,
): Promise<Map<string, string>> {
    const resolved = new Map<string, string>();
    let outstanding = names;

    for (let attempt = 1; attempt <= MAX_RETRIES + 1 && outstanding.length > 0; attempt++) {
        if (attempt > 1) await sleep(backoffFor(attempt - 1));
        try {
            const raw = await callGemini(projectId, buildClassificationPrompt(outstanding, CLASSIFY_OPTS), backoffFor(attempt));
            const result = parseClassificationResponse(raw, outstanding, CLASSIFY_OPTS);
            // `assignments` is null-prototype by design (a name may literally
            // be "__proto__"), so read it with Object.entries / bracket access.
            for (const [name, category] of Object.entries(result.assignments)) {
                resolved.set(name, category);
            }
            if (result.invalid.length > 0) {
                log(`  attempt ${attempt}: ${result.invalid.length} invalid category value(s), e.g. ${result.invalid.slice(0, 3).map(i => `"${i.label}" -> "${i.value}"`).join(', ')}`);
            }
            outstanding = result.missing;
            if (outstanding.length > 0) {
                log(`  attempt ${attempt}: ${outstanding.length}/${names.length} name(s) unresolved, retrying just those`);
            }
        } catch (e: any) {
            // A truncated answer is a size problem, not a luck problem: ask for
            // less instead of asking again. Each half gets its own full retry
            // budget, and the recursion is depth-capped.
            if (e instanceof TruncatedResponseError) {
                if (outstanding.length > 1 && depth < MAX_SPLIT_DEPTH) {
                    const mid = Math.ceil(outstanding.length / 2);
                    const halves = [outstanding.slice(0, mid), outstanding.slice(mid)];
                    log(`  attempt ${attempt}: ${e.message} — splitting ${outstanding.length} names into ${halves.map(h => h.length).join(' + ')}`);
                    for (const half of halves) {
                        for (const [name, category] of await classifyBatch(projectId, half, log, depth + 1)) {
                            resolved.set(name, category);
                        }
                    }
                    // The halves consumed their own retries; nothing left to do here.
                    break;
                }
                // The request cannot get any smaller — a single name, or the
                // split budget is spent. Looping would re-send a byte-identical
                // request at temperature 0 and truncate at the identical place,
                // so stop paying for attempts that cannot differ and let the
                // caller's fallback path own these names.
                log(`  attempt ${attempt}: ${e.message} — cannot split further (${outstanding.length} name(s), depth ${depth}); leaving them to the fallback`);
                break;
            }
            log(`  attempt ${attempt} failed: ${e.message}`);
        }
    }

    return resolved;
}

// ---------------------------------------------------------------------------
// Concurrency helpers
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
// Report
// ---------------------------------------------------------------------------

/** One icon doc that this run classified. */
interface Classified {
    id: string;
    name: string;
    category: string;
    /**
     * HOW the category was decided, not by what. The model id is a separate
     * field (`categoryModel`), so putting it here too meant the provenance flag
     * changed value every time the model was upgraded — and any code testing it
     * for "was this a real classification" had to know every model id ever used.
     */
    source: 'llm' | 'fallback';
}

function table(headers: string[], rows: string[][]): string {
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)));
    const line = (cells: string[]) => cells.map((c, i) => (c ?? '').padEnd(widths[i])).join('  ').trimEnd();
    return [line(headers), widths.map(w => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

/**
 * Everything the reporting and the JSON dump need, grouped in ONE pass.
 *
 * The naive shape of this stage re-scans the whole `classified` array for every
 * question it asks — once per category for the counts, again per category for
 * the examples, and again for each of the four places that want the fallbacks.
 * That is ~30 linear scans of the same array to produce one report. Grouping
 * once and sharing the result costs a single pass, and it also guarantees the
 * printed tables and the dumped JSON describe the same grouping rather than two
 * independently recomputed ones.
 */
interface Summary {
    total: number;
    /** category id -> its docs, in classification order. Categories with none are absent. */
    byCategory: Map<string, Classified[]>;
    /** Taxonomy-ordered counts, including the zeroes, for the table and the dump. */
    counts: { category: string; label: string; count: number }[];
    fallbacks: Classified[];
}

function summarise(classified: Classified[]): Summary {
    const byCategory = new Map<string, Classified[]>();
    const fallbacks: Classified[] = [];

    for (const entry of classified) {
        const group = byCategory.get(entry.category);
        if (group) group.push(entry);
        else byCategory.set(entry.category, [entry]);
        if (entry.source === 'fallback') fallbacks.push(entry);
    }

    // Driven by the taxonomy's own ordered list, not by the map's keys, so the
    // report keeps taxonomy order and still shows categories nothing landed in.
    const counts = ALL_CLASSIFICATION_CATEGORIES.map(c => ({
        category: c.id as string,
        label: c.label,
        count: byCategory.get(c.id)?.length ?? 0,
    }));

    return { total: classified.length, byCategory, counts, fallbacks };
}

function printReport(summary: Summary): void {
    const { counts, total, byCategory, fallbacks } = summary;

    console.log('\n================ PER-CATEGORY COUNTS ================\n');
    console.log(table(
        ['category', 'display', 'icons', 'share'],
        counts.map(c => [
            c.category,
            c.label,
            String(c.count),
            `${((c.count / Math.max(total, 1)) * 100).toFixed(1)}%`,
        ]),
    ));
    console.log(`\ntotal icons classified: ${total}`);

    console.log(`\n============ UP TO ${EXAMPLES_PER_CATEGORY} EXAMPLES PER CATEGORY ============`);
    for (const { category, label, count } of counts) {
        if (count === 0) continue;
        const examples = (byCategory.get(category) ?? []).slice(0, EXAMPLES_PER_CATEGORY);
        console.log(`\n${label} (${category}) — ${count} icons`);
        console.log(table(
            ['icon name', 'src'],
            examples.map(c => [c.name, c.source === 'fallback' ? 'FALLBACK' : c.source]),
        ));
    }

    console.log('\n==================== FALLBACKS ====================\n');
    if (fallbacks.length === 0) {
        console.log('None — every icon was classified by the model.');
    } else {
        console.log(table(['icon id', 'icon name'], fallbacks.map(c => [c.id, c.name])));
        console.log(`\n${fallbacks.length} of ${total} (${((fallbacks.length / Math.max(total, 1)) * 100).toFixed(1)}%).`);
        console.log('These are retried automatically on the next run — fallback docs are not treated as done.');
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** One `icon_index` doc that is a candidate for classification. */
interface IconDoc {
    id: string;
    name: string;
}

async function main(): Promise<void> {
    const flags = parseFlags(process.argv.slice(2));

    console.log('========================================================');
    console.log(` ENVIRONMENT: ${flags.envName}`);
    console.log(` MODE:        ${flags.dryRun ? 'DRY RUN (zero Firestore writes)' : 'LIVE WRITE'}`);
    console.log(` LIMIT:       ${flags.limit === Infinity ? 'none' : `${flags.limit} icon docs`}`);
    console.log(` FORCE:       ${flags.force}${flags.forceFallbacks ? '   FORCE-FALLBACKS: true' : ''}`);
    console.log(` OUT:         ${flags.outPath}`);
    const { db, projectId } = initFirebase(flags.envName);
    console.log('========================================================\n');

    // --- 1. Scan ----------------------------------------------------------
    // Unlike the label backfill there is no census/dedup step: the unit of work
    // IS the document, because the category is written onto the doc itself.
    console.log(`Scanning ${DB_COLLECTION_ICON_INDEX}...`);
    const pending: IconDoc[] = [];
    let scanned = 0;
    let alreadyDone = 0;
    let retriedFallbacks = 0;
    let staleVersion = 0;
    let unnamed = 0;

    for await (const doc of scanCollection(db, DB_COLLECTION_ICON_INDEX, 500, SCAN_FIELDS)) {
        if (scanned >= flags.limit) break;
        scanned++;
        const data = doc.data() ?? {};
        const name = typeof data.ingredient_name === 'string' ? data.ingredient_name.trim() : '';
        // Nothing to classify from, and inventing a name from the doc id would
        // just feed the model a slug. Left untouched, so it renders grey.
        if (!name) { unnamed++; continue; }

        if (!flags.force && typeof data.category === 'string' && data.category) {
            // A fallback is a FAILURE parked in 'other', not a result: retry it
            // rather than letting one bad run stay on the map forever.
            if (data.categorySource === 'fallback') {
                retriedFallbacks++;
            } else if (data.categoryRulesVersion !== TAXONOMY_RULES_VERSION) {
                // Classified against boundaries the taxonomy no longer states.
                // Docs written before versioning have no field at all, which
                // compares unequal and so gets picked up here too — exactly
                // right, since they predate every clause added since.
                staleVersion++;
            } else {
                alreadyDone++;
                continue;
            }
        }
        pending.push({ id: doc.id, name });
    }

    console.log(`Icon docs scanned: ${scanned}${unnamed ? ` (${unnamed} with no ingredient_name, skipped)` : ''}`);
    if (flags.force) {
        console.log(`--force: reclassifying every icon, already-categorised docs included.`);
    } else {
        const reasons = [
            retriedFallbacks ? `${retriedFallbacks} earlier fallback(s)` : '',
            staleVersion ? `${staleVersion} classified under older rules (now v${TAXONOMY_RULES_VERSION})` : '',
        ].filter(Boolean);
        console.log(`Already classified: ${alreadyDone}   To classify: ${pending.length}${reasons.length ? ` (incl. ${reasons.join(', ')})` : ''}`);
    }
    console.log('');

    if (pending.length === 0) { console.log('Nothing to do.'); return; }

    // --- 2. Classify -------------------------------------------------------
    // Batch by DISTINCT name: the prompt is keyed by name, and duplicate icon
    // names are common (several renders of the same subject). Classifying a
    // name once and fanning the answer back out to its docs saves calls and
    // guarantees identical subjects get identical colours.
    // The answer is fanned back out via the `assignments` map keyed by name, so
    // the distinct names are all this step needs — grouping the docs themselves
    // built an index nothing ever read.
    const distinctNames = [...new Set(pending.map(d => d.name))];

    const batches = chunk(distinctNames, BATCH_SIZE);
    console.log(`Classifying ${distinctNames.length} distinct name(s) for ${pending.length} doc(s) in ${batches.length} batch(es) of up to ${BATCH_SIZE} via ${MODEL}...`);
    const assignments = new Map<string, string>();
    let batchesDone = 0;

    await withConcurrency(
        batches.map((batch, index) => async () => {
            const resolved = await classifyBatch(projectId, batch, msg => console.log(`[batch ${index + 1}]${msg}`));
            for (const [name, category] of resolved) assignments.set(name, category);
            batchesDone++;
            console.log(`[batch ${index + 1}] ${resolved.size}/${batch.length} classified  (${batchesDone}/${batches.length} batches done)`);
        }),
        CONCURRENCY,
    );

    const classified: Classified[] = pending.map(doc => {
        const category = assignments.get(doc.name);
        return {
            id: doc.id,
            name: doc.name,
            category: category ?? FALLBACK_CATEGORY_ID,
            source: category ? 'llm' : 'fallback',
        };
    });

    // Grouped once here; the circuit-breaker, the report and the JSON dump all
    // read this rather than re-scanning `classified` for the same answers.
    const summary = summarise(classified);
    const unresolvedCount = summary.fallbacks.length;
    if (unresolvedCount > 0) {
        const names = [...new Set(summary.fallbacks.map(c => c.name))];
        console.warn(`\n⚠️  ⚠️  ${unresolvedCount} doc(s) across ${names.length} name(s) survived ${MAX_RETRIES + 1} attempts unclassified and are being forced to '${FALLBACK_CATEGORY_ID}' with categorySource 'fallback':`);
        for (const name of names) console.warn(`      ${JSON.stringify(name)}`);
        console.warn('    These are retried automatically on the next run — fallback docs are not treated as done.\n');
    }

    // --- 3. Fallback circuit-breaker ---------------------------------------
    const fallbackFraction = classified.length > 0 ? unresolvedCount / classified.length : 0;
    const tooManyFallbacks = fallbackFraction > MAX_FALLBACK_FRACTION;
    let aborted = false;
    if (tooManyFallbacks && !flags.forceFallbacks) {
        aborted = true;
        console.error('\n########################################################');
        console.error(`# ABORTING BEFORE WRITE: ${unresolvedCount}/${classified.length} icons (${(fallbackFraction * 100).toFixed(1)}%) fell back to`);
        console.error(`# '${FALLBACK_CATEGORY_ID}', over the ${(MAX_FALLBACK_FRACTION * 100).toFixed(0)}% limit. That is an unhealthy classifier,`);
        console.error('# not a hard corpus, and writing it would paint the UMAP view grey.');
        console.error('#');
        console.error('# Check Vertex health first: quota/429s, model availability in');
        console.error(`# ${VERTEX_LOCATION}, and the credentials for project ${projectId}.`);
        console.error('# Re-run once it is healthy, or pass --force-fallbacks to write anyway.');
        console.error('########################################################\n');
    } else if (tooManyFallbacks) {
        console.warn(`\n⚠️  --force-fallbacks: writing despite ${(fallbackFraction * 100).toFixed(1)}% fallbacks.\n`);
    }

    // --- 4. Write ----------------------------------------------------------
    const classifiedAt = new Date();
    let written = 0;

    // The abort is checked FIRST, including under --dry-run. A dry run's job is
    // to report what a live run would do, and a live run on this data would
    // refuse to write — so printing "would update N docs" here would be exactly
    // the wrong answer to the only question the dry run is being asked.
    if (aborted) {
        console.error(
            flags.dryRun
                ? `\nDRY RUN — a live run of this data would REFUSE to write: too many fallbacks, so all ${classified.length} classification(s) would be discarded.`
                : `\nNo documents were written (${classified.length} classification(s) discarded).`,
        );
    } else if (flags.dryRun) {
        console.log(`\nDRY RUN — would update ${classified.length} doc(s) in ${DB_COLLECTION_ICON_INDEX}; nothing was written.`);
    } else {
        console.log(`\nUpdating ${classified.length} doc(s) in ${DB_COLLECTION_ICON_INDEX}...`);
        for (const group of chunk(classified, WRITE_BATCH_SIZE)) {
            const batch = db.batch();
            for (const entry of group) {
                // MERGE, emphatically: these docs are the icon gallery's own
                // records (embeddings, umap coords, search terms). This script
                // owns exactly the five category* fields and must not so much
                // as graze the rest.
                batch.set(
                    db.collection(DB_COLLECTION_ICON_INDEX).doc(entry.id),
                    {
                        category: entry.category,
                        categorySource: entry.source,
                        categoryModel: MODEL,
                        categoryClassifiedAt: classifiedAt,
                        // Which boundary text produced this answer. The scan
                        // above reclassifies anything stamped with a different
                        // version, so a rules edit reaches old docs instead of
                        // needing a blanket --force.
                        categoryRulesVersion: TAXONOMY_RULES_VERSION,
                    },
                    { merge: true },
                );
            }
            await batch.commit();
            written += group.length;
            console.log(`  ${written}/${classified.length}`);
        }
    }

    // --- 5. Evidence --------------------------------------------------------
    printReport(summary);

    const dump = {
        env: flags.envName,
        project: projectId,
        model: MODEL,
        collection: DB_COLLECTION_ICON_INDEX,
        dryRun: flags.dryRun,
        force: flags.force,
        forceFallbacks: flags.forceFallbacks,
        abortedForFallbacks: aborted,
        limit: flags.limit === Infinity ? null : flags.limit,
        generatedAt: classifiedAt.toISOString(),
        iconsScanned: scanned,
        iconsWithoutName: unnamed,
        rulesVersion: TAXONOMY_RULES_VERSION,
        alreadyClassified: alreadyDone,
        fallbacksRetried: retriedFallbacks,
        reclassifiedForRulesVersion: staleVersion,
        distinctNames: distinctNames.length,
        classifiedNow: classified.length,
        fallbackCount: unresolvedCount,
        docsWritten: written,
        categoryCounts: summary.counts,
        fallbacks: summary.fallbacks.map(c => ({ id: c.id, name: c.name })),
        classifications: classified,
    };
    fs.writeFileSync(path.resolve(flags.outPath), JSON.stringify(dump, null, 2));

    console.log(`\n========================================================`);
    console.log(` ${aborted ? 'ABORTED (too many fallbacks; nothing written)' : flags.dryRun ? 'DRY RUN COMPLETE (no writes)' : 'BACKFILL COMPLETE'}`);
    console.log(` classified: ${classified.length}   fallback: ${unresolvedCount}   already done: ${alreadyDone}   written: ${written}`);
    console.log(` categories offered: ${ALL_CLASSIFICATION_IDS.length} (incl. ${ICON_ONLY_CATEGORIES.map(c => c.id).join(', ')})`);
    console.log(` JSON dump:  ${path.resolve(flags.outPath)}`);
    console.log(`========================================================`);

    if (aborted) process.exit(1);
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
