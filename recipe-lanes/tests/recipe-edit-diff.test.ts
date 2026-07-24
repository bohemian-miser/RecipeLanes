import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { diffRecipeLines, buildRecipeEditInstruction } from '../lib/recipe-lanes/recipe-edit-diff';
import { MAX_ADJUST_INSTRUCTION_CHARS } from '../lib/recipe-lanes/limits';

// Issue #156 — Forge-on-existing routes through the adjust API. These tests
// lock the pure diff→instruction translation that drives that branch: what
// counts as "no change" (no-op), what a small edit produces (adjust path), and
// what a large rewrite produces (over the cap → full-parse fallback).

describe('diffRecipeLines', () => {
  it('reports no change for identical text (ignoring blank lines / whitespace)', () => {
    const base = 'Flour\nWater\n\n  Salt  ';
    const edited = 'Flour\nWater\nSalt';
    assert.deepEqual(diffRecipeLines(base, edited), { removed: [], added: [] });
  });

  it('detects an added line', () => {
    const d = diffRecipeLines('Flour\nWater', 'Flour\nWater\nSugar');
    assert.deepEqual(d, { removed: [], added: ['Sugar'] });
  });

  it('detects a removed line', () => {
    const d = diffRecipeLines('Flour\nWater\nSugar', 'Flour\nWater');
    assert.deepEqual(d, { removed: ['Sugar'], added: [] });
  });

  it('detects a changed line as remove + add', () => {
    const d = diffRecipeLines('Flour\n1 cup water', 'Flour\n2 cups water');
    assert.deepEqual(d, { removed: ['1 cup water'], added: ['2 cups water'] });
  });

  it('treats pure reordering as no change (line-level limitation)', () => {
    const d = diffRecipeLines('Flour\nWater\nSalt', 'Salt\nFlour\nWater');
    assert.deepEqual(d, { removed: [], added: [] });
  });

  it('preserves duplicates via multiset semantics', () => {
    const d = diffRecipeLines('Egg\nEgg', 'Egg\nEgg\nEgg');
    assert.deepEqual(d, { removed: [], added: ['Egg'] });
  });
});

describe('buildRecipeEditInstruction', () => {
  it('returns null when nothing changed (Forge is a no-op)', () => {
    assert.equal(buildRecipeEditInstruction('Flour\nWater', 'Flour\nWater'), null);
  });

  it('prefers the RICH before/after form for a small edit (model computes the delta)', () => {
    const instr = buildRecipeEditInstruction('Flour\n1 cup water', 'Flour\n2 cups water');
    assert.ok(instr, 'expected a non-null instruction');
    // Both full versions are handed to the model so it can diff them itself —
    // this is what stops a "with pineapple"-style edit reading as a title rename.
    assert.match(instr!, /Previous recipe text:\n"""\nFlour\n1 cup water\n"""/);
    assert.match(instr!, /New recipe text:\n"""\nFlour\n2 cups water\n"""/);
    assert.match(instr!, /do NOT treat it as a title rename/);
    // The rich form does NOT rely on a misleading line digest.
    assert.doesNotMatch(instr!, /Added lines:/);
    assert.ok(instr!.length <= MAX_ADJUST_INSTRUCTION_CHARS, 'small edit must fit the adjust cap');
  });

  it('appending a description phrase keeps both versions (the burger/pineapple case)', () => {
    const instr = buildRecipeEditInstruction('a simple burger recipe', 'a simple burger recipe with pineapple');
    assert.ok(instr, 'expected a non-null instruction');
    assert.match(instr!, /Previous recipe text:\n"""\na simple burger recipe\n"""/);
    assert.match(instr!, /New recipe text:\n"""\na simple burger recipe with pineapple\n"""/);
  });

  it('falls back to the CONCISE line digest when the full before/after would blow the cap', () => {
    // A long recipe (over the cap) with a single small edit: the rich form is too
    // big, so we send the concise "Added/Removed lines" digest, which stays small.
    const baseline = Array.from({ length: 120 }, (_, i) => `Step ${i}: do a fairly detailed cooking thing here`).join('\n');
    const edited = baseline + '\nStir in 100g of sugar';
    const instr = buildRecipeEditInstruction(baseline, edited);
    assert.ok(instr, 'expected a non-null instruction');
    assert.match(instr!, /Added lines:\n- Stir in 100g of sugar/);
    assert.doesNotMatch(instr!, /New recipe text:/);
    assert.ok(instr!.length <= MAX_ADJUST_INSTRUCTION_CHARS, 'concise digest of a small edit must fit the cap');
  });

  it('a whole-recipe rewrite exceeds the adjust cap (drives the full-parse fallback)', () => {
    const baseline = 'Flour\nWater';
    // A brand-new large body of text: every line is an addition + both baseline
    // lines removed, blowing well past MAX_ADJUST_INSTRUCTION_CHARS even as a
    // concise digest.
    const edited = Array.from({ length: 400 }, (_, i) => `Step ${i}: do a fairly detailed cooking thing`).join('\n');
    const instr = buildRecipeEditInstruction(baseline, edited);
    assert.ok(instr, 'expected a non-null instruction');
    assert.ok(
      instr!.length > MAX_ADJUST_INSTRUCTION_CHARS,
      'a large rewrite must exceed the cap so handleVisualize falls back to a full re-parse',
    );
  });
});
