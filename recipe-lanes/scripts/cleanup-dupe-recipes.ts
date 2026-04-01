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
 * Cleanup duplicate recipes on staging.
 *
 * Duplicates: same ownerId + same graph.title.
 * Keep: the most recently created doc (by createdAt, then doc ID as tiebreaker).
 * Delete: all others in each group.
 *
 * Usage:
 *   npx tsx scripts/cleanup-dupe-recipes.ts --staging --dry-run
 *   npx tsx scripts/cleanup-dupe-recipes.ts --staging
 */

import dotenv from 'dotenv';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const USE_STAGING = args.includes('--staging');

if (USE_STAGING) {
  console.log('[cleanup] Switching to STAGING environment (.env.staging)...');
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  dotenv.config({ path: '.env.staging', override: true });
} else {
  dotenv.config();
}

async function main() {
  const { db } = await import('../lib/firebase-admin');

  console.log(`[cleanup] Starting duplicate recipe cleanup. dry_run=${DRY_RUN}, staging=${USE_STAGING}`);

  const snapshot = await db.collection('recipes').get();
  console.log(`[cleanup] Total recipes fetched: ${snapshot.docs.length}`);

  // Group by ownerId + graph.title
  type DocInfo = { id: string; createdAt: Date };
  const groups = new Map<string, DocInfo[]>();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const ownerId: string = data.ownerId ?? '';
    const graphTitle: string = (data.graph?.title ?? '').trim();

    if (!graphTitle) continue; // skip docs with no graph title — can't determine duplicates

    const key = `${ownerId}||${graphTitle}`;
    const existing = groups.get(key) ?? [];

    // created_at is a Firestore Timestamp; fall back to epoch so it always loses to a real value
    let createdAt: Date;
    const raw = data.created_at ?? data.createdAt;
    if (raw?.toDate) {
      createdAt = raw.toDate();
    } else if (raw instanceof Date) {
      createdAt = raw;
    } else {
      createdAt = new Date(0);
    }

    existing.push({ id: doc.id, createdAt });
    groups.set(key, existing);
  }

  // Find groups with duplicates
  let totalGroups = 0;
  let totalDuplicates = 0;
  const toDelete: string[] = [];

  for (const [key, docs] of groups) {
    if (docs.length <= 1) continue;
    totalGroups++;

    // Sort newest first: descending createdAt, then descending doc ID as tiebreaker
    docs.sort((a, b) => {
      const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.id.localeCompare(a.id);
    });

    const [keep, ...dupes] = docs;
    const [ownerId, graphTitle] = key.split('||');

    console.log(`\n[cleanup] Duplicate group: ownerId="${ownerId}" title="${graphTitle}"`);
    console.log(`  KEEP  ${keep.id} (createdAt: ${keep.createdAt.toISOString()})`);
    for (const dupe of dupes) {
      console.log(`  ${DRY_RUN ? 'WOULD DELETE' : 'DELETE'} ${dupe.id} (createdAt: ${dupe.createdAt.toISOString()})`);
      toDelete.push(dupe.id);
    }
    totalDuplicates += dupes.length;
  }

  console.log(`\n[cleanup] Summary:`);
  console.log(`  Duplicate groups found : ${totalGroups}`);
  console.log(`  Docs to delete         : ${totalDuplicates}`);

  if (DRY_RUN) {
    console.log('\n[cleanup] DRY RUN — no writes performed. Re-run without --dry-run to delete.');
    process.exit(0);
  }

  if (toDelete.length === 0) {
    console.log('[cleanup] Nothing to delete. Exiting.');
    process.exit(0);
  }

  // Delete in Firestore batches (max 500 ops per batch)
  const BATCH_SIZE = 400;
  let deleted = 0;

  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const chunk = toDelete.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const id of chunk) {
      batch.delete(db.collection('recipes').doc(id));
    }
    await batch.commit();
    deleted += chunk.length;
    console.log(`[cleanup] Deleted ${deleted}/${toDelete.length}...`);
  }

  console.log(`\n[cleanup] Done. Deleted ${deleted} duplicate recipe(s).`);
  process.exit(0);
}

main().catch(e => {
  console.error('[cleanup] Fatal error:', e);
  process.exit(1);
});
