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
 * Backfill / normalise iconShortlist entries across all recipe documents.
 *
 * Three problems this script repairs:
 *
 *   (A) Bare IconStats in shortlist — entries stored as plain `{ id, url?, ... }`
 *       directly in the array instead of wrapped in `{ icon: IconStats, matchType }`.
 *       Caused by backfill-recipe-shortlists.ts writing `iconShortlist: [node.icon]`
 *       before the ShortlistEntry wrapper existed.
 *
 *   (B) Stale `url` field on icon — old `IconStats` objects stored a `url` string
 *       that is now derived on-demand.  Remove it so the model is canonical.
 *
 *   (C) Missing `visualDescription` on icon — needed so getNodeIconUrl can derive
 *       the correct storage path from the icon itself rather than the node.
 *       Derived from standardizeIngredientName(node.visualDescription || node.text).
 *
 * Usage:
 *   npx env-cmd -f .env.staging node --import tsx scripts/backfill-shortlist-entries.ts --staging --dry-run
 *   npx env-cmd -f .env.staging node --import tsx scripts/backfill-shortlist-entries.ts --staging
 */

import dotenv from 'dotenv';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const STAGING = args.includes('--staging');

if (STAGING) {
    console.log('[backfill] Loading .env.staging ...');
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    dotenv.config({ path: '.env.staging', override: true });
} else {
    dotenv.config();
}

const PAGE_SIZE = 200;
const MAX_BATCH = 490;

// ---------------------------------------------------------------------------
// Entry analysis helpers
// ---------------------------------------------------------------------------

type Problem = 'bare_icon_stats' | 'stale_url' | 'stale_prompt' | 'missing_visual_description';

interface EntryAnalysis {
    index: number;
    problems: Problem[];
    before: any;
    after: any;
}

/** Returns true when an entry is a bare IconStats (no .icon wrapper). */
function isBareIconStats(entry: any): boolean {
    return typeof entry?.id === 'string' && entry.icon === undefined;
}

/**
 * Derives the canonical visualDescription for an icon, in priority order:
 *   1. icon.prompt  — the old field name; set from ingredient_name at index time
 *   2. icon.url path — decode the kebab filename: "Foo-Bar-{shortId}.png" → "Foo Bar"
 *   3. nodeDesc     — last resort: standardized node description
 */
function resolveVisualDescription(icon: any, nodeDesc: string): string {
    if (icon.prompt) return icon.prompt as string;
    if (icon.url) {
        // Extract from URL: .../icons%2FFoo-Bar-{shortId}.png or .../icons/Foo-Bar-{shortId}.png
        const match = decodeURIComponent(icon.url).match(/icons\/(.+)-[0-9a-f-]{8,}\.(?:thumb\.)?png/i);
        if (match) return match[1].replace(/-/g, ' ');
    }
    return nodeDesc;
}

function analyseEntry(entry: any, nodeDesc: string): EntryAnalysis | null {
    const problems: Problem[] = [];

    if (isBareIconStats(entry)) {
        problems.push('bare_icon_stats');
    } else {
        if (entry?.icon?.url !== undefined) problems.push('stale_url');
        if (entry?.icon?.prompt !== undefined) problems.push('stale_prompt');
        if (!entry?.icon?.visualDescription) problems.push('missing_visual_description');
    }

    if (problems.length === 0) return null;

    // Build the corrected entry — strip url and prompt, set visualDescription
    if (isBareIconStats(entry)) {
        const vd = resolveVisualDescription(entry, nodeDesc);
        const { url: _u, prompt: _p, ...iconRest } = entry;
        return { index: -1, problems, before: entry, after: {
            icon: { ...iconRest, visualDescription: vd },
            matchType: 'search',
        }};
    } else {
        const icon = entry.icon ?? {};
        const vd = entry.icon?.visualDescription || resolveVisualDescription(icon, nodeDesc);
        const { url: _u, prompt: _p, ...iconRest } = icon;
        return { index: -1, problems, before: entry, after: {
            ...entry,
            icon: { ...iconRest, visualDescription: vd },
        }};
    }
}

function describeProblems(problems: Problem[]): string {
    return problems.map(p => ({
        bare_icon_stats: 'BARE (not wrapped)',
        stale_url: 'has url field',
        stale_prompt: 'has prompt field',
        missing_visual_description: 'missing visualDescription',
    }[p])).join(', ');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    const { db } = await import('../lib/firebase-admin');
    const { DB_COLLECTION_RECIPES } = await import('../lib/config');
    const { standardizeIngredientName } = await import('../lib/utils');

    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '(unknown)';
    console.log(`[backfill] project=${projectId}  dry_run=${DRY_RUN}  collection=${DB_COLLECTION_RECIPES}`);
    console.log('');

    let recipesScanned = 0;
    let recipesChanged = 0;
    let entriesFixed = 0;
    const problemCounts: Record<Problem, number> = {
        bare_icon_stats: 0,
        stale_url: 0,
        stale_prompt: 0,
        missing_visual_description: 0,
    };

    let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    let pageNum = 0;
    let batch = db.batch();
    let batchOps = 0;

    async function flushBatch() {
        if (batchOps === 0) return;
        if (!DRY_RUN) await batch.commit();
        batch = db.batch();
        batchOps = 0;
    }

    while (true) {
        pageNum++;
        let query: FirebaseFirestore.Query = db.collection(DB_COLLECTION_RECIPES)
            .orderBy('__name__')
            .limit(PAGE_SIZE);
        if (lastDoc) query = query.startAfter(lastDoc);

        const snap = await query.get();
        if (snap.empty) break;

        console.log(`[backfill] Page ${pageNum}: ${snap.docs.length} recipes`);

        for (const doc of snap.docs) {
            recipesScanned++;
            const data = doc.data();
            const nodes: any[] = data?.graph?.nodes ?? [];
            if (nodes.length === 0) continue;

            let recipeChanged = false;

            const updatedNodes = nodes.map((node: any) => {
                const shortlist: any[] = node.iconShortlist;
                if (!Array.isArray(shortlist) || shortlist.length === 0) return node;

                const nodeDesc = standardizeIngredientName(node.visualDescription || node.text || '');
                const analyses: Array<EntryAnalysis & { index: number }> = [];

                shortlist.forEach((entry, i) => {
                    const a = analyseEntry(entry, nodeDesc);
                    if (a) analyses.push({ ...a, index: i });
                });

                if (analyses.length === 0) return node;

                // Log findings
                const nodeLabel = node.visualDescription || node.text || node.id;
                if (DRY_RUN || analyses.length > 0) {
                    console.log(`  recipe=${doc.id}  node="${nodeLabel}"  (${analyses.length} entries need fixing)`);
                    for (const a of analyses) {
                        console.log(`    [${a.index}] ${describeProblems(a.problems)}`);
                        console.log(`         BEFORE: ${JSON.stringify(a.before)}`);
                        console.log(`         AFTER:  ${JSON.stringify(a.after)}`);
                    }
                }

                for (const a of analyses) {
                    entriesFixed++;
                    for (const p of a.problems) problemCounts[p]++;
                }

                recipeChanged = true;
                const updatedShortlist = shortlist.map((entry, i) => {
                    const a = analyses.find(x => x.index === i);
                    return a ? a.after : entry;
                });

                return { ...node, iconShortlist: updatedShortlist };
            });

            if (!recipeChanged) continue;

            recipesChanged++;

            if (!DRY_RUN) {
                batch.update(doc.ref, { 'graph.nodes': updatedNodes });
                batchOps++;
                if (batchOps >= MAX_BATCH) {
                    await flushBatch();
                    console.log(`[backfill] Committed batch (${recipesScanned} scanned so far)`);
                }
            }
        }

        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < PAGE_SIZE) break;
    }

    await flushBatch();

    console.log('');
    console.log('[backfill] -----------------------------------------------');
    console.log('[backfill] Done.');
    console.log(`[backfill]   Recipes scanned  : ${recipesScanned}`);
    console.log(`[backfill]   Recipes changed  : ${recipesChanged}`);
    console.log(`[backfill]   Entries fixed    : ${entriesFixed}`);
    console.log(`[backfill]     bare_icon_stats           : ${problemCounts.bare_icon_stats}`);
    console.log(`[backfill]     stale_url                 : ${problemCounts.stale_url}`);
    console.log(`[backfill]     stale_prompt              : ${problemCounts.stale_prompt}`);
    console.log(`[backfill]     missing_visual_description: ${problemCounts.missing_visual_description}`);
    if (DRY_RUN) {
        console.log('[backfill]   (DRY RUN — no writes made)');
    }
    console.log('[backfill] -----------------------------------------------');

    process.exit(0);
}

main().catch(e => {
    console.error('[backfill] Fatal error:', e);
    process.exit(1);
});
