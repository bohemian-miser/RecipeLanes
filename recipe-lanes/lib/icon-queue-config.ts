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

// Typed accessor for the runtime icon-queue config document (`config/icon_queue`).
// This is the single source of truth used by server actions and the data layer.
// The Cloud Function package mirrors this read with the admin SDK directly
// (see functions/src/index.ts) but shares the defaults from ./config.

import { FieldValue } from 'firebase-admin/firestore';
import { db } from './firebase-admin';
import {
  DB_COLLECTION_CONFIG,
  ICON_QUEUE_CONFIG_DOC,
  IconQueueConfig,
  dayKey,
  withIconQueueConfigDefaults,
} from './config';

// Per-user daily forge usage counters.
// Strategy: a tiny counter doc keyed by `${uid}_${utcDay}` that we atomically
// increment at enqueue time. This is chosen over counting queue docs because
// queue docs are DELETED once processed (so a count would undercount real
// usage), and a collection-group count query would be O(queue size) on every
// forge. The counter is a single point read + one atomic increment, and the
// day-key in the doc id makes it self-expiring/cheap to reason about.
const DB_COLLECTION_FORGE_USAGE = 'icon_forge_usage';

function usageDocRef(uid: string, day: string = dayKey()) {
  return db.collection(DB_COLLECTION_FORGE_USAGE).doc(`${uid}_${day}`);
}

/** How many forges has this user enqueued so far today (UTC)? */
export async function getUserForgeCountToday(uid: string): Promise<number> {
  try {
    const snap = await usageDocRef(uid).get();
    const c = snap.data()?.count;
    return typeof c === 'number' ? c : 0;
  } catch (e) {
    console.warn('[icon-queue-config] usage read failed, assuming 0:', e);
    return 0;
  }
}

/** Atomically record one forge for this user today. */
export async function incrementUserForgeCount(uid: string, by: number = 1): Promise<void> {
  const day = dayKey();
  await usageDocRef(uid, day).set(
    { count: FieldValue.increment(by), uid, day, updated_at: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

function configDocRef() {
  return db.collection(DB_COLLECTION_CONFIG).doc(ICON_QUEUE_CONFIG_DOC);
}

/** Read the icon-queue config, applying safe defaults for a missing doc/field. */
export async function getIconQueueConfig(): Promise<IconQueueConfig> {
  try {
    const snap = await configDocRef().get();
    return withIconQueueConfigDefaults(snap.exists ? snap.data() : null);
  } catch (e) {
    console.warn('[icon-queue-config] read failed, using defaults:', e);
    return withIconQueueConfigDefaults(null);
  }
}

/**
 * Merge-write a partial update to the icon-queue config.
 * Only the provided fields are written; validation/clamping is applied so an
 * admin cannot persist a nonsensical value.
 */
export async function setIconQueueConfig(
  patch: Partial<IconQueueConfig>,
): Promise<IconQueueConfig> {
  const update: Partial<IconQueueConfig> = {};
  if (typeof patch.paused === 'boolean') update.paused = patch.paused;
  if (typeof patch.allowAnonForge === 'boolean') update.allowAnonForge = patch.allowAnonForge;
  if (typeof patch.perUserDailyCap === 'number' && Number.isFinite(patch.perUserDailyCap)) {
    // Clamp to a sane non-negative integer.
    update.perUserDailyCap = Math.max(0, Math.floor(patch.perUserDailyCap));
  }
  await configDocRef().set(update, { merge: true });
  return getIconQueueConfig();
}
