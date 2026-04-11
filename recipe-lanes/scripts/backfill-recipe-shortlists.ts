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
 * Backfill iconShortlist on recipe nodes.
 *
 * For every recipe doc, iterates graph.nodes.  Any node that has `icon` set
 * but no `iconShortlist` (or an empty array) gets:
 *   iconShortlist = [node.icon]
 *   shortlistIndex = 0
 *
 * Non-destructive: nodes that already have a non-empty iconShortlist are skipped.
 *
 * Usage:
 *   npx env-cmd -f .env.staging node --import tsx scripts/backfill-recipe-shortlists.ts --staging --dry-run
 *   npx env-cmd -f .env.staging node --import tsx scripts/backfill-recipe-shortlists.ts --staging
 */

import dotenv from 'dotenv';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const STAGING = args.includes('--staging');

// Load env vars before importing firebase-admin
if (STAGING) {
  console.log('[backfill] Loading .env.staging ...');
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  dotenv.config({ path: '.env.staging', override: true });
} else {
  dotenv.config();
}

const PAGE_SIZE = 200;   // docs per Firestore page
const MAX_BATCH = 490;   // ops per write batch (Firestore limit is 500)

async function main() {
  // Dynamic import so env is set before firebase-admin initialises
  const { db } = await import('../lib/firebase-admin');
  const { DB_COLLECTION_RECIPES } = await import('../lib/config');

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '(unknown)';
  console.log(`[backfill] project=${projectId}  dry_run=${DRY_RUN}  collection=${DB_COLLECTION_RECIPES}`);

  let recipesProcessed = 0;
  let nodesUpdated = 0;
  let nodesSkipped = 0;

  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let pageNum = 0;

  let batch = db.batch();
  let batchOps = 0;

  async function flushBatch() {
    if (batchOps === 0) return;
    if (!DRY_RUN) {
      await batch.commit();
    }
    batch = db.batch();
    batchOps = 0;
  }

  while (true) {
    pageNum++;
    let query = db.collection(DB_COLLECTION_RECIPES)
      .orderBy('__name__')
      .limit(PAGE_SIZE) as FirebaseFirestore.Query;

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snap = await query.get();
    if (snap.empty) break;

    console.log(`[backfill] Page ${pageNum}: fetched ${snap.docs.length} recipes`);

    for (const doc of snap.docs) {
      recipesProcessed++;
      const data = doc.data();
      const nodes: any[] = data?.graph?.nodes ?? [];

      if (nodes.length === 0) continue;

      let changed = false;
      const updatedNodes = nodes.map((node: any) => {
        // Must have an icon
        if (!node.icon || !node.icon.id) {
          nodesSkipped++;
          return node;
        }

        // Skip if already has a non-empty shortlist
        if (Array.isArray(node.iconShortlist) && node.iconShortlist.length > 0) {
          nodesSkipped++;
          return node;
        }

        // Needs backfill
        if (DRY_RUN) {
          console.log(`  [dry-run] recipe=${doc.id} node="${node.text ?? node.visualDescription ?? node.id}" icon=${node.icon.id}`);
        }
        nodesUpdated++;
        changed = true;
        return {
          ...node,
          iconShortlist: [node.icon],
          shortlistIndex: 0,
        };
      });

      if (!changed) continue;

      if (DRY_RUN) {
        // Count the op but don't actually batch
      } else {
        batch.update(doc.ref, { 'graph.nodes': updatedNodes });
        batchOps++;
      }

      if (batchOps >= MAX_BATCH) {
        await flushBatch();
        console.log(`[backfill] Committed batch (${recipesProcessed} recipes processed so far)`);
      }
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < PAGE_SIZE) break; // last page
  }

  await flushBatch();

  console.log('');
  console.log('[backfill] -----------------------------------------------');
  console.log(`[backfill] Done.`);
  console.log(`[backfill]   Recipes processed : ${recipesProcessed}`);
  console.log(`[backfill]   Nodes updated     : ${nodesUpdated}`);
  console.log(`[backfill]   Nodes skipped     : ${nodesSkipped}`);
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
