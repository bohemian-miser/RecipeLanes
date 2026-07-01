import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertInputWithinLimit,
  assertGraphWithinLimit,
  assertImageWithinLimit,
  RecipeLimitError,
  MAX_RECIPE_INPUT_CHARS,
  MAX_ADJUST_INSTRUCTION_CHARS,
  MAX_GRAPH_NODES,
  MAX_GRAPH_LANES,
  MAX_RECIPE_IMAGE_BYTES,
} from '../lib/recipe-lanes/limits';

describe('recipe limits (issue #181)', () => {
  describe('assertInputWithinLimit', () => {
    it('accepts input at the limit', () => {
      assert.doesNotThrow(() =>
        assertInputWithinLimit('x'.repeat(MAX_RECIPE_INPUT_CHARS), MAX_RECIPE_INPUT_CHARS, 'Recipe text'),
      );
    });

    it('rejects input over the limit with a RecipeLimitError', () => {
      assert.throws(
        () => assertInputWithinLimit('x'.repeat(MAX_RECIPE_INPUT_CHARS + 1), MAX_RECIPE_INPUT_CHARS, 'Recipe text'),
        RecipeLimitError,
      );
    });

    it('handles empty / nullish input', () => {
      assert.doesNotThrow(() => assertInputWithinLimit('', MAX_ADJUST_INSTRUCTION_CHARS, 'Instruction'));
      assert.doesNotThrow(() =>
        assertInputWithinLimit(undefined as unknown as string, MAX_ADJUST_INSTRUCTION_CHARS, 'Instruction'),
      );
    });
  });

  describe('assertGraphWithinLimit', () => {
    const nodes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `n${i}` }));
    const lanes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `l${i}` }));

    it('accepts a graph at the node limit', () => {
      assert.doesNotThrow(() => assertGraphWithinLimit({ nodes: nodes(MAX_GRAPH_NODES), lanes: lanes(1) }));
    });

    it('rejects a graph over the node limit', () => {
      assert.throws(
        () => assertGraphWithinLimit({ nodes: nodes(MAX_GRAPH_NODES + 1), lanes: lanes(1) }),
        RecipeLimitError,
      );
    });

    it('rejects a graph over the lane limit', () => {
      assert.throws(
        () => assertGraphWithinLimit({ nodes: nodes(1), lanes: lanes(MAX_GRAPH_LANES + 1) }),
        RecipeLimitError,
      );
    });

    it('tolerates a graph missing nodes/lanes arrays', () => {
      assert.doesNotThrow(() => assertGraphWithinLimit({}));
    });
  });

  describe('assertImageWithinLimit (issue #182)', () => {
    it('accepts an image at the byte limit', () => {
      assert.doesNotThrow(() => assertImageWithinLimit(MAX_RECIPE_IMAGE_BYTES));
    });

    it('rejects an image over the byte limit with a RecipeLimitError', () => {
      assert.throws(() => assertImageWithinLimit(MAX_RECIPE_IMAGE_BYTES + 1), RecipeLimitError);
    });
  });
});
