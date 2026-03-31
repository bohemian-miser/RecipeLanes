import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseRecipeGraph, generateRecipePrompt, generateHydeQueriesPrompt, parseHydeQueries } from '../lib/recipe-lanes/parser';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const minimalNode = {
  id: 'n1',
  laneId: 'l1',
  text: '2 Eggs',
  visualDescription: 'egg',
  type: 'ingredient' as const,
};

const nodeWithHyde = {
  ...minimalNode,
  id: 'n2',
  hydeQueries: [
    // 4 short tags
    'egg',
    'cracked egg',
    'raw egg',
    'white egg',
    // 4 medium phrases
    'raw egg icon pixel art',
    'cracked egg on plate',
    'white egg simple icon',
    'egg ingredient pixel art',
    // 4 longer descriptions
    'cracked raw egg with yolk pixel art icon white background',
    'single white egg simple pixel art recipe card',
    'fresh egg cracked open showing yellow yolk pixel art',
    'egg ingredient icon for recipe infographic white background',
  ],
};

const minimalGraph = {
  title: 'Test Recipe',
  lanes: [{ id: 'l1', label: 'Bowl', type: 'prep' as const }],
  nodes: [minimalNode],
};

const graphWithHyde = {
  title: 'Test Recipe',
  lanes: [{ id: 'l1', label: 'Bowl', type: 'prep' as const }],
  nodes: [nodeWithHyde],
};

// ---------------------------------------------------------------------------
// parseRecipeGraph — hydeQueries pass-through
// ---------------------------------------------------------------------------

describe('parseRecipeGraph', () => {

  it('passes hydeQueries through to RecipeNode when present', () => {
    const json = JSON.stringify(graphWithHyde);
    const result = parseRecipeGraph(json);

    assert.ok(result.nodes.length === 1, 'should have one node');
    const node = result.nodes[0];
    assert.ok(Array.isArray(node.hydeQueries), 'hydeQueries should be an array');
    assert.strictEqual(node.hydeQueries!.length, 12, 'should have 12 queries');
    assert.strictEqual(node.hydeQueries![0], 'egg');
    assert.strictEqual(
      node.hydeQueries![8],
      'cracked raw egg with yolk pixel art icon white background',
    );
  });

  it('does not break when hydeQueries is absent (graceful optional)', () => {
    const json = JSON.stringify(minimalGraph);
    const result = parseRecipeGraph(json);

    assert.ok(result.nodes.length === 1, 'should have one node');
    const node = result.nodes[0];
    assert.strictEqual(node.hydeQueries, undefined, 'hydeQueries should be undefined when not provided');
  });

  it('passes hydeQueries through when wrapped in markdown code fence', () => {
    const json = '```json\n' + JSON.stringify(graphWithHyde) + '\n```';
    const result = parseRecipeGraph(json);

    const node = result.nodes[0];
    assert.ok(Array.isArray(node.hydeQueries), 'hydeQueries should survive markdown stripping');
    assert.strictEqual(node.hydeQueries!.length, 12);
  });

  it('handles a mix of nodes with and without hydeQueries', () => {
    const mixed = {
      title: 'Mixed',
      lanes: [{ id: 'l1', label: 'Pan', type: 'cook' as const }],
      nodes: [minimalNode, nodeWithHyde],
    };
    const result = parseRecipeGraph(JSON.stringify(mixed));

    assert.strictEqual(result.nodes.length, 2);
    assert.strictEqual(result.nodes[0].hydeQueries, undefined);
    assert.ok(Array.isArray(result.nodes[1].hydeQueries));
  });

});

// ---------------------------------------------------------------------------
// generateRecipePrompt — schema includes hydeQueries
// ---------------------------------------------------------------------------

describe('generateRecipePrompt', () => {

  it('includes hydeQueries field in the schema block', () => {
    const prompt = generateRecipePrompt('Boil 2 eggs for 10 minutes');
    assert.ok(
      prompt.includes('hydeQueries'),
      'prompt should mention hydeQueries in the schema',
    );
  });

});

// ---------------------------------------------------------------------------
// generateHydeQueriesPrompt — nodeType parameter
// ---------------------------------------------------------------------------

describe('generateHydeQueriesPrompt', () => {

  it('defaults to ingredient behaviour when nodeType is omitted', () => {
    const prompt = generateHydeQueriesPrompt('carrot');
    // Ingredient-specific instruction is present
    assert.ok(
      prompt.includes('colour') || prompt.includes('color') || prompt.includes('shape') || prompt.includes('texture'),
      'default prompt should contain colour/shape/texture instruction',
    );
    // Vessel/state cue instruction (action-specific) should NOT be present
    assert.ok(
      !prompt.includes('vessel') && !prompt.includes('container'),
      'default prompt should not contain vessel/container instruction',
    );
  });

  it('ingredient nodeType includes colour/shape instruction', () => {
    const prompt = generateHydeQueriesPrompt('lemon', 'ingredient');
    assert.ok(
      prompt.includes('colour') || prompt.includes('color') || prompt.includes('shape') || prompt.includes('texture'),
      'ingredient prompt should contain colour/shape/texture instruction',
    );
    assert.ok(
      !prompt.includes('vessel') && !prompt.includes('container'),
      'ingredient prompt should not contain vessel/container instruction',
    );
  });

  it('action nodeType includes vessel/state cue instruction', () => {
    const prompt = generateHydeQueriesPrompt('sauté onions', 'action');
    assert.ok(
      prompt.includes('vessel') || prompt.includes('container'),
      'action prompt should contain vessel/container instruction',
    );
    // Steam/bubbles/browning/sizzling state cues
    assert.ok(
      prompt.includes('steam') || prompt.includes('bubbles') || prompt.includes('browning') || prompt.includes('sizzling'),
      'action prompt should contain visible state cue terms',
    );
  });

  it('action nodeType does NOT contain ingredient-specific colour/shape instruction', () => {
    const prompt = generateHydeQueriesPrompt('boil pasta', 'action');
    // The ingredient-specific extra line is only added for ingredient type
    assert.ok(
      !prompt.includes('WITHOUT naming the ingredient'),
      'action prompt should not contain ingredient-specific colour/shape instruction',
    );
  });

  it('ingredient nodeType does NOT contain action vessel instruction', () => {
    const prompt = generateHydeQueriesPrompt('egg', 'ingredient');
    assert.ok(
      !prompt.includes('name the vessel'),
      'ingredient prompt should not contain vessel-naming instruction',
    );
  });

  it('embeds the ingredient name in the returned prompt', () => {
    const prompt = generateHydeQueriesPrompt('black pepper', 'ingredient');
    assert.ok(
      prompt.includes('black pepper'),
      'prompt should include the ingredient name',
    );
  });

  it('returns a string for both nodeType values', () => {
    assert.strictEqual(typeof generateHydeQueriesPrompt('egg', 'ingredient'), 'string');
    assert.strictEqual(typeof generateHydeQueriesPrompt('fry', 'action'), 'string');
  });

});

// ---------------------------------------------------------------------------
// parseHydeQueries — edge cases
// ---------------------------------------------------------------------------

describe('parseHydeQueries', () => {

  it('parses a valid raw JSON array', () => {
    const input = JSON.stringify(['egg', 'cracked egg', 'white egg', 'raw egg']);
    const result = parseHydeQueries(input);
    assert.ok(Array.isArray(result), 'result must be an array');
    assert.strictEqual(result.length, 4);
    assert.strictEqual(result[0], 'egg');
  });

  it('strips markdown json fence and parses successfully', () => {
    const inner = JSON.stringify(['a', 'b', 'c']);
    const fenced = '```json\n' + inner + '\n```';
    const result = parseHydeQueries(fenced);
    assert.deepStrictEqual(result, ['a', 'b', 'c']);
  });

  it('strips plain markdown fence (no language tag)', () => {
    const inner = JSON.stringify(['x', 'y']);
    const fenced = '```\n' + inner + '\n```';
    const result = parseHydeQueries(fenced);
    assert.deepStrictEqual(result, ['x', 'y']);
  });

  it('returns [] for invalid JSON', () => {
    const result = parseHydeQueries('not valid json at all');
    assert.deepStrictEqual(result, []);
  });

  it('returns [] for an empty string', () => {
    const result = parseHydeQueries('');
    assert.deepStrictEqual(result, []);
  });

  it('returns [] when parsed value is not an array', () => {
    const result = parseHydeQueries(JSON.stringify({ key: 'value' }));
    assert.deepStrictEqual(result, []);
  });

  it('returns [] when array contains non-string elements', () => {
    const result = parseHydeQueries(JSON.stringify([1, 2, 3]));
    assert.deepStrictEqual(result, []);
  });

  it('returns the exact strings in the same order', () => {
    const terms = [
      'diced onion',
      'chopped onion golden',
      'translucent onion in pan sauteed',
    ];
    const result = parseHydeQueries(JSON.stringify(terms));
    assert.deepStrictEqual(result, terms);
  });

});
