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
 * The comparison table's label → category join, Admin-SDK-only.
 *
 * `scripts/backfill-ingredient-categories.ts` classifies the whole corpus into
 * the `ingredient_categories` lookup collection. This is the read side of that
 * collection plus the steady-state top-up: new recipes keep introducing labels
 * the backfill has never seen, so a label with no doc is classified inline,
 * once, and the answer is written back for every future viewer.
 *
 * The contract every caller depends on is GRACEFUL DEGRADATION. This module
 * never throws and never blocks the response for long:
 *
 *   - a label with no doc and no successful classification simply has no
 *     category, which the table renders ungrouped / in `other`;
 *   - the inline classification is capped (`MAX_CLASSIFY_ON_MISS` labels, ONE
 *     model call) and hard-bounded by `CLASSIFY_TIMEOUT_MS`;
 *   - the write-through is fire-and-forget — it can never fail or delay the
 *     lookup, and the docs it writes are idempotent (same doc id, same
 *     category), so two viewers racing on the same new label is benign;
 *   - any error at any stage logs once and returns whatever was found so far.
 *
 * MOCK AI. The default classifier goes through `getAIService()`, never
 * `ai.generate` directly, which is what keeps this off a real model in
 * dev/e2e: `instrumentation.ts` has already swapped in `MockAIService` there.
 * That is deliberately the ONLY mechanism — no env flag is read here, because
 * `lib/ai-service.ts` documents (and `tests/verify-production-logic.test.ts`
 * enforces) that nothing in app code selects the mock by environment. The
 * mock's canned answer carries none of the asked-about labels, so mock mode
 * degrades exactly like an unparseable response: no categories, no writes.
 *
 * Every external edge is an injectable dep, so the pure test tier can exercise
 * all of the above with no emulator and no model: Firestore and Genkit are only
 * ever reached through the lazily `import()`ed defaults at the bottom of this
 * file, and are never loaded when a caller supplies stubs.
 */

import { DB_COLLECTION_INGREDIENT_CATEGORIES } from './config';
import {
    ingredientCategoryDocId,
    ingredientCategoryKey,
} from './recipe-lanes/ingredient-label-extract';
import {
    buildClassificationPrompt,
    isIngredientCategoryId,
    parseClassificationResponse,
} from './recipe-lanes/ingredient-taxonomy';
import { standardizeIngredientName } from './utils';

/**
 * Most labels one request will classify inline. The bound is the whole cost
 * story: a comparison of 12 recipes against a backfilled collection normally
 * misses nothing, and even a pathological miss is one Flash call over ≤40
 * short strings. Extra misses are left for a later view (or the next backfill).
 */
export const MAX_CLASSIFY_ON_MISS = 40;

/** Hard ceiling on the inline model call — the user is waiting on this. */
export const CLASSIFY_TIMEOUT_MS = 4000;

/**
 * Refs per `db.getAll`. Not a Firestore limit — `getAll` has no documented cap
 * — just a batch size. It matches the backfill's `READ_CHUNK_SIZE`, which
 * reads this same collection; `hydrateBatch` uses 20 for `icon_index`, whose
 * docs carry embeddings and are vastly larger than a five-field lookup doc.
 * At 100, a 12-recipe comparison is one round trip instead of several.
 */
const READ_CHUNK_SIZE = 100;

/**
 * `source` stamped on docs this module writes, where the backfill stamps its
 * model id (or `'fallback'`). The backfill treats an `'on-miss'` doc as a good
 * doc and will not reclassify it — unlike its own `'fallback'` docs, which it
 * deliberately retries. That is correct: these came from the same prompt and
 * the same model, they were just classified on demand. `--force` still
 * rewrites them.
 */
export const ON_MISS_SOURCE = 'on-miss';

/** One doc read back from `ingredient_categories`. */
export interface IngredientCategoryDoc {
    /** The document id, i.e. `ingredientCategoryDocId(label)`. */
    id: string;
    /** The stored category. Untrusted — validated against the enum. */
    category?: unknown;
}

/** One doc the classify-on-miss path writes back. */
export interface IngredientCategoryWrite {
    docId: string;
    label: string;
    category: string;
    source: typeof ON_MISS_SOURCE;
    model: string;
    classifiedAt: Date;
}

/** What the classifier hands back: the raw text plus the model that produced it. */
export interface ClassifierResponse {
    /** Raw model output, parsed with the shared taxonomy parser. */
    text: string;
    /** Model id stamped onto the write-through docs. */
    model: string;
}

export interface IngredientCategoryLookupDeps {
    /** Batch-reads the given doc ids. Only existing docs need be returned. */
    readCategories(docIds: string[]): Promise<IngredientCategoryDoc[]>;
    /** One classification round-trip. */
    classify(prompt: string): Promise<ClassifierResponse>;
    /** Persists newly classified labels. Never awaited by the lookup. */
    writeCategories(entries: IngredientCategoryWrite[]): Promise<void>;
    /** Injectable clock for the `classifiedAt` stamp. */
    now(): Date;
    /** Overridable so a test does not have to wait 4s for the timeout path. */
    timeoutMs: number;
    /** Overridable so a test can prove the cap without building 41 labels. */
    maxClassifyOnMiss: number;
}

/** One distinct label the lookup is resolving, with its derived identifiers. */
interface LookupTarget {
    /** `ingredientCategoryKey(label)` — the key the caller gets back. */
    key: string;
    /** Standardized display casing, prompted with and stored. */
    label: string;
    /** `ingredientCategoryDocId(label)` — never null by construction. */
    docId: string;
}

/**
 * Resolves taxonomy categories for a set of ingredient labels.
 *
 * Returns a NULL-PROTOTYPE map from `ingredientCategoryKey(label)` (the row
 * key's label half) to category id, holding only the labels that resolved. The
 * null prototype matters: an ingredient label can legitimately be `__proto__`
 * or `constructor`. Read it with bracket access / `Object.entries`; in a test,
 * `Object.fromEntries(Object.entries(result))` before a deep-equality assert.
 */
export async function lookupIngredientCategories(
    labels: string[],
    deps: Partial<IngredientCategoryLookupDeps> = {},
): Promise<Record<string, string>> {
    const {
        readCategories = defaultReadCategories,
        classify = defaultClassify,
        writeCategories = defaultWriteCategories,
        now = () => new Date(),
        timeoutMs = CLASSIFY_TIMEOUT_MS,
        maxClassifyOnMiss = MAX_CLASSIFY_ON_MISS,
    } = deps;

    // Null prototype: keyed by label-derived strings (see the doc comment).
    const found = Object.create(null) as Record<string, string>;

    // Distinct, addressable labels in first-seen order. A label whose key is
    // empty or whose doc id Firestore would reject is silently skipped — those
    // are junk labels ("  ", "__proto__"), not an error worth failing over.
    const targets = new Map<string, LookupTarget>();
    for (const raw of labels) {
        const key = ingredientCategoryKey(raw);
        if (!key || targets.has(key)) continue;
        const docId = ingredientCategoryDocId(raw);
        if (!docId) continue;
        // Standardized display casing, the same form the backfill prompts with
        // and stores, so the two writers cannot disagree about a doc's `label`.
        targets.set(key, { key, label: standardizeIngredientName(raw), docId });
    }
    if (targets.size === 0) return found;

    const byDocId = new Map([...targets.values()].map(t => [t.docId, t]));

    try {
        const ids = [...byDocId.keys()];
        for (let i = 0; i < ids.length; i += READ_CHUNK_SIZE) {
            const docs = await readCategories(ids.slice(i, i + READ_CHUNK_SIZE));
            for (const doc of docs) {
                const target = byDocId.get(doc.id);
                // Validated, not trusted: a doc written by an older taxonomy
                // would otherwise put a dead id on the wire.
                if (target && isIngredientCategoryId(doc.category)) {
                    found[target.key] = doc.category;
                }
            }
        }
    } catch (e) {
        // Nothing found is still a usable answer: everything renders in 'other'.
        logFailure('lookup read failed', e);
        return found;
    }

    const misses = [...targets.values()].filter(t => found[t.key] === undefined);
    if (misses.length === 0) return found;

    try {
        await classifyOnMiss(misses, found, {
            classify,
            writeCategories,
            now,
            timeoutMs,
            maxClassifyOnMiss,
        });
    } catch (e) {
        // Timeout, model error, unparseable response — all the same outcome:
        // these labels have no category this time and get another chance on
        // the next view.
        logFailure('classify-on-miss failed', e);
    }

    return found;
}

/** One label the model classified acceptably, ready to return and to persist. */
interface ResolvedLabel {
    key: string;
    write: IngredientCategoryWrite;
}

/**
 * The write-through half: one bounded model call for labels with no doc, whose
 * results are merged into `found` and queued for persistence.
 *
 * The parse and the write-through deliberately hang off the ORIGINAL call, not
 * off the raced promise. The timeout caps how long the USER waits, not whether
 * the answer is worth keeping: a response that lands at 4.5s was still paid
 * for, and persisting it means the next viewer of the same comparison gets a
 * cache hit instead of repeating the identical slow call forever.
 */
async function classifyOnMiss(
    misses: LookupTarget[],
    found: Record<string, string>,
    deps: Pick<
        IngredientCategoryLookupDeps,
        'classify' | 'writeCategories' | 'now' | 'timeoutMs' | 'maxClassifyOnMiss'
    >,
): Promise<void> {
    const batch = misses.slice(0, deps.maxClassifyOnMiss);
    const labels = batch.map(t => t.label);

    const resolved = deps.classify(buildClassificationPrompt(labels)).then(({ text, model }) => {
        const { assignments } = parseClassificationResponse(text, labels);
        const classifiedAt = deps.now();
        const out: ResolvedLabel[] = [];
        for (const target of batch) {
            const category = assignments[target.label];
            // parseClassificationResponse already rejects anything outside the
            // taxonomy; the guard also narrows `category` away from undefined.
            if (!isIngredientCategoryId(category)) continue;
            out.push({
                key: target.key,
                write: {
                    docId: target.docId,
                    label: target.label,
                    category,
                    source: ON_MISS_SOURCE,
                    model,
                    classifiedAt,
                },
            });
        }

        if (out.length > 0) {
            // Fire-and-forget by design: the caller's response must never wait
            // on the cache write, and a failed write only costs a
            // re-classification later. The writes are idempotent (doc id
            // derived from the label), so two requests racing on the same
            // brand-new label is harmless.
            void Promise.resolve()
                .then(() => deps.writeCategories(out.map(r => r.write)))
                .catch(e => logFailure('write-through failed', e));
        }
        return out;
    });

    // A rejection arriving after the race has already been lost would be
    // unhandled; an early one still reaches the caller through the race.
    void resolved.catch(() => {});

    for (const { key, write } of await withTimeout(resolved, deps.timeoutMs)) {
        found[key] = write.category;
    }
}

function logFailure(what: string, e: unknown): void {
    console.warn(`[ingredient-category-lookup] ${what}:`, e instanceof Error ? e.message : e);
}

/** Rejects after `ms` unless `p` settles first, always clearing its timer. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    });
    // `Promise.race` subscribes to `p`, so a late rejection is still handled.
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// Default (production) deps. Every import here is lazy so that importing this
// module — from a pure unit test, say — initialises neither the Admin SDK nor
// Genkit.
// ---------------------------------------------------------------------------

async function defaultReadCategories(docIds: string[]): Promise<IngredientCategoryDoc[]> {
    const { db } = await import('./firebase-admin');
    const refs = docIds.map(id => db.collection(DB_COLLECTION_INGREDIENT_CATEGORIES).doc(id));
    const docs = await db.getAll(...refs);
    return docs
        .filter(d => d.exists)
        .map(d => ({ id: d.id, category: d.data()?.category }));
}

async function defaultWriteCategories(entries: IngredientCategoryWrite[]): Promise<void> {
    // Deferred past the response with `after()`, the same hook the icon
    // resolution in app/actions.ts uses. A bare floating promise is at the
    // mercy of Cloud Run's request-scoped CPU throttling, which is exactly how
    // a write-through cache silently stops filling. Outside a request scope
    // (a script, a unit test) `after` throws, so fall back to running it now —
    // either way the caller is not waiting on the result.
    const run = async () => {
        const { db } = await import('./firebase-admin');
        const batch = db.batch();
        for (const entry of entries) {
            // MERGE, unlike the backfill's full `set`. This module knows only
            // its own five fields; a plain `set` would delete the backfill's
            // `nnCategory` / `nnScore` / `usageCount` / `recipeCount` from any
            // doc that already had them. That happens for real: a doc whose
            // stored category failed enum validation on read counts as a miss,
            // gets reclassified here, and would be stripped on write-through.
            batch.set(
                db.collection(DB_COLLECTION_INGREDIENT_CATEGORIES).doc(entry.docId),
                {
                    label: entry.label,
                    category: entry.category,
                    source: entry.source,
                    model: entry.model,
                    classifiedAt: entry.classifiedAt,
                },
                { merge: true },
            );
        }
        await batch.commit();
    };

    try {
        const { after } = await import('next/server');
        after(run);
    } catch {
        await run();
    }
}

async function defaultClassify(prompt: string): Promise<ClassifierResponse> {
    const [{ getAIService }, { textModel }] = await Promise.all([
        import('./ai-service'),
        import('./genkit'),
    ]);
    // Through the AI service, not `ai.generate` directly, so the dev/e2e
    // harness's injected MockAIService covers this call too.
    const text = await getAIService().generateText(prompt);
    // Stamp the bare model id, the same shape the backfill writes.
    return { text, model: textModel.replace(/^vertexai\//, '') };
}
