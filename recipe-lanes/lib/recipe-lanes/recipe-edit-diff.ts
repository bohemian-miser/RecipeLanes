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

import { MAX_ADJUST_INSTRUCTION_CHARS } from './limits';

/**
 * Issue #156 — Forge-on-existing-recipe routes through the AI *adjust* path
 * (incremental, node positions preserved) instead of a full re-parse. The
 * adjust API takes a short free-text INSTRUCTION, not a whole recipe document,
 * so we translate "the source text was edited from A to B" into a concise
 * instruction by computing a simple line-level diff.
 *
 * The diff is a multiset difference over trimmed non-empty lines, preserving
 * order and duplicates:
 *   - removed  = lines present in `baseline` but not consumed by `edited`
 *   - added    = lines present in `edited` but not consumed by `baseline`
 * Pure reordering therefore reads as "no change" — an accepted limitation of a
 * line-level diff (it doesn't alter the ingredient/step set the graph models).
 */

function toLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export interface RecipeLineDiff {
  removed: string[];
  added: string[];
}

/** Multiset line diff, order-preserving. */
export function diffRecipeLines(baseline: string, edited: string): RecipeLineDiff {
  const baseLines = toLines(baseline);
  const editLines = toLines(edited);

  const countOf = (lines: string[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };

  const baseRemaining = countOf(baseLines);
  const added = editLines.filter((l) => {
    const n = baseRemaining.get(l) ?? 0;
    if (n > 0) {
      baseRemaining.set(l, n - 1);
      return false; // matched an existing line — not an addition
    }
    return true;
  });

  const editRemaining = countOf(editLines);
  const removed = baseLines.filter((l) => {
    const n = editRemaining.get(l) ?? 0;
    if (n > 0) {
      editRemaining.set(l, n - 1);
      return false;
    }
    return true;
  });

  return { removed, added };
}

// Shared framing for both instruction shapes. Two things it must get right,
// because the earlier "Removed lines / Added lines"-only instruction got them
// wrong on the owner's burger test (#231 review): (1) apply the *delta*, not
// make the graph literally equal a short description — otherwise a burger graph
// asked to "match: a simple burger recipe with pineapple" could be gutted; and
// (2) a contents edit is NOT a title rename — the model previously read
// "a simple burger recipe" -> "... with pineapple" as an `updateTitle` and
// added no pineapple at all.
const RECONCILE_INTRO =
  "The user edited this recipe's source text and pressed Forge. Apply the " +
  'DIFFERENCE between the previous and new text to the current graph: add, ' +
  'remove, or modify only the ingredients and steps that actually changed ' +
  'between the two versions, and keep every unchanged node with its existing ' +
  "ID and position. This is an edit to the recipe's contents (its ingredients " +
  'and steps) — do NOT treat it as a title rename.';

/**
 * RICH form: hand the model the full previous + new text and let IT compute the
 * delta. Far more reliable than a pre-digested line diff for short natural-
 * language descriptions — a line diff of "a simple burger recipe" ->
 * "a simple burger recipe with pineapple" reads as a whole-line replacement
 * (i.e. a rename) rather than "add pineapple".
 */
function buildRichInstruction(baseline: string, edited: string): string {
  return [
    RECONCILE_INTRO,
    'Previous recipe text:\n"""\n' + baseline.trim() + '\n"""',
    'New recipe text:\n"""\n' + edited.trim() + '\n"""',
  ].join('\n\n');
}

/**
 * CONCISE form: a "Removed lines / Added lines" digest. Fallback for long
 * recipes whose full before/after would blow the instruction cap but whose
 * individual edited lines are already unambiguous ingredient/step lines.
 */
function buildConciseInstruction(diff: RecipeLineDiff): string {
  const parts: string[] = [RECONCILE_INTRO];
  if (diff.removed.length > 0) {
    parts.push('Removed lines:\n' + diff.removed.map((l) => `- ${l}`).join('\n'));
  }
  if (diff.added.length > 0) {
    parts.push('Added lines:\n' + diff.added.map((l) => `- ${l}`).join('\n'));
  }
  return parts.join('\n\n');
}

/**
 * Build a short AI-adjust instruction from the difference between the last-saved
 * recipe text (`baseline`) and the currently edited text (`edited`).
 *
 * Returns `null` when no line-level change is detected (caller should treat the
 * Forge as a no-op rather than regenerate and disturb node positions).
 *
 * Prefers the RICH form (full before/after) whenever it fits `maxChars`, since
 * the model diffs the two versions far more reliably than a line-level digest —
 * this is what fixes the reported "edit adds nothing / renames the title" bug.
 * Falls back to the CONCISE digest for long recipes. If even the concise form
 * exceeds `maxChars`, the caller falls through to a full re-parse (a positions
 * reset is acceptable for a major rewrite).
 */
export function buildRecipeEditInstruction(
  baseline: string,
  edited: string,
  maxChars: number = MAX_ADJUST_INSTRUCTION_CHARS,
): string | null {
  const diff = diffRecipeLines(baseline, edited);
  if (diff.removed.length === 0 && diff.added.length === 0) return null;

  const rich = buildRichInstruction(baseline, edited);
  if (rich.length <= maxChars) return rich;

  return buildConciseInstruction(diff);
}
