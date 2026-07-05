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

/**
 * Build a short human-readable adjust instruction from the diff between the
 * last-saved recipe text (`baseline`) and the currently edited text (`edited`).
 *
 * Returns `null` when no line-level change is detected (caller should treat the
 * Forge as a no-op rather than regenerate and disturb node positions).
 */
export function buildRecipeEditInstruction(baseline: string, edited: string): string | null {
  const { removed, added } = diffRecipeLines(baseline, edited);
  if (removed.length === 0 && added.length === 0) return null;

  const parts: string[] = [
    'The recipe source text was edited. Reconcile the graph to match these edits, ' +
      'preserving unchanged steps and their existing node IDs and positions.',
  ];
  if (removed.length > 0) {
    parts.push('Removed lines:\n' + removed.map((l) => `- ${l}`).join('\n'));
  }
  if (added.length > 0) {
    parts.push('Added lines:\n' + added.map((l) => `- ${l}`).join('\n'));
  }
  return parts.join('\n\n');
}
