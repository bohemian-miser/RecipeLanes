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

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLANK_DRAFT_KEY,
  draftKey,
  loadDraft,
  saveDraft,
  commitDraftOnForge,
  clearBlankDraft,
  type DraftStorage,
} from '../lib/recipe-lanes/draft-persistence';

// Minimal in-memory Storage stand-in for the browser localStorage.
function makeStorage(): DraftStorage & { dump(): Record<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

describe('draft-persistence keys', () => {
  it('uses the blank key when there is no recipe id', () => {
    assert.equal(draftKey(null), BLANK_DRAFT_KEY);
    assert.equal(draftKey(undefined), BLANK_DRAFT_KEY);
    assert.equal(draftKey(''), BLANK_DRAFT_KEY);
  });

  it('keys under the recipe id when present', () => {
    assert.equal(draftKey('abc123'), 'recipe_draft_abc123');
  });
});

describe('editing a new (blank) page', () => {
  let storage: ReturnType<typeof makeStorage>;
  beforeEach(() => { storage = makeStorage(); });

  it('saves typed text under the blank key so a refresh restores it', () => {
    // User types on a fresh /lanes page (no id).
    saveDraft(storage, null, 'two eggs, flour');
    // Simulate refresh: a new mount reads the blank draft back.
    assert.equal(loadDraft(storage, null), 'two eggs, flour');
  });

  it('does not overwrite a stored draft with an empty (stale) render', () => {
    saveDraft(storage, null, 'good draft');
    saveDraft(storage, null, ''); // empty is a no-op
    assert.equal(loadDraft(storage, null), 'good draft');
  });

  it('returns empty string when nothing is stored', () => {
    assert.equal(loadDraft(storage, null), '');
    assert.equal(loadDraft(storage, 'nope'), '');
  });
});

describe('forging a recipe', () => {
  let storage: ReturnType<typeof makeStorage>;
  beforeEach(() => { storage = makeStorage(); });

  it('moves the text to the new url key and clears the blank draft', () => {
    // Typed on the blank page, then forged into recipe "r1".
    saveDraft(storage, null, 'two eggs, flour');
    commitDraftOnForge(storage, 'r1', 'two eggs, flour');

    // Text now lives under the new recipe's key...
    assert.equal(loadDraft(storage, 'r1'), 'two eggs, flour');
    // ...and the blank draft is gone.
    assert.equal(storage.getItem(BLANK_DRAFT_KEY), null);
  });

  it('leaves a fresh tab (no id) blank after a forge', () => {
    saveDraft(storage, null, 'two eggs, flour');
    commitDraftOnForge(storage, 'r1', 'two eggs, flour');

    // Opening a brand new /lanes tab restores nothing.
    assert.equal(loadDraft(storage, null), '');
  });

  it('still restores the forged recipe when you reopen its url', () => {
    commitDraftOnForge(storage, 'r1', 'two eggs, flour');
    assert.equal(loadDraft(storage, 'r1'), 'two eggs, flour');
  });
});

describe('explicit New action', () => {
  it('clears the blank draft', () => {
    const storage = makeStorage();
    saveDraft(storage, null, 'leftover text');
    clearBlankDraft(storage);
    assert.equal(loadDraft(storage, null), '');
  });

  it('does not touch per-recipe drafts', () => {
    const storage = makeStorage();
    saveDraft(storage, 'r1', 'kept');
    saveDraft(storage, null, 'blank');
    clearBlankDraft(storage);
    assert.equal(loadDraft(storage, 'r1'), 'kept');
    assert.equal(loadDraft(storage, null), '');
  });
});
