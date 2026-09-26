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
 * The comparison table's label → category (and raw ingredient) join,
 * Admin-SDK-only.
 *
 * `scripts/backfill-ingredient-categories.ts` classifies the whole corpus into
 * the `ingredient_categories` lookup collection. This is the read side of that
 * collection plus the steady-state top-up: new recipes keep introducing labels
 * the backfill has never seen, so a label with no doc is classified inline,
 * once, and the answer is written back for every future viewer.
 *
 * Two derived fields ride the same doc, and the same call resolves both: the
 * taxonomy `category` (which groups and colours the row) and the
 * `rawIngredient` (the pantry item the row should eventually be totalled
 * under — see `RAW_INGREDIENT_RULES`). They travel together because they come
 * from one model call over one label: splitting them would double the cost of
 * a miss for no benefit.
 *
 * The contract every caller depends on is GRACEFUL DEGRADATION. This module
 * never throws and never blocks the response for long:
 *
 *   - a label with no doc and no successful classification simply has no
 *     category, which the table renders ungrouped / in `other`;
 *   - a label with no raw ingredient simply has none, which callers read as
 *     identity (the label is its own raw ingredient) — never as an error;
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
    validRawIngredient,
    RAW_RULES_VERSION,
    type ClassificationOptions,
} from './recipe-lanes/ingredient-taxonomy';
import { guardRawIngredient } from './recipe-lanes/raw-ingredient-guard';
import { standardizeIngredientName } from './utils';

/**
 * The options this path classifies with, threaded through BOTH the prompt
 * builder and the parser — they are documented as one contract, and passing
 * different objects to the two halves is how a future option (a category set,
 * say) silently starts prompting for one thing and validating another. Same
 * shape as `CLASSIFY_OPTS` in `scripts/backfill-icon-categories.ts`.
 */
const CLASSIFY_OPTS: ClassificationOptions = { includeRaw: true } as const;

/**
 * Most labels one request will classify inline, sized against
 * `CLASSIFY_TIMEOUT_MS` rather than picked round.
 *
 * The user is waiting, so what matters is how much the model can GENERATE in
 * the budget. Asking for a raw name changed that arithmetic: an entry went
 * from `"Carrot, Chopped": "vegetables"` to
 * `"Carrot, Chopped": {"category": "vegetables", "raw": "Carrot"}` — roughly
 * 10 output tokens to roughly 25. At the conservative end of Flash's streaming
 * rate (~100 tokens/s) a 4s budget buys ~400 output tokens: about 40 bare ids,
 * but only about 16 objects. The 2.6KB of boundary rules the prompt now
 * carries is input, not output, and the unspent ~25 tokens of slack below
 * stand in for connection setup and prefill, which the rate alone ignores.
 *
 * 40 was therefore a cap that no longer fitted its own timeout: the first
 * viewer of a comparison with 40 unseen labels would race past 4s and see
 * EVERYTHING in `other`, having paid for the call anyway. Lowering the cap is
 * the right lever rather than raising the timeout, because the degradation is
 * self-healing — the write-through hangs off the unraced promise, so the
 * answer still lands in the collection and the next view is a cache hit. A
 * slower first view buys nothing that a second view does not already give.
 *
 * The two numbers are ONE decision; `tests/ingredient-category-lookup.test.ts`
 * asserts the arithmetic so that moving either alone fails loudly.
 *
 * Extra misses are left for a later view (or the next backfill), which is also
 * why a comparison of 12 recipes against a backfilled collection normally
 * never reaches this path at all.
 */
export const MAX_CLASSIFY_ON_MISS = 15;

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
    /**
     * The stored raw ingredient name. Untrusted, and absent on every doc the
     * backfill wrote before raw extraction existed — which is the entire
     * production corpus until that pass runs, so "no raw" is the normal case,
     * not a fault.
     */
    rawIngredient?: unknown;
}

/** One doc the classify-on-miss path writes back. */
export interface IngredientCategoryWrite {
    docId: string;
    label: string;
    category: string;
    /**
     * The raw ingredient name, when the model returned a usable one. Absent
     * otherwise, and absent means the field is simply not written: the reader
     * falls back to identity, and writing a guessed name instead would bake a
     * merge nobody asked for into the shared lookup collection.
     */
    rawIngredient?: string;
    /**
     * The raw rules version that produced `rawIngredient`, stamped only
     * beside an actual name. A version stamp on a doc carrying no raw value
     * is precisely the rollout gap `RAW_RULES_VERSION` was split off to avoid:
     * the backfill would read the doc as current and never fill it in.
     */
    rawRulesVersion?: number;
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

/**
 * What the lookup resolved for one label.
 *
 * Both fields are optional and independent. `category` absent means the label
 * is unclassified (rendered as `other`); `raw` absent means the label is its
 * own raw ingredient — identity, the conservative default that leaves the
 * label's comparison row exactly where it is today. Neither absence is an
 * error, and a label that resolved neither never appears in the result at all.
 */
export interface IngredientLookupEntry {
    /** Taxonomy category id, validated against the enum before it is set. */
    category?: string;
    /** Raw ingredient name in display casing; absent = identity. */
    raw?: string;
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
 * Resolves taxonomy categories and raw ingredient names for a set of labels.
 *
 * Returns a NULL-PROTOTYPE map from `ingredientCategoryKey(label)` (the row
 * key's label half) to what resolved for it, holding only the labels that
 * resolved something. The null prototype matters: an ingredient label can
 * legitimately be `__proto__` or `constructor`. Read it with bracket access /
 * `Object.entries`; in a test, `Object.fromEntries(Object.entries(result))`
 * before a deep-equality assert.
 */
export async function lookupIngredientCategories(
    labels: string[],
    deps: Partial<IngredientCategoryLookupDeps> = {},
): Promise<Record<string, IngredientLookupEntry>> {
    const {
        readCategories = defaultReadCategories,
        classify = defaultClassify,
        writeCategories = defaultWriteCategories,
        now = () => new Date(),
        timeoutMs = CLASSIFY_TIMEOUT_MS,
        maxClassifyOnMiss = MAX_CLASSIFY_ON_MISS,
    } = deps;

    // Null prototype: keyed by label-derived strings (see the doc comment).
    const found = Object.create(null) as Record<string, IngredientLookupEntry>;

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
                if (!target) continue;
                // Validated, not trusted: a doc written by an older taxonomy
                // would otherwise put a dead id on the wire.
                //
                // The two fields are validated INDEPENDENTLY, but a doc whose
                // CATEGORY is unusable still counts as a miss and goes to the
                // classifier, which re-answers both — so there is nothing to
                // keep from it. Raw alone would also be a half-answer: it
                // cannot group the row, only merge it.
                if (!isIngredientCategoryId(doc.category)) continue;
                // The SAME predicate the parser applies to a model answer, not
                // a looser read-side copy. Both writers bound what they store
                // today, but a lookup collection outlives the code that filled
                // it: docs written before those bounds existed are still
                // there, docs get hand-edited, and an unbounded value here
                // becomes a comparison row label once the merge lands.
                //
                // REJECTED rather than truncated through
                // `boundRawIngredientName`, which is the other defensible
                // option and the one the writers use. The asymmetry the
                // boundary rules are built on decides it: over-merging
                // silently sums unrelated quantities, under-merging is
                // cosmetic. Truncating collapses two long names onto one key
                // whenever they share an 80-character prefix ("... Drained
                // And Crushed By Hand" / "... By Machine") — a merge no model
                // sanctioned. Rejecting costs nothing in exchange, because an
                // over-long stored value can only have come from the identity
                // fallback, where the raw name IS the label: dropping it keys
                // the row on that same label anyway. Truncation is right
                // where a name is written for the first time and there is no
                // other answer available; here there is one.
                //
                // Then GUARDED, for the same reason: the parser already refuses
                // an ambiguous raw name ("Pepper", "Clove", "Whites"…) before
                // it is written, but a doc written before a word joined
                // `AMBIGUOUS_RAW` still carries it. Guarding where the value is
                // used means adding a word protects every stored doc at once,
                // with no re-backfill — and every row-keying consumer gets its
                // raw names through here.
                const raw = guardRawIngredient(target.label, validRawIngredient(doc.rawIngredient));
                // Spread, not `raw: undefined`: the contract callers test
                // against is `'raw' in entry === false`, and an explicit
                // undefined key satisfies `in` while failing deep equality
                // against an entry that genuinely has no raw name.
                found[target.key] = { category: doc.category, ...(raw ? { raw } : {}) };
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
    found: Record<string, IngredientLookupEntry>,
    deps: Pick<
        IngredientCategoryLookupDeps,
        'classify' | 'writeCategories' | 'now' | 'timeoutMs' | 'maxClassifyOnMiss'
    >,
): Promise<void> {
    const batch = misses.slice(0, deps.maxClassifyOnMiss);
    const labels = batch.map(t => t.label);

    // `includeRaw`: the same single call now answers both fields. A miss is
    // already paying for a model round trip, and asking separately would mean
    // two — so the extra cost here is output tokens on an already-bounded
    // batch (see `MAX_CLASSIFY_ON_MISS`, which is sized for exactly this), not
    // an extra request. A model that ignores the object shape and answers with
    // bare ids still parses (see `splitEntry`); those labels just get no raw.
    const prompt = buildClassificationPrompt(labels, CLASSIFY_OPTS);

    const resolved = deps.classify(prompt).then(({ text, model }) => {
        const { assignments, rawAssignments } = parseClassificationResponse(
            text,
            labels,
            CLASSIFY_OPTS,
        );
        const classifiedAt = deps.now();
        const out: ResolvedLabel[] = [];
        for (const target of batch) {
            const category = assignments[target.label];
            // parseClassificationResponse already rejects anything outside the
            // taxonomy; the guard also narrows `category` away from undefined.
            if (!isIngredientCategoryId(category)) continue;
            // Standardized for the same reason `label` is, so the backfill and
            // this path cannot disagree about the casing of a doc's
            // `rawIngredient`, then re-checked: the parser validated what the
            // MODEL said, and this stores something slightly different.
            const modelRaw = rawAssignments[target.label];
            const raw = modelRaw
                ? validRawIngredient(standardizeIngredientName(modelRaw))
                : undefined;
            out.push({
                key: target.key,
                write: {
                    docId: target.docId,
                    label: target.label,
                    category,
                    // Both raw fields or neither — a stamp with no value is the
                    // rollout gap the separate version counter exists to close.
                    //
                    // That invariant is on this ENTRY, not on the resulting
                    // doc: the write is `{merge: true}`, so a doc that already
                    // had a `rawIngredient` keeps it when this pass produces
                    // none (a category that failed enum validation on read,
                    // re-answered in the bare-id shape). The doc then carries a
                    // raw name this request's caller did not see, and two
                    // consecutive views disagree about that row until the
                    // backfill revisits the doc. Benign and self-healing —
                    // clearing the field instead would throw away a good name
                    // because of one malformed response — but it is the reason
                    // this comment says "entry" rather than "document".
                    ...(raw ? { rawIngredient: raw, rawRulesVersion: RAW_RULES_VERSION } : {}),
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
        found[key] = {
            category: write.category,
            ...(write.rawIngredient ? { raw: write.rawIngredient } : {}),
        };
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
        .map(d => ({
            id: d.id,
            category: d.data()?.category,
            rawIngredient: d.data()?.rawIngredient,
        }));
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
            const doc: Record<string, unknown> = {
                label: entry.label,
                category: entry.category,
                source: entry.source,
                model: entry.model,
                classifiedAt: entry.classifiedAt,
            };
            // Added conditionally rather than passed as `undefined`, which the
            // Admin SDK rejects outright. No raw name means the doc keeps no
            // `rawIngredient` field — and so also no `rawRulesVersion`, which
            // keeps it visible to the backfill's staleness scan.
            if (entry.rawIngredient) {
                doc.rawIngredient = entry.rawIngredient;
                doc.rawRulesVersion = entry.rawRulesVersion ?? RAW_RULES_VERSION;
            }
            // MERGE, unlike the backfill's full `set`. This module knows only
            // its own handful of fields; a plain `set` would delete the
            // backfill's `nnCategory` / `nnScore` / `usageCount` /
            // `recipeCount` from any doc that already had them. That happens
            // for real: a doc whose stored category failed enum validation on
            // read counts as a miss, gets reclassified here, and would be
            // stripped on write-through.
            batch.set(
                db.collection(DB_COLLECTION_INGREDIENT_CATEGORIES).doc(entry.docId),
                doc,
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
