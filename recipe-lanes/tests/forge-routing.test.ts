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

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveForgeAction } from '../lib/recipe-lanes/forge-routing';

describe('resolveForgeAction (issue #156)', () => {
  it('creates a new recipe when none exists yet', () => {
    // Fresh /lanes page: pasted text, no graph loaded. isOwner is true for an
    // unsaved recipe but there is nothing to adjust yet.
    assert.equal(
      resolveForgeAction({ recipeText: 'two eggs, flour', hasExistingRecipe: false, isOwner: true }),
      'create',
    );
  });

  it('adjusts when the OWNER re-forges their own existing recipe', () => {
    // The core of #156: re-forging your own already-forged recipe must route
    // through the incremental adjust path, not spawn a brand-new recipe.
    assert.equal(
      resolveForgeAction({ recipeText: 'two eggs, flour, add garlic', hasExistingRecipe: true, isOwner: true }),
      'adjust',
    );
  });

  it('creates/forks (never adjusts) when a NON-owner forges a shared recipe', () => {
    // A non-owner viewing someone else's recipe must fork a copy, not adjust a
    // recipe they don't own — even though a graph is loaded.
    assert.equal(
      resolveForgeAction({ recipeText: 'Bob Modification', hasExistingRecipe: true, isOwner: false }),
      'create',
    );
  });

  it('is a no-op when the input is empty', () => {
    assert.equal(resolveForgeAction({ recipeText: '', hasExistingRecipe: false, isOwner: true }), 'noop');
    assert.equal(resolveForgeAction({ recipeText: '', hasExistingRecipe: true, isOwner: true }), 'noop');
    assert.equal(resolveForgeAction({ recipeText: '', hasExistingRecipe: true, isOwner: false }), 'noop');
  });

  it('treats whitespace-only input as a no-op regardless of state', () => {
    assert.equal(resolveForgeAction({ recipeText: '   \n\t ', hasExistingRecipe: false, isOwner: true }), 'noop');
    assert.equal(resolveForgeAction({ recipeText: '   \n\t ', hasExistingRecipe: true, isOwner: true }), 'noop');
  });
});
