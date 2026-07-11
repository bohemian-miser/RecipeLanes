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
 * Verb classifier for the "Notation" layout preset (issue: notation layout).
 *
 * Pure, client-side keyword matcher: classifies an action's text into one of a
 * small closed set of cooking verbs, each with an emoji glyph drawn inline on
 * the station "spine" line. No schema/parser changes — this runs purely off
 * `RecipeNode.text` at render time.
 *
 * Table order is the match priority: the FIRST entry (in table order) whose
 * keyword regex matches anywhere in the text wins. Returns null if nothing
 * matches (renders as a 'state' node instead of a 'verb' node).
 */

export interface VerbClassification {
  verb: string;
  glyph: string;
}

interface VerbEntry {
  verb: string;
  glyph: string;
  /** Word stems matched with \b...\b, case-insensitive. */
  keywords: string[];
}

// Table order == priority order. Keep in sync with the mockup's "vocabulary" section.
const VERB_TABLE: VerbEntry[] = [
  { verb: 'chop', glyph: '🔪', keywords: ['chop', 'slice', 'dice', 'cut', 'mince'] },
  { verb: 'stir', glyph: '🌀', keywords: ['stir', 'toss', 'mix', 'whisk'] },
  { verb: 'heat', glyph: '🔥', keywords: ['heat', 'fry', 'sear', 'saut[eé]', 'brown'] },
  { verb: 'simmer', glyph: '♨️', keywords: ['simmer'] },
  { verb: 'boil', glyph: '🫧', keywords: ['boil'] },
  { verb: 'drain', glyph: '🫗', keywords: ['drain', 'strain', 'pour off'] },
  { verb: 'season', glyph: '🧂', keywords: ['season', 'salt', 'pepper'] },
  { verb: 'rest', glyph: '⏲️', keywords: ['rest', 'wait', 'cool', 'chill'] },
  { verb: 'fold', glyph: '🥄', keywords: ['fold', 'combine', 'gently'] },
  { verb: 'crush', glyph: '🔨', keywords: ['crush', 'pound', 'smash'] },
  { verb: 'bake', glyph: '🔳', keywords: ['bake', 'roast', 'oven'] },
  { verb: 'serve', glyph: '🍽️', keywords: ['serve', 'plate', 'divide'] },
];

// Build one regex per entry, keywords joined with |, wrapped in boundaries.
// "pour off" contains a space, so the phrase boundary still works.
//
// Plain \b is ASCII-only: it does not treat accented letters (e.g. the "é" in
// "sauté") as word characters, so a trailing \b right after "é" fails to match
// (both sides of the boundary would be non-word). Use an explicit lookaround
// instead so accented keywords match correctly.
const WORD_BEFORE = '(?:^|[^a-zA-Z0-9_])';
const WORD_AFTER = '(?![a-zA-Z0-9_])';
const COMPILED = VERB_TABLE.map(entry => ({
  ...entry,
  regex: new RegExp(`${WORD_BEFORE}(?:${entry.keywords.join('|')})${WORD_AFTER}`, 'i'),
}));

/**
 * Classify an action's text into a verb+glyph pair, or null if no keyword matches.
 */
export function classifyVerb(text: string): VerbClassification | null {
  if (!text) return null;
  for (const entry of COMPILED) {
    if (entry.regex.test(text)) {
      return { verb: entry.verb, glyph: entry.glyph };
    }
  }
  return null;
}
