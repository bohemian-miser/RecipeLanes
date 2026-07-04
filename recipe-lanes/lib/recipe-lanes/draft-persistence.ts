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
 * Recipe-input draft persistence rules (issue #183).
 *
 * The raw recipe textarea is persisted to localStorage so that a refresh does
 * not lose in-progress typing, WITHOUT the old bug where a fresh tab showed the
 * recipe you last forged:
 *
 *  - While editing a NEW (unsaved) recipe there is no `id` in the URL, so the
 *    draft is stored under BLANK_DRAFT_KEY. Refreshing the blank page restores
 *    it.
 *  - Once you forge, the pasted text has "moved" from the input box into the
 *    recipe itself (the diagram). `commitDraftOnForge` therefore DROPS the input
 *    draft entirely — both the new recipe's per-recipe key and the blank draft —
 *    so opening a fresh `/lanes` tab starts blank AND reopening the forged
 *    recipe shows an empty input box rather than the old pasted text (issue #156).
 *  - Loading an existing recipe (`?id=`) restores/saves any in-progress typing
 *    under that recipe's key (until it too is forged).
 *
 * These functions are pure over a minimal Storage-like interface so they can be
 * unit-tested without a browser.
 */

/** Minimal subset of the Web Storage API these helpers need. */
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Draft key for a new/blank (unsaved) recipe — no id in the URL. */
export const BLANK_DRAFT_KEY = 'recipe_draft';

/** Storage key for the draft belonging to a given recipe id (or the blank key). */
export function draftKey(id: string | null | undefined): string {
  return id ? `recipe_draft_${id}` : BLANK_DRAFT_KEY;
}

/**
 * Text to seed the textarea with on mount for the current recipe id (or blank
 * page when id is null). Returns '' when nothing is stored.
 */
export function loadDraft(storage: DraftStorage, id: string | null | undefined): string {
  return storage.getItem(draftKey(id)) ?? '';
}

/**
 * Persist the current textarea contents for the current recipe id (or blank
 * page). Empty text is a no-op — explicit clearing is done via the helpers
 * below so a stale-empty render can never wipe a good draft.
 */
export function saveDraft(storage: DraftStorage, id: string | null | undefined, text: string): void {
  if (text) {
    storage.setItem(draftKey(id), text);
  }
}

/**
 * Called right after a successful forge yields `newId`: the pasted text has
 * moved into the recipe, so drop the input draft entirely. Clears both the new
 * recipe's per-recipe draft (so reopening it shows an empty input box, not the
 * old pasted text — issue #156) and the blank draft (so a fresh `/lanes` tab is
 * blank — issue #183).
 */
export function commitDraftOnForge(storage: DraftStorage, newId: string): void {
  storage.removeItem(draftKey(newId));
  storage.removeItem(BLANK_DRAFT_KEY);
}

/** Clear the blank-page draft (used by the explicit "New" action). */
export function clearBlankDraft(storage: DraftStorage): void {
  storage.removeItem(BLANK_DRAFT_KEY);
}
