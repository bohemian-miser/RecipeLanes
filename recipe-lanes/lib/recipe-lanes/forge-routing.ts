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
 * What clicking the Forge/Visualize button should do (issue #156).
 *
 * The button is the single "commit my input" action, but its meaning depends on
 * whether a recipe already exists:
 *
 *  - No recipe yet          → `'create'`: full-parse the pasted text into a
 *    brand-new graph (`createVisualRecipeAction`).
 *  - Own recipe exists      → `'adjust'`: feed the edited text through the SAME
 *    incremental AI-adjustment path that chat uses (`adjustRecipeAction`), so
 *    re-forging UPDATES the current recipe from the diff instead of spawning a
 *    whole new one. The input/recipe text is left untouched.
 *  - Someone else's recipe  → `'create'`: a non-owner viewing a shared recipe
 *    must still fork/create a copy (the existing behaviour) — never adjust a
 *    recipe they don't own. Adjust is gated on ownership.
 *  - Blank input            → `'noop'`.
 *
 * Kept as a pure function so the routing decision can be unit-tested without a
 * browser or the store.
 */
export type ForgeAction = 'noop' | 'create' | 'adjust';

export function resolveForgeAction(input: {
  recipeText: string;
  hasExistingRecipe: boolean;
  isOwner: boolean;
}): ForgeAction {
  if (!input.recipeText.trim()) return 'noop';
  // Only the OWNER re-forging their OWN existing recipe adjusts in place;
  // everyone else (new recipe, or a non-owner on a shared recipe) creates/forks.
  return input.hasExistingRecipe && input.isOwner ? 'adjust' : 'create';
}
