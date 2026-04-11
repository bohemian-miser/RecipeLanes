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
 * Backfill HyDE searchTerms for ingredients_new docs whose best icon lacks them.
 *
 * For each ingredients_new doc:
 *   - Pick the "best" icon (highest score, or first).
 *   - If that icon already has searchTerms, skip (unless --force).
 *   - Otherwise: call Gemini via the HyDE prompt, write the 12 terms back.
 *
 * Coverage report printed at end: how many docs already had terms vs needed backfill.
 *
 * Usage:
 *   npx tsx scripts/backfill-search-terms.ts --staging --dry-run [--limit 100] [--force]
 *   npx tsx scripts/backfill-search-terms.ts --staging [--limit 100]
 */

import dotenv from 'dotenv';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const USE_STAGING = args.includes('--staging');
const FORCE = args.includes('--force');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 500;
const DELAY_MS = 300; // ms between Gemini calls to avoid quota errors

if (USE_STAGING) {
  console.log('[backfill-search-terms] Loading .env.staging...');
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  dotenv.config({ path: '.env.staging', override: true });
} else {
  dotenv.config();
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function callGeminiText(prompt: string): Promise<string> {
  // Use the Vertex AI REST API directly (same credentials as Firestore)
  const { GoogleAuth } = await import('google-auth-library');
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'recipe-lanes-staging';
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const tokenResult = await (client as any).getAccessToken();
  const token: string = tokenResult.token ?? tokenResult;

  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json() as any;
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function main() {
  const { db } = await import('../lib/firebase-admin');
  const { generateHydeQueriesPrompt, parseHydeQueries } = await import('../lib/recipe-lanes/parser');

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '(unknown)';
  console.log(`[backfill-search-terms] project=${projectId}  dry_run=${DRY_RUN}  limit=${LIMIT}  force=${FORCE}`);

  // Fetch ingredients_new docs (paginate if needed)
  const snapshot = await db.collection('ingredients_new').limit(LIMIT).get();
  console.log(`[backfill-search-terms] Fetched ${snapshot.docs.length} ingredients_new docs`);

  // Coverage stats
  let alreadyHaveTerms = 0;
  let needsBackfill = 0;
  let noIcons = 0;

  type WorkItem = {
    docId: string;
    ingredientName: string;
    icons: any[];
    bestIconIdx: number;
  };
  const workItems: WorkItem[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const icons: any[] = data.icons ?? [];
    if (icons.length === 0) {
      noIcons++;
      continue;
    }

    // Pick best icon by score, fallback to first
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < icons.length; i++) {
      const s = icons[i].score ?? 0;
      if (s > bestScore) { bestScore = s; bestIdx = i; }
    }

    const best = icons[bestIdx];
    const hasTerms = Array.isArray(best.searchTerms) && best.searchTerms.length > 0;

    if (hasTerms && !FORCE) {
      alreadyHaveTerms++;
      continue;
    }

    needsBackfill++;
    const ingredientName: string = data.name ?? doc.id;
    workItems.push({ docId: doc.id, ingredientName, icons, bestIconIdx: bestIdx });
  }

  console.log(`\n[backfill-search-terms] Coverage report:`);
  console.log(`  Docs with icons + searchTerms : ${alreadyHaveTerms}`);
  console.log(`  Docs needing backfill          : ${needsBackfill}`);
  console.log(`  Docs with no icons             : ${noIcons}`);
  console.log(`  Total fetched                  : ${snapshot.docs.length}`);

  if (needsBackfill === 0) {
    console.log('\n[backfill-search-terms] All docs already have searchTerms. Nothing to do.');
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log(`\n[backfill-search-terms] DRY RUN — first 10 that would be backfilled:`);
    for (const item of workItems.slice(0, 10)) {
      console.log(`  ${item.docId}  name="${item.ingredientName}"`);
    }
    console.log('\n[backfill-search-terms] DRY RUN complete. Re-run without --dry-run to apply.');
    process.exit(0);
  }

  let wrote = 0;
  let errors = 0;

  for (let i = 0; i < workItems.length; i++) {
    const { docId, ingredientName, icons, bestIconIdx } = workItems[i];

    try {
      const prompt = generateHydeQueriesPrompt(ingredientName, 'ingredient');
      const raw = await callGeminiText(prompt);
      const terms = parseHydeQueries(raw);

      if (terms.length === 0) {
        console.warn(`[backfill-search-terms] Warning: no terms parsed for "${ingredientName}" — raw: ${raw.slice(0, 100)}`);
        errors++;
      } else {
        const newSearchTerms = terms.map(text => ({
          text,
          source: 'hyde_from_img' as const,
          addedAt: Date.now(),
        }));

        // Clone icons array and update the best icon
        const updatedIcons = icons.map((icon: any, idx: number) => {
          if (idx !== bestIconIdx) return icon;
          return { ...icon, searchTerms: newSearchTerms };
        });

        await db.collection('ingredients_new').doc(docId).update({ icons: updatedIcons });
        wrote++;
      }
    } catch (e: any) {
      console.error(`\n[backfill-search-terms] Error for "${ingredientName}": ${e.message}`);
      errors++;
    }

    if (i % 10 === 0) process.stdout.write(`\r[backfill-search-terms] ${i + 1}/${workItems.length} (wrote=${wrote}, errors=${errors})  `);
    if (DELAY_MS > 0) await sleep(DELAY_MS);
  }

  console.log(`\n\n[backfill-search-terms] Done. wrote=${wrote}, errors=${errors}`);
  process.exit(0);
}

main().catch(e => {
  console.error('[backfill-search-terms] Fatal error:', e);
  process.exit(1);
});
