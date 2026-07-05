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

  it('builds a concise instruction for a small edit, within the adjust cap', () => {
    const instr = buildRecipeEditInstruction('Flour\n1 cup water', 'Flour\n2 cups water');
    assert.ok(instr, 'expected a non-null instruction');
    assert.match(instr!, /Reconcile the graph/);
    assert.match(instr!, /preserving unchanged steps and their existing node IDs and positions/);
    assert.match(instr!, /Removed lines:\n- 1 cup water/);
    assert.match(instr!, /Added lines:\n- 2 cups water/);
    assert.ok(instr!.length <= MAX_ADJUST_INSTRUCTION_CHARS, 'small edit must fit the adjust cap');
  });

  it('a whole-recipe rewrite exceeds the adjust cap (drives the full-parse fallback)', () => {
    const baseline = 'Flour\nWater';
    // A brand-new large body of text: every line is an addition + both baseline
    // lines removed, blowing well past MAX_ADJUST_INSTRUCTION_CHARS.
    const edited = Array.from({ length: 400 }, (_, i) => `Step ${i}: do a fairly detailed cooking thing`).join('\n');
    const instr = buildRecipeEditInstruction(baseline, edited);
    assert.ok(instr, 'expected a non-null instruction');
    assert.ok(
      instr!.length > MAX_ADJUST_INSTRUCTION_CHARS,
      'a large rewrite must exceed the cap so handleVisualize falls back to a full re-parse',
    );
  });
});
