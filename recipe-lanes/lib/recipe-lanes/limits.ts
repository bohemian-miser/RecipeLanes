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
 * Abuse / cost guardrails for the LLM recipe pipeline (issue #181).
 *
 * Two distinct dangers these caps defend against:
 *  1. Oversized *input* — large pasted text or a chatbot instruction that
 *     inflates the prompt token count (cost) sent TO the model.
 *  2. Oversized *output* — a graph that keeps growing (e.g. asking the
 *     chatbot to "keep adding nodes"), which bloats Firestore docs, the
 *     icon queue, and every subsequent adjustment prompt sent back to the
 *     model.
 *
 * These are static, conservative ceilings — a real recipe never approaches
 * them. They are not user-tunable on purpose; they are a safety floor.
 */

/** Max characters of raw recipe text accepted for a single parse. */
export const MAX_RECIPE_INPUT_CHARS = 10_000;

/** Max characters of a single chatbot adjustment instruction. */
export const MAX_ADJUST_INSTRUCTION_CHARS = 2_000;

/**
 * Max size (bytes) of a recipe photo accepted for a single parse (issue #182).
 * Measured on the decoded image bytes, not the base64 string. Vertex/Gemini
 * caps inline image data at ~7MB per request; we sit conservatively under that
 * to leave headroom for the prompt text.
 */
export const MAX_RECIPE_IMAGE_BYTES = 5 * 1024 * 1024;

/** Max nodes allowed in a recipe graph after a parse or adjustment. */
export const MAX_GRAPH_NODES = 150;

/** Max lanes allowed in a recipe graph. */
export const MAX_GRAPH_LANES = 30;

export class RecipeLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecipeLimitError';
  }
}

/** Throws RecipeLimitError if `text` exceeds `max` chars. `label` names the input for the message. */
export function assertInputWithinLimit(text: string, max: number, label: string): void {
  const len = text?.length ?? 0;
  if (len > max) {
    throw new RecipeLimitError(
      `${label} is too long (${len.toLocaleString()} characters; limit is ${max.toLocaleString()}). Please shorten it.`,
    );
  }
}

/** Throws RecipeLimitError if the decoded image exceeds the byte ceiling. */
export function assertImageWithinLimit(byteLength: number, max: number = MAX_RECIPE_IMAGE_BYTES): void {
  if (byteLength > max) {
    const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)}MB`;
    throw new RecipeLimitError(
      `That photo is too large (${mb(byteLength)}; limit is ${mb(max)}). Please use a smaller image.`,
    );
  }
}

/** Throws RecipeLimitError if the graph exceeds the node or lane ceilings. */
export function assertGraphWithinLimit(graph: { nodes?: unknown[]; lanes?: unknown[] }): void {
  const nodeCount = graph.nodes?.length ?? 0;
  if (nodeCount > MAX_GRAPH_NODES) {
    throw new RecipeLimitError(
      `This recipe is too large (${nodeCount} steps; limit is ${MAX_GRAPH_NODES}). Try splitting it into smaller recipes.`,
    );
  }
  const laneCount = graph.lanes?.length ?? 0;
  if (laneCount > MAX_GRAPH_LANES) {
    throw new RecipeLimitError(
      `This recipe has too many lanes (${laneCount}; limit is ${MAX_GRAPH_LANES}).`,
    );
  }
}
